// ===============================================
// Payment Controller
// ===============================================

import { getRef } from '../database/firebase.js';
import { generateUUID } from '../utils/helpers.js';
import { successResponse, errorResponse } from '../utils/response.js';
import { logger } from '../utils/logger.js';
import { settlePayment } from '../services/settlement.service.js';

// Exchange Rate: 1 USD = 3930 UGX
const USD_TO_UGX_RATE = 3930;

// ==========================================
// HELPER: Process MTN/Airtel via PesaJet API
// ==========================================
const processPesaJetPayment = async (payload) => {
  const PESAJET_API_KEY = process.env.PESAJET_API_KEY;
  const PESAJET_API_URL = process.env.PESAJET_API_URL || 'https://api.pesajet.com/v1/transactions';

  if (!PESAJET_API_KEY) throw new Error('PesaJet API key is not configured.');
  
  const response = await fetch(PESAJET_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-KEY': PESAJET_API_KEY },
    body: JSON.stringify(payload)
  });

  const responseText = await response.text();
  try {
    const result = JSON.parse(responseText);
    if (!response.ok) throw new Error(result.message || 'PesaJet API declined.');
    return result;
  } catch (e) {
    throw new Error(`PesaJet Error: ${responseText}`);
  }
};

/**
 * @desc    Create a deposit request
 * @route   POST /api/v1/payments/deposit
 * @access  Private
 */
export const createDeposit = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { amount, method, email, phoneNumber, idempotencyKey } = req.body;
    
    // ==========================================
    // 1. VALIDATE EVERYTHING BEFORE DB CREATION
    // ==========================================
    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      return errorResponse(res, 'Amount must be a valid number greater than 0', 400);
    }

    const validMethods = ['manual', 'card', 'mtn', 'airtel'];
    if (!validMethods.includes(method)) {
      return errorResponse(res, 'Invalid payment method selected.', 400);
    }

    if (!idempotencyKey) {
      return errorResponse(res, 'Idempotency key is required', 400);
    }

    if ((method === 'mtn' || method === 'airtel') && !phoneNumber) {
      return errorResponse(res, 'Phone number is required', 400);
    }

    // Normalize Phone Number Early
    let formattedPhone = '';
    if (method === 'mtn' || method === 'airtel') {
      formattedPhone = phoneNumber.replace(/\s+/g, '').replace(/^\+/, '');
      if (formattedPhone.startsWith('0')) formattedPhone = '256' + formattedPhone.substring(1);
      else if (!formattedPhone.startsWith('256')) formattedPhone = '256' + formattedPhone;
      formattedPhone = '+' + formattedPhone;
      
      if (formattedPhone.length < 12) {
        return errorResponse(res, 'Invalid Ugandan phone number format', 400);
      }
    }

    // ==========================================
    // 2. IDEMPOTENCY CHECK (ATOMIC & SAFE)
    // ==========================================
    const paymentId = generateUUID();
    const idempotencyRef = getRef(`paymentIdempotency/${userId}/${idempotencyKey}`);
    
    const idempotencyClaim = await idempotencyRef.transaction((current) => {
      if (current && current.paymentId) return; // Abort - already exists and is claimed
      return { status: 'pending', createdAt: Date.now(), paymentId: paymentId };
    });

    if (!idempotencyClaim.committed) {
      const existingSnap = await idempotencyRef.get();
      const existingData = existingSnap.val();
      
      if (existingData && existingData.paymentId) {
        const paymentSnap = await getRef(`payments/${existingData.paymentId}`).get();
        if (paymentSnap.exists()) {
          const p = paymentSnap.val();
          // Only clear if genuinely safe to retry (terminal failure states)
          if (p.status === 'rejected' || p.status === 'cancelled' || p.status === 'expired') {
            await idempotencyRef.remove();
            return errorResponse(res, 'Previous attempt failed. Please try again.', 200);
          }
          // If active or completed, return the existing payment info
          logger.info(`[Duplicate Prevented] Idempotency key match for active payment ${p.id}`);
          if (p.method === 'card' && p.redirectUrl) {
            return successResponse(res, 'Card payment already initiated', { paymentId: p.id, reference: p.gatewayReference, redirect_url: p.redirectUrl }, 200);
          }
          return successResponse(res, 'Payment already initiated', p, 200);
        }
      }
      return errorResponse(res, 'A deposit request is already being processed. Please wait.', 200);
    }

    // ==========================================
    // 3. ACTIVE DEPOSIT LOCK (Check DB for active payments)
    // ==========================================
    if (method === 'mtn' || method === 'airtel') {
      const userPaymentsSnap = await getRef('payments').orderByChild('userId').equalTo(userId).get();
      if (userPaymentsSnap.exists()) {
        const userPayments = Object.values(userPaymentsSnap.val());
        const activePayment = userPayments.find(p => (p.method === 'mtn' || p.method === 'airtel') && (p.status === 'pending' || p.status === 'processing'));
        
        if (activePayment) {
          // Clear the idempotency claim we just created since we won't proceed with a new payment
          await idempotencyRef.remove();
          logger.info(`[Active Payment] User ${userId} already has active MTN/Airtel payment ${activePayment.id}`);
          return successResponse(res, 'You already have a pending Mobile Money deposit. Please wait for it to expire or complete.', activePayment, 200);
        }
      }
      
      // Create the activeDeposit lock referencing the paymentId
      const lockRef = getRef(`users/${userId}/activeDeposit`);
      await lockRef.set({ 
        lockedAt: Date.now(), 
        paymentId: paymentId,
        status: 'pending'
      });
    }

    const bonus = 0.05;
    const totalCredit = parseFloat(parsedAmount) + bonus;
    const amountInUGX = Math.round(parsedAmount * USD_TO_UGX_RATE);
    
    const paymentData = {
      id: paymentId,
      userId,
      method,
      status: 'pending',
      createdAt: new Date().toISOString(),
      amount: parsedAmount,
      bonus: bonus,
      totalCredit: totalCredit,
      amountUSD: parsedAmount,
      bonusUSD: bonus,
      totalCreditUSD: totalCredit,
      amountUGX: amountInUGX,
      exchangeRate: USD_TO_UGX_RATE,
      idempotencyKey: idempotencyKey
    };
    
    // ==========================================
    // 4. ATOMIC SAVE BEFORE GATEWAY CALL
    // ==========================================
    const updates = {};
    updates[`payments/${paymentId}`] = paymentData;
    updates[`transactions/${paymentId}`] = { id: paymentId, userId, type: 'deposit', amount: totalCredit, status: 'pending', date: new Date().toISOString(), method: method };
    await getRef().update(updates);

    // ==========================================
    // 5. HANDLE GATEWAY CALLS (SAFE FAILURES)
    // ==========================================
    
    // PATH 1: MANUAL PAYMENTS
    if (method === 'manual') {
      await idempotencyRef.update({ status: 'initiated' });
      return successResponse(res, 'Deposit request created! Please send your receipt via WhatsApp.', paymentData, 201);
    }

    // PATH 2: CARD PAYMENTS (MARZPAY)
    if (method === 'card') {
      try {
        const MARZPAY_API_URL = process.env.MARZPAY_API_URL || 'https://wallet.wearemarz.com/api/v1';
        const MARZPAY_API_CREDENTIALS = process.env.MARZPAY_API_CREDENTIALS;
        const MARZPAY_CALLBACK_URL = process.env.MARZPAY_CALLBACK_URL;

        if (!MARZPAY_API_CREDENTIALS) throw new Error('MarzPay API credentials missing.');

        const marzpayReference = paymentId; // Deterministic reference
        const response = await fetch(`${MARZPAY_API_URL}/collect-money`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Basic ${MARZPAY_API_CREDENTIALS}` },
          body: JSON.stringify({ amount: amountInUGX, method: "card", reference: marzpayReference, country: "UG", description: "SMMMARIA Wallet Deposit", callback_url: MARZPAY_CALLBACK_URL })
        });
        const result = await response.json();

        if (!response.ok || !result.data || !result.data.redirect_url) throw new Error(result.message || 'MarzPay did not return redirect URL.');

        await getRef(`payments/${paymentId}`).update({
          gateway: "marzpay",
          gatewayReference: marzpayReference,
          redirectUrl: result.data.redirect_url
        });

        await idempotencyRef.update({ status: 'initiated' });

        return successResponse(res, 'Card payment initiated', { paymentId, reference: marzpayReference, redirect_url: result.data.redirect_url }, 201);
      } catch (apiError) {
        // FIX: Do NOT reject on unknown gateway failure. Keep as pending for webhook/cron recovery.
        logger.error(`[Gateway Unknown] Card payment ${paymentId} gateway call failed: ${apiError.message}. Left as pending.`);
        await idempotencyRef.update({ status: 'initiated' });
        return successResponse(res, 'Payment initiated. Waiting for gateway confirmation...', { paymentId, status: 'pending' }, 201);
      }
    }

    // PATH 3: MTN & AIRTEL (PESAJET)
    if (method === 'mtn' || method === 'airtel') {
      try {
        let gatewayPayload = { 
          type: "COLLECTION", 
          amount: amountInUGX, 
          currency: "UGX", 
          phoneNumber: formattedPhone, 
          provider: method, 
          reference: paymentId.replace(/-/g, '') 
        };

        let gatewayRef = '';
        try {
            const gatewayResponse = await processPesaJetPayment(gatewayPayload);
            gatewayRef = gatewayResponse.transactionId || gatewayResponse.id || gatewayPayload.reference;
        } catch (apiError) {
            if (apiError.message.includes('Transaction state is ambiguous') || apiError.message.includes('system will poll for status')) {
                gatewayRef = gatewayPayload.reference;
            } else {
                throw apiError; // Re-throw for outer catch
            }
        }
        
        await getRef(`payments/${paymentId}`).update({
            gateway: "pesajet",
            gatewayReference: gatewayRef
        });

        await idempotencyRef.update({ status: 'initiated' });

        return successResponse(res, 'Payment request sent to your phone. Please approve the prompt.', paymentData, 201);
      } catch (apiError) {
        // FIX: Do NOT reject on unknown gateway failure. Keep as pending for cron recovery.
        logger.error(`[Gateway Unknown] MTN/Airtel payment ${paymentId} gateway call failed: ${apiError.message}. Left as pending.`);
        await idempotencyRef.update({ status: 'initiated' });
        return successResponse(res, 'Payment request sent. Waiting for gateway confirmation...', { paymentId, status: 'pending' }, 201);
      }
    }
  } catch (error) {
    next(error);
  }
};

// ==========================================
// PESAJET WEBHOOK 
// ==========================================
export const pesajetWebhook = async (req, res, next) => {
  try {
    const { transactionId, status } = req.body;
    if (!transactionId) return res.status(400).send('Transaction ID required');

    const snapshot = await getRef('payments').orderByChild('gatewayReference').equalTo(transactionId).get();
    if (snapshot.exists()) {
      const payments = snapshot.val();
      const paymentKeys = Object.keys(payments);
      
      if (status === 'SUCCESS' || status === 'COMPLETED' || status === 'SUCCESSFUL') {
        await settlePayment(paymentKeys[0], 'pesajet_webhook');
        
        // Reject any duplicates safely
        for (let i = 1; i < paymentKeys.length; i++) {
          await getRef(`payments/${paymentKeys[i]}`).transaction((p) => {
            if (p && (p.status === 'pending' || p.status === 'processing')) { 
              p.status = 'rejected'; 
              p.failureReason = 'Duplicate gateway transaction'; 
              return p; 
            }
            return;
          });
        }
      } else if (status === 'FAILED' || status === 'CANCELLED' || status === 'EXPIRED') {
        for (const key of paymentKeys) {
          const txResult = await getRef(`payments/${key}`).transaction((p) => {
            if (p && (p.status === 'pending' || p.status === 'processing')) { 
              p.status = 'rejected'; 
              p.failureReason = status; 
              return p; 
            }
            return;
          });
          
          if (txResult.committed) {
            await getRef(`transactions/${key}`).update({ status: 'rejected' });
            if (payments[key].userId) await getRef(`users/${payments[key].userId}/activeDeposit`).remove();
          }
        }
      }
    }
    return res.status(200).send('Webhook received');
  } catch (error) { next(error); }
};

// ==========================================
// MARZPAY WEBHOOK 
// ==========================================
export const marzPayWebhook = async (req, res, next) => {
  try {
    const { event_type, collection } = req.body;
    if (!collection || !collection.reference) return res.status(400).send('Invalid MarzPay payload');

    const snapshot = await getRef('payments').orderByChild('gatewayReference').equalTo(collection.reference).get();
    if (!snapshot.exists()) return res.status(200).send('Payment not found');

    const payments = snapshot.val();
    const paymentKeys = Object.keys(payments);

    if (event_type === "collection.completed" || collection.status === "completed") {
      await settlePayment(paymentKeys[0], 'marzpay_webhook');
      
      for (let i = 1; i < paymentKeys.length; i++) {
        await getRef(`payments/${paymentKeys[i]}`).transaction((p) => {
          if (p && (p.status === 'pending' || p.status === 'processing')) { 
            p.status = 'rejected'; 
            p.failureReason = 'Duplicate gateway transaction'; 
            return p; 
          }
          return;
        });
      }
    } else if (event_type === "collection.failed" || collection.status === "failed") {
      for (const key of paymentKeys) {
        const txResult = await getRef(`payments/${key}`).transaction((p) => {
          if (p && (p.status === 'pending' || p.status === 'processing')) { 
            p.status = 'rejected'; 
            p.failureReason = collection.status; 
            return p; 
          }
          return;
        });
        
        if (txResult.committed) {
          await getRef(`transactions/${key}`).update({ status: 'rejected' });
          if (payments[key].userId) await getRef(`users/${payments[key].userId}/activeDeposit`).remove();
        }
      }
    }
    return res.status(200).send('Webhook received');
  } catch (error) { next(error); }
};

// ==========================================
// CRON JOB FUNCTION (Reconciliation & Recovery)
// ==========================================
export const checkPendingPayments = async () => {
  const cronLockRef = getRef('cronLocks/checkPendingPayments');
  
  const lockResult = await cronLockRef.transaction((current) => {
    if (!current) return { lockedAt: Date.now() };
    if (Date.now() - current.lockedAt > 120000) return { lockedAt: Date.now() }; 
    return; 
  });

  if (!lockResult.committed) {
    logger.info('[Cron] Skipped execution: another instance is running.');
    return;
  }

  logger.info('[Cron] Distributed lock acquired. Running pending payments check...');

  try {
    // 1. PROTECT THE STALE `processing` RECOVERY PATH
    const processingSnap = await getRef('payments').orderByChild('status').equalTo('processing').get();
    if (processingSnap.exists()) {
      const processingPayments = Object.values(processingSnap.val());
      for (const payment of processingPayments) {
        const age = Date.now() - (payment.processingStartedAt || 0);
        // Only recover if processing for > 5 minutes (safety buffer)
        if (age > 300000) { 
          const recoveryClaimRef = getRef(`settlementClaims/${payment.id}`);
          const claimResult = await recoveryClaimRef.transaction((c) => {
            if (!c) return { source: 'cron_recovery', claimedAt: Date.now(), claimId: generateUUID() };
            if (Date.now() - c.claimedAt > 60000) return { source: 'cron_recovery', claimedAt: Date.now(), claimId: generateUUID() };
            return; 
          });
          
          if (!claimResult.committed) {
            logger.info(`[Cron] Duplicate settlement prevented paymentId=${payment.id} source=cron_recovery`);
            continue;
          }

          const claimData = claimResult.snapshot.val() || {};
          logger.info(`[Cron Recovery] Settlement attempt: paymentId=${payment.id} userId=${payment.userId} gatewayReference=${payment.gatewayReference} previousStatus=processing cronSource=cron_recovery claimId=${claimData.claimId}`);
          
          await settlePayment(payment.id, 'cron_recovery');
        }
      }
    }
    
    // 2. PROTECT THE PENDING PesaJet RECONCILIATION PATH
    const pendingSnap = await getRef('payments').orderByChild('status').equalTo('pending').get();
    if (!pendingSnap.exists()) return;

    const pendingPayments = Object.values(pendingSnap.val());
    for (const payment of pendingPayments) {
      const currentPaymentSnap = await getRef(`payments/${payment.id}`).get();
      const currentPayment = currentPaymentSnap.val();
      
      if (!currentPayment || currentPayment.status !== 'pending' || !currentPayment.gatewayReference || currentPayment.gatewayReference.length <= 20) {
        continue;
      }

      // Check for duplicate gateway references
      const dupSnap = await getRef('payments').orderByChild('gatewayReference').equalTo(currentPayment.gatewayReference).get();
      let isDuplicate = false;
      if (dupSnap.exists()) {
        const dups = dupSnap.val();
        for (const key in dups) {
          if (key !== currentPayment.id && (dups[key].status === 'completed' || dups[key].status === 'processing')) {
            isDuplicate = true;
            break;
          }
        }
      }

      if (isDuplicate) {
        logger.info(`[Cron] Duplicate gateway payment prevented paymentId=${currentPayment.id} gatewayReference=${currentPayment.gatewayReference}`);
        const dupResult = await getRef(`payments/${currentPayment.id}`).transaction((p) => {
          if (p && p.status === 'pending') {
            p.status = 'rejected';
            p.failureReason = 'Duplicate gateway transaction';
            return p;
          }
          return;
        });
        
        if (dupResult.committed) {
          await getRef(`transactions/${currentPayment.id}`).update({ status: 'rejected' });
          if (currentPayment.userId) await getRef(`users/${currentPayment.userId}/activeDeposit`).remove();
        }
        continue;
      }

      // ATOMIC GATEWAY CLAIM FOR CRON WORKERS
      const gwClaimRef = getRef(`gatewayClaims/${currentPayment.gatewayReference}`);
      const gwClaimResult = await gwClaimRef.transaction((c) => {
        if (!c) return { claimedAt: Date.now(), paymentId: currentPayment.id };
        if (Date.now() - c.claimedAt > 60000) return { claimedAt: Date.now(), paymentId: currentPayment.id };
        return; 
      });

      if (!gwClaimResult.committed) {
        logger.info(`[Cron] Gateway reference ${currentPayment.gatewayReference} already claimed by another worker. Skipping.`);
        continue;
      }

      // Claim for reconciliation
      const reconClaimRef = getRef(`settlementClaims/${currentPayment.id}`);
      const claimResult = await reconClaimRef.transaction((c) => {
        if (!c) return { source: 'cron_reconciliation', claimedAt: Date.now(), claimId: generateUUID() };
        if (Date.now() - c.claimedAt > 60000) return { source: 'cron_reconciliation', claimedAt: Date.now(), claimId: generateUUID() };
        return; 
      });

      if (!claimResult.committed) {
        logger.info(`[Cron] Duplicate settlement prevented paymentId=${currentPayment.id} source=cron_reconciliation`);
        continue;
      }

      const claimData = claimResult.snapshot.val() || {};
      
      // FIX: Wrap PesaJet API call in try...catch so it doesn't crash the Cron job
      let gatewayStatus = 'UNKNOWN';
      try {
        const response = await fetch(`${process.env.PESAJET_API_URL}/${currentPayment.gatewayReference}`, { headers: { 'X-API-KEY': process.env.PESAJET_API_KEY } });
        const result = await response.json();
        gatewayStatus = result.status || 'UNKNOWN';
      } catch (apiError) {
        logger.error(`[Cron] PesaJet API query failed for ${currentPayment.id}: ${apiError.message}`);
      }

      if (gatewayStatus === 'SUCCESS' || gatewayStatus === 'COMPLETED') {
        logger.info(`[Cron Reconciliation] Settlement attempt: paymentId=${currentPayment.id} userId=${currentPayment.userId} gatewayReference=${currentPayment.gatewayReference} previousStatus=pending cronSource=cron_reconciliation claimId=${claimData.claimId} gatewayStatus=${gatewayStatus}`);
        
        const settlementResult = await settlePayment(currentPayment.id, 'cron_reconciliation');
        logger.info(`[Cron Reconciliation] Settlement result: paymentId=${currentPayment.id} result=${JSON.stringify(settlementResult)}`);
        
        if (settlementResult.success || settlementResult.alreadySettled) {
          await getRef(`users/${currentPayment.userId}/activeDeposit`).remove();
        }
      } else if (gatewayStatus === 'FAILED' || gatewayStatus === 'CANCELLED' || gatewayStatus === 'EXPIRED') {
        const rejectResult = await getRef(`payments/${currentPayment.id}`).transaction((p) => {
          if (p && p.status === 'pending') {
            p.status = 'rejected';
            p.failureReason = gatewayStatus;
            return p;
          }
          return;
        });
        
        if (rejectResult.committed) {
          await getRef(`transactions/${currentPayment.id}`).update({ status: 'rejected' });
          if (currentPayment.userId) await getRef(`users/${currentPayment.userId}/activeDeposit`).remove();
        }
      } else {
        // FIX: If status is UNKNOWN or PENDING, do nothing. Let it wait for the next cron run or webhook.
        logger.info(`[Cron Reconciliation] Payment ${currentPayment.id} still pending at gateway. Will retry later.`);
      }
    }
  } catch (error) { 
    console.error('Cron Error:', error.message); 
  } finally {
    await cronLockRef.remove();
    logger.info('[Cron] Released distributed lock.');
  }
};

// ==========================================
// ADMIN FUNCTIONS 
// ==========================================
export const approvePayment = async (req, res, next) => {
  try {
    const { id } = req.params;
    // Pass `true` for isAdminOverride so the Admin can bypass gateway locks
    const result = await settlePayment(id, 'admin_manual', true);
    if (result.alreadySettled) return errorResponse(res, 'Payment already approved', 400);
    if (!result.success) return errorResponse(res, 'Payment could not be approved', 400);
    return successResponse(res, 'Payment approved and wallet credited successfully');
  } catch (error) { next(error); }
};

export const rejectPayment = async (req, res, next) => {
  try {
    const { id } = req.params;
    const paymentRef = getRef(`payments/${id}`);
    const paymentSnapshot = await paymentRef.get();
    if (!paymentSnapshot.exists()) return errorResponse(res, 'Payment not found', 404);
    
    const result = await paymentRef.transaction((p) => {
        if (p && (p.status === 'pending' || p.status === 'processing')) { 
          p.status = 'rejected'; 
          p.rejectedAt = new Date().toISOString(); 
          return p; 
        }
        return;
    });
    
    if (!result.committed) return errorResponse(res, 'Payment is already completed or rejected', 400);
    await getRef(`transactions/${id}`).update({ status: 'rejected' });
    if (result.snapshot.val().userId) await getRef(`users/${result.snapshot.val().userId}/activeDeposit`).remove();
    return successResponse(res, 'Payment rejected successfully');
  } catch (error) { next(error); }
};

// ==========================================
// USER CANCEL PENDING DEPOSIT
// ==========================================
export const cancelPendingDeposit = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const snapshot = await getRef('payments').orderByChild('userId').equalTo(userId).get();
    if (!snapshot.exists()) return errorResponse(res, 'No pending deposits found.', 404);

    let cancelledCount = 0;
    let alreadyProcessedCount = 0;
    const updates = {};

    for (const key in snapshot.val()) {
      const payment = snapshot.val()[key];
      if (payment.method === 'mtn' || payment.method === 'airtel') {
        const paymentRef = getRef(`payments/${key}`);
        const cancelRes = await paymentRef.transaction((p) => {
          if (!p) return;
          if (p.status === 'pending') {
            p.status = 'cancelled';
            p.failureReason = 'Cancelled by user';
            return p;
          }
          return; 
        });
        
        if (cancelRes.committed) {
          updates[`transactions/${key}/status`] = 'cancelled';
          updates[`users/${userId}/activeDeposit`] = null; // Release lock only on successful cancel
          cancelledCount++;
        } else {
          const currentStatus = cancelRes.snapshot.val()?.status;
          if (currentStatus === 'processing' || currentStatus === 'completed') {
            alreadyProcessedCount++;
          } else if (currentStatus === 'cancelled') {
            cancelledCount++;
          }
        }
      }
    }

    if (cancelledCount > 0) {
      await getRef().update(updates);
      return successResponse(res, 'Pending deposit cancelled successfully.');
    } else if (alreadyProcessedCount > 0) {
      return successResponse(res, 'Deposit is already being processed or completed.');
    } else {
      return errorResponse(res, 'No pending MTN/Airtel deposits found to cancel.', 404);
    }
  } catch (error) { next(error); }
};

// ==========================================
// GET PAYMENTS
// ==========================================
export const getPayments = async (req, res, next) => {
  try {
    const snapshot = await getRef('payments').get();
    let payments = snapshot.exists() ? Object.values(snapshot.val()).reverse() : [];
    const usersSnapshot = await getRef('users').get();
    const usersMap = {};
    if (usersSnapshot.exists()) {
      const usersObj = usersSnapshot.val();
      for (const key in usersObj) { 
        usersMap[key] = {
          username: usersObj[key].username || usersObj[key].email || 'Unknown',
          totalDeposited: usersObj[key].totalDeposited || 0,
          balance: usersObj[key].balance || 0
        }; 
      }
    }
    payments = payments.map(p => ({ 
      ...p, 
      username: usersMap[p.userId]?.username || 'Unknown',
      totalDeposited: usersMap[p.userId]?.totalDeposited || 0,
      balance: usersMap[p.userId]?.balance || 0
    }));
    if (req.user.role === 'user') payments = payments.filter(p => p.userId === req.user.id);
    return successResponse(res, 'Payments fetched successfully', payments);
  } catch (error) { next(error); }
};

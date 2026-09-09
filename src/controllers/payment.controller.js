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
    
    // FIX: Strict validation
    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      return errorResponse(res, 'Amount must be a valid number greater than 0', 400);
    }

    // ==========================================
    // 1. IDEMPOTENCY CHECK (NEW)
    // ==========================================
    if (!idempotencyKey) {
      return errorResponse(res, 'Idempotency key is required', 400);
    }

    const idempotencyRef = getRef(`paymentIdempotency/${userId}/${idempotencyKey}`);
    const idempotencyClaim = await idempotencyRef.transaction((current) => {
      if (current && current.paymentId) return; // Abort - already exists
      return { status: 'pending', createdAt: Date.now() };
    });

    if (!idempotencyClaim.committed) {
      const existingSnap = await idempotencyRef.get();
      const existingData = existingSnap.val();
      
      if (existingData && existingData.paymentId) {
        const paymentSnap = await getRef(`payments/${existingData.paymentId}`).get();
        if (paymentSnap.exists()) {
          const p = paymentSnap.val();
          if (p.method === 'card' && p.redirectUrl) {
            return successResponse(res, 'Card payment already initiated', { paymentId: p.id, reference: p.gatewayReference, redirect_url: p.redirectUrl }, 200);
          }
          return successResponse(res, 'Payment already initiated', p, 200);
        }
      }
      return errorResponse(res, 'A deposit request is already being processed. Please wait.', 200);
    }

    const bonus = 0.05;
    const totalCredit = parseFloat(parsedAmount) + bonus;
    
    // ==========================================
    // ACTIVE DEPOSIT LOCK (Anti-Double Click)
    // ==========================================
    if (method === 'mtn' || method === 'airtel') {
      const lockRef = getRef(`users/${userId}/activeDeposit`);
      const lockResult = await lockRef.transaction((currentLock) => {
        if (currentLock) {
          const lockAge = Date.now() - (currentLock.lockedAt || 0);
          if (lockAge < (5 * 60 * 1000)) return; // Abort - locked
        }
        return { lockedAt: Date.now() };
      });
      
      if (!lockResult.committed) {
        return errorResponse(res, 'You already have a pending Mobile Money deposit. Please wait or use the Cancel button.', 400);
      }
    }

    const paymentId = generateUUID();
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
    // 2. ATOMIC SAVE BEFORE GATEWAY CALL (NEW)
    // ==========================================
    const updates = {};
    updates[`payments/${paymentId}`] = paymentData;
    updates[`transactions/${paymentId}`] = { id: paymentId, userId, type: 'deposit', amount: totalCredit, status: 'pending', date: new Date().toISOString() };
    updates[`paymentIdempotency/${userId}/${idempotencyKey}/paymentId`] = paymentId;
    await getRef().update(updates);

    // PATH 1: MANUAL PAYMENTS (NEW)
    if (method === 'manual') {
      return successResponse(res, 'Deposit request created! Please send your receipt via WhatsApp.', paymentData, 201);
    }

    // PATH 2: CARD PAYMENTS (MARZPAY)
    if (method === 'card') {
      try {
        const MARZPAY_API_URL = process.env.MARZPAY_API_URL || 'https://wallet.wearemarz.com/api/v1';
        const MARZPAY_API_CREDENTIALS = process.env.MARZPAY_API_CREDENTIALS;
        const MARZPAY_CALLBACK_URL = process.env.MARZPAY_CALLBACK_URL;

        if (!MARZPAY_API_CREDENTIALS) throw new Error('MarzPay API credentials missing.');

        const marzpayReference = paymentId; // FIX: Deterministic reference
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

        return successResponse(res, 'Card payment initiated', { paymentId, reference: marzpayReference, redirect_url: result.data.redirect_url }, 201);
      } catch (apiError) {
        await getRef(`payments/${paymentId}`).update({ status: 'rejected', failureReason: apiError.message });
        await getRef(`transactions/${paymentId}`).update({ status: 'rejected' });
        return errorResponse(res, `Card payment failed: ${apiError.message}`, 400);
      }
    }

    // PATH 3: MTN & AIRTEL (PESAJET)
    if (method === 'mtn' || method === 'airtel') {
      try {
        if (!phoneNumber) return errorResponse(res, 'Phone number is required', 400);
        
        let formattedPhone = phoneNumber.replace(/\s+/g, '').replace(/^\+/, '');
        if (formattedPhone.startsWith('0')) formattedPhone = '256' + formattedPhone.substring(1);
        else if (!formattedPhone.startsWith('256')) formattedPhone = '256' + formattedPhone;
        formattedPhone = '+' + formattedPhone;

        let gatewayPayload = { type: "COLLECTION", amount: amountInUGX, currency: "UGX", phoneNumber: formattedPhone, provider: method, reference: paymentId.replace(/-/g, '') };

        let gatewayResponse;
        try {
            gatewayResponse = await processPesaJetPayment(gatewayPayload);
            const gatewayRef = gatewayResponse.transactionId || gatewayResponse.id || gatewayPayload.reference;
            
            await getRef(`payments/${paymentId}`).update({
                gateway: "pesajet",
                gatewayReference: gatewayRef
            });
        } catch (apiError) {
            if (apiError.message.includes('Transaction state is ambiguous') || apiError.message.includes('system will poll for status')) {
                await getRef(`payments/${paymentId}`).update({
                    gateway: "pesajet",
                    gatewayReference: gatewayPayload.reference
                });
                return successResponse(res, 'Payment request sent. Please approve the prompt on your phone. Waiting for confirmation...', { status: 'pending' }, 201);
            }
            throw apiError;
        }

        return successResponse(res, 'Payment request sent to your phone. Please approve the prompt.', paymentData, 201);
      } catch (apiError) {
        await getRef(`users/${userId}/activeDeposit`).remove(); // Release lock on failure
        await getRef(`payments/${paymentId}`).update({ status: 'rejected', failureReason: apiError.message });
        await getRef(`transactions/${paymentId}`).update({ status: 'rejected' });
        return errorResponse(res, `Payment failed: ${apiError.message}`, 400);
      }
    }
    
    return errorResponse(res, 'Invalid payment method selected.', 400);
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
      
      // FIX: If duplicate payments exist for the same gateway reference, 
      // settle only the FIRST one and reject the rest to prevent over-crediting.
      if (status === 'SUCCESS' || status === 'COMPLETED' || status === 'SUCCESSFUL') {
        // 1. Settle the first one
        await settlePayment(paymentKeys[0], 'pesajet_webhook');
        
        // 2. Reject any duplicates
        for (let i = 1; i < paymentKeys.length; i++) {
          await getRef(`payments/${paymentKeys[i]}`).transaction((p) => {
            if (p && p.status === 'pending') { 
              p.status = 'rejected'; 
              p.failureReason = 'Duplicate gateway transaction'; 
              return p; 
            }
            return;
          });
        }
      } else if (status === 'FAILED' || status === 'CANCELLED' || status === 'EXPIRED') {
        // Reject all matching payments
        for (const key of paymentKeys) {
          await getRef(`payments/${key}`).transaction((p) => {
            if (p && (p.status === 'pending' || p.status === 'processing')) { 
              p.status = 'rejected'; 
              p.failureReason = status; 
              return p; 
            }
            return;
          });
          await getRef(`transactions/${key}`).update({ status: 'rejected' });
        }
        const userId = payments[paymentKeys[0]].userId;
        if (userId) await getRef(`users/${userId}/activeDeposit`).remove();
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
      // 1. Settle the first one
      await settlePayment(paymentKeys[0], 'marzpay_webhook');
      
      // 2. Reject any duplicates
      for (let i = 1; i < paymentKeys.length; i++) {
        await getRef(`payments/${paymentKeys[i]}`).transaction((p) => {
          if (p && p.status === 'pending') { 
            p.status = 'rejected'; 
            p.failureReason = 'Duplicate gateway transaction'; 
            return p; 
          }
          return;
        });
      }
    } else if (event_type === "collection.failed" || collection.status === "failed") {
      // Reject all matching payments
      for (const key of paymentKeys) {
        await getRef(`payments/${key}`).transaction((p) => {
          if (p && (p.status === 'pending' || p.status === 'processing')) { 
            p.status = 'rejected'; 
            p.failureReason = collection.status; 
            return p; 
          }
          return;
        });
        await getRef(`transactions/${key}`).update({ status: 'rejected' });
      }
      const userId = payments[paymentKeys[0]].userId;
      if (userId) await getRef(`users/${userId}/activeDeposit`).remove();
    }
    return res.status(200).send('Webhook received');
  } catch (error) { next(error); }
};

// ==========================================
// CRON JOB FUNCTION (Reconciliation & Recovery)
// ==========================================
export const checkPendingPayments = async () => {
  const cronLockRef = getRef('cronLocks/checkPendingPayments');
  
  // 1. PREVENT MULTIPLE CRON INSTANCES FROM RUNNING THE SAME JOB
  const lockResult = await cronLockRef.transaction((current) => {
    if (!current) return { lockedAt: Date.now() };
    // Expire lock after 2 minutes to prevent permanent blocking if a process crashes
    if (Date.now() - current.lockedAt > 120000) return { lockedAt: Date.now() }; 
    return; // Abort - another instance is running
  });

  if (!lockResult.committed) {
    logger.info('[Cron] Skipped execution: another instance is running.');
    return;
  }

  logger.info('[Cron] Distributed lock acquired. Running pending payments check...');

  try {
    // 2. PROTECT THE STALE `processing` RECOVERY PATH
    const processingSnap = await getRef('payments').orderByChild('status').equalTo('processing').get();
    if (processingSnap.exists()) {
      const processingPayments = Object.values(processingSnap.val());
      for (const payment of processingPayments) {
        const age = Date.now() - (payment.processingStartedAt || 0);
        if (age > 120000) { 
          // Atomically claim the payment for Cron recovery
          const recoveryClaimRef = getRef(`settlementClaims/${payment.id}`);
          const claimResult = await recoveryClaimRef.transaction((c) => {
            if (!c) return { source: 'cron_recovery', claimedAt: Date.now(), claimId: generateUUID() };
            // Expire claim after 1 minute
            if (Date.now() - c.claimedAt > 60000) return { source: 'cron_recovery', claimedAt: Date.now(), claimId: generateUUID() };
            return; // Abort if already claimed
          });
          
          if (!claimResult.committed) {
            logger.info(`[Cron] Duplicate settlement prevented paymentId=${payment.id} source=cron_recovery`);
            continue;
          }

          const claimData = claimResult.snapshot.val() || {};
          logger.info(`[Cron Recovery] Settlement attempt: paymentId=${payment.id} userId=${payment.userId} gatewayReference=${payment.gatewayReference} previousStatus=processing cronSource=cron_recovery claimId=${claimData.claimId}`);
          
          // The only function used to perform actual payment settlement
          await settlePayment(payment.id, 'cron_recovery');
        }
      }
    }
    
    // 3. PROTECT THE PENDING PesaJet RECONCILIATION PATH
    const pendingSnap = await getRef('payments').orderByChild('status').equalTo('pending').get();
    if (!pendingSnap.exists()) return;

    const pendingPayments = Object.values(pendingSnap.val());
    for (const payment of pendingPayments) {
      // Re-read the payment from Firebase to confirm it is STILL `pending`
      const currentPaymentSnap = await getRef(`payments/${payment.id}`).get();
      const currentPayment = currentPaymentSnap.val();
      
      if (!currentPayment || currentPayment.status !== 'pending' || !currentPayment.gatewayReference || currentPayment.gatewayReference.length <= 20) {
        continue;
      }

      // Check whether another payment with the same gatewayReference has already been completed or is being processed
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
        await getRef(`payments/${currentPayment.id}`).transaction((p) => {
          if (p && p.status === 'pending') {
            p.status = 'rejected';
            p.failureReason = 'Duplicate gateway transaction';
            return p;
          }
          return;
        });
        continue;
      }

      // Atomically claim the payment for reconciliation to fix the race condition
      const reconClaimRef = getRef(`settlementClaims/${currentPayment.id}`);
      const claimResult = await reconClaimRef.transaction((c) => {
        if (!c) return { source: 'cron_reconciliation', claimedAt: Date.now(), claimId: generateUUID() };
        if (Date.now() - c.claimedAt > 60000) return { source: 'cron_reconciliation', claimedAt: Date.now(), claimId: generateUUID() };
        return; // Abort if already claimed
      });

      if (!claimResult.committed) {
        logger.info(`[Cron] Duplicate settlement prevented paymentId=${currentPayment.id} source=cron_reconciliation`);
        continue;
      }

      const claimData = claimResult.snapshot.val() || {};
      
      // Query Gateway
      const response = await fetch(`${process.env.PESAJET_API_URL}/${currentPayment.gatewayReference}`, { headers: { 'X-API-KEY': process.env.PESAJET_API_KEY } });
      const result = await response.json();
      const gatewayStatus = result.status || 'UNKNOWN';

      // 8. AFTER GATEWAY SUCCESS
      if (gatewayStatus === 'SUCCESS' || gatewayStatus === 'COMPLETED') {
        logger.info(`[Cron Reconciliation] Settlement attempt: paymentId=${currentPayment.id} userId=${currentPayment.userId} gatewayReference=${currentPayment.gatewayReference} previousStatus=pending cronSource=cron_reconciliation claimId=${claimData.claimId} gatewayStatus=${gatewayStatus}`);
        
        const settlementResult = await settlePayment(currentPayment.id, 'cron_reconciliation');
        logger.info(`[Cron Reconciliation] Settlement result: paymentId=${currentPayment.id} result=${JSON.stringify(settlementResult)}`);
        
        // 10. ACTIVE DEPOSIT LOCK: Release only when actually settled
        if (settlementResult.success || settlementResult.alreadySettled) {
          await getRef(`users/${currentPayment.userId}/activeDeposit`).remove();
        }
      } else if (gatewayStatus === 'FAILED' || gatewayStatus === 'CANCELLED' || gatewayStatus === 'EXPIRED') {
        // 9. HANDLE FAILED/EXPIRED PAYMENTS SAFELY
        await getRef(`payments/${currentPayment.id}`).transaction((p) => {
          if (p && p.status === 'pending') {
            p.status = 'rejected';
            p.failureReason = gatewayStatus;
            return p;
          }
          return;
        });
        await getRef(`transactions/${currentPayment.id}`).update({ status: 'rejected' });
      }
    }
  } catch (error) { 
    console.error('Cron Error:', error.message); 
  } finally {
    // Always release the lock in a finally block when the job finishes
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
    const result = await settlePayment(id, 'admin_manual');
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
        if (p && (p.status === 'pending' || p.status === 'processing')) { p.status = 'rejected'; p.rejectedAt = new Date().toISOString(); return p; }
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
          return; // Abort if not pending
        });
        
        if (cancelRes.committed) {
          updates[`transactions/${key}/status`] = 'cancelled';
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
      updates[`users/${userId}/activeDeposit`] = null;
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
      for (const key in usersObj) { usersMap[key] = usersObj[key].username || usersObj[key].email || 'Unknown'; }
    }
    payments = payments.map(p => ({ ...p, username: usersMap[p.userId] || 'Unknown' }));
    if (req.user.role === 'user') payments = payments.filter(p => p.userId === req.user.id);
    return successResponse(res, 'Payments fetched successfully', payments);
  } catch (error) { next(error); }
};

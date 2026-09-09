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
    // 1. IDEMPOTENCY CHECK
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
      // Idempotency key already used. Return the original payment.
      const existingSnap = await idempotencyRef.get();
      const existingPaymentId = existingSnap.val().paymentId;
      if (existingPaymentId) {
        const paymentSnap = await getRef(`payments/${existingPaymentId}`).get();
        if (paymentSnap.exists()) {
          const p = paymentSnap.val();
          // Restore exact original response format
          if (p.method === 'card' && p.redirectUrl) {
            return successResponse(res, 'Card payment already initiated', { paymentId: p.id, reference: p.gatewayReference, redirect_url: p.redirectUrl }, 200);
          }
          return successResponse(res, 'Payment already initiated', p, 200);
        }
      }
      return errorResponse(res, 'A deposit request is already being processed. Please wait.', 200);
    }

    // ==========================================
    // 2. VALIDATION & LOCKS
    // ==========================================
    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      return errorResponse(res, 'Amount must be a valid number greater than 0', 400);
    }
    if ((method === 'mtn' || method === 'airtel') && !phoneNumber) {
      return errorResponse(res, 'Phone number is required', 400);
    }

    const bonus = 0.05;
    const totalCredit = parseFloat(parsedAmount) + bonus;
    
    // ACTIVE DEPOSIT LOCK (Anti-Double Click for Mobile Money)
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

    // ==========================================
    // 3. PREPARE & ATOMICALLY SAVE PAYMENT RECORD
    // ==========================================
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
    
    // Save payment record AND link idempotency key atomically
    const updates = {};
    updates[`payments/${paymentId}`] = paymentData;
    updates[`transactions/${paymentId}`] = { id: paymentId, userId, type: 'deposit', amount: totalCredit, status: 'pending', date: new Date().toISOString() };
    updates[`paymentIdempotency/${userId}/${idempotencyKey}/paymentId`] = paymentId;
    await getRef().update(updates);

    // ==========================================
    // 4. CALL GATEWAY
    // ==========================================
    // PATH 2: CARD PAYMENTS (MARZPAY)
    if (method === 'card') {
      try {
        const MARZPAY_API_URL = process.env.MARZPAY_API_URL || 'https://wallet.wearemarz.com/api/v1';
        const MARZPAY_API_CREDENTIALS = process.env.MARZPAY_API_CREDENTIALS;
        const MARZPAY_CALLBACK_URL = process.env.MARZPAY_CALLBACK_URL;

        if (!MARZPAY_API_CREDENTIALS) throw new Error('MarzPay API credentials missing.');

        const response = await fetch(`${MARZPAY_API_URL}/collect-money`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Basic ${MARZPAY_API_CREDENTIALS}` },
          body: JSON.stringify({ amount: amountInUGX, method: "card", reference: paymentId, country: "UG", description: "SMMMARIA Wallet Deposit", callback_url: MARZPAY_CALLBACK_URL })
        });
        const result = await response.json();

        if (!response.ok || !result.data || !result.data.redirect_url) throw new Error(result.message || 'MarzPay did not return redirect URL.');

        // Update payment with gateway success data
        await getRef(`payments/${paymentId}`).update({
          gateway: "marzpay",
          gatewayReference: paymentId, // Deterministic reference
          redirectUrl: result.data.redirect_url
        });

        return successResponse(res, 'Card payment initiated', { paymentId, reference: paymentId, redirect_url: result.data.redirect_url }, 201);
      } catch (apiError) {
        await getRef(`payments/${paymentId}`).update({ status: 'rejected', failureReason: apiError.message });
        await getRef(`transactions/${paymentId}`).update({ status: 'rejected' });
        return errorResponse(res, `Card payment failed: ${apiError.message}`, 400);
      }
    }

    // PATH 3: MTN & AIRTEL (PESAJET)
    if (method === 'mtn' || method === 'airtel') {
      try {
        let formattedPhone = phoneNumber.replace(/\s+/g, '').replace(/^\+/, '');
        if (formattedPhone.startsWith('0')) formattedPhone = '256' + formattedPhone.substring(1);
        else if (!formattedPhone.startsWith('256')) formattedPhone = '256' + formattedPhone;
        formattedPhone = '+' + formattedPhone;

        let gatewayPayload = { type: "COLLECTION", amount: amountInUGX, currency: "UGX", phoneNumber: formattedPhone, provider: method, reference: paymentId.replace(/-/g, '') };

        let gatewayResponse;
        try {
            gatewayResponse = await processPesaJetPayment(gatewayPayload);
            const gatewayRef = gatewayResponse.transactionId || gatewayResponse.id || gatewayPayload.reference;
            
            // Update payment with gateway success data
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
      const paymentKey = Object.keys(snapshot.val())[0];
      const payment = snapshot.val()[paymentKey];

      if (payment.gateway !== 'pesajet') return res.status(200).send('Ignored: Not PesaJet');

      if (status === 'SUCCESS' || status === 'COMPLETED' || status === 'SUCCESSFUL') {
        await settlePayment(paymentKey, 'pesajet_webhook');
      } else if (status === 'FAILED' || status === 'CANCELLED' || status === 'EXPIRED') {
        // Atomically reject if pending OR processing
        await getRef(`payments/${paymentKey}`).transaction((p) => {
            if (p && (p.status === 'pending' || p.status === 'processing')) { 
                p.status = 'rejected'; 
                p.failureReason = status; 
                return p; 
            }
            return;
        });
        await getRef(`transactions/${paymentKey}`).update({ status: 'rejected' });
        if (payment.userId) await getRef(`users/${payment.userId}/activeDeposit`).remove();
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

    const paymentKey = Object.keys(snapshot.val())[0];
    const payment = snapshot.val()[paymentKey];
    if (payment.gateway !== 'marzpay') return res.status(200).send('Ignored: Not MarzPay');

    if (event_type === "collection.completed" || collection.status === "completed") {
      await settlePayment(paymentKey, 'marzpay_webhook');
    } else if (event_type === "collection.failed" || collection.status === "failed") {
      // Atomically reject if pending OR processing
      await getRef(`payments/${paymentKey}`).transaction((p) => {
          if (p && (p.status === 'pending' || p.status === 'processing')) { 
              p.status = 'rejected'; 
              p.failureReason = collection.status; 
              return p; 
          }
          return;
      });
      await getRef(`transactions/${paymentKey}`).update({ status: 'rejected' });
      if (payment.userId) await getRef(`users/${payment.userId}/activeDeposit`).remove();
    }
    return res.status(200).send('Webhook received');
  } catch (error) { next(error); }
};

// ==========================================
// CRON JOB FUNCTION (Reconciliation & Recovery)
// ==========================================
export const checkPendingPayments = async () => {
  try {
    // 1. Settlement Recovery: Find stale 'processing' payments
    const processingSnap = await getRef('payments').orderByChild('status').equalTo('processing').get();
    if (processingSnap.exists()) {
      const processingPayments = Object.values(processingSnap.val());
      for (const payment of processingPayments) {
        const age = Date.now() - (payment.processingStartedAt || 0);
        if (age > 120000) { 
           logger.info(`[Cron Recovery] Found stale processing payment ${payment.id}. Retrying settlement.`);
           await settlePayment(payment.id, 'cron_recovery');
        }
      }
    }
    
    // 2. Gateway Confirmation: Poll PesaJet for 'pending' MTN/Airtel payments
    const pendingSnap = await getRef('payments').orderByChild('status').equalTo('pending').get();
    if (!pendingSnap.exists()) return;

    const pendingPayments = Object.values(pendingSnap.val());
    for (const payment of pendingPayments) {
      if (payment.gatewayReference && payment.gatewayReference !== 'N/A' && payment.gatewayReference.length > 20) {
        const response = await fetch(`${process.env.PESAJET_API_URL}/${payment.gatewayReference}`, { headers: { 'X-API-KEY': process.env.PESAJET_API_KEY } });
        const result = await response.json();
        if (result.status === 'SUCCESS' || result.status === 'COMPLETED') {
          logger.info(`[Cron Reconciliation] Gateway confirmed payment ${payment.id}. Settling.`);
          await settlePayment(payment.id, 'cron_reconciliation');
        }
      }
    }
  } catch (error) { console.error('Cron Error:', error.message); }
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
          return; // Abort if not pending
        });
        
        if (cancelRes.committed) {
          updates[`transactions/${key}/status`] = 'cancelled';
          cancelledCount++;
        } else {
          // If transaction aborted, check what state it actually is in
          const currentStatus = cancelRes.snapshot.val()?.status;
          if (currentStatus === 'processing' || currentStatus === 'completed') {
            alreadyProcessedCount++;
          }
        }
      }
    }

    if (cancelledCount > 0) {
      updates[`users/${userId}/activeDeposit`] = null; // Release lock
      await getRef().update(updates);
      return successResponse(res, 'Pending deposit cancelled successfully.');
    } else if (alreadyProcessedCount > 0) {
      // The payment was already processing or completed by the gateway/webhook.
      // We cannot cancel it, but we tell the frontend it's safe to remove the button.
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

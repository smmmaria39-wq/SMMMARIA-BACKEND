// ===============================================
// Payment Controller
// ===============================================

import { getRef } from '../database/firebase.js';
import { generateUUID } from '../utils/helpers.js';
import { successResponse, errorResponse } from '../utils/response.js';
import { logger } from '../utils/logger.js';

// Exchange Rate: 1 USD = 3930 UGX (Updated rate)
const USD_TO_UGX_RATE = 3930;

// ==========================================
// HELPER: Process MTN/Airtel via PesaJet API
// ==========================================
const processPesaJetPayment = async (payload) => {
  const PESAJET_API_KEY = process.env.PESAJET_API_KEY;
  const PESAJET_API_URL = process.env.PESAJET_API_URL || 'https://api.pesajet.com/v1/transactions';

  if (!PESAJET_API_KEY) {
    throw new Error('PesaJet API key is not configured in Railway.');
  }

  const response = await fetch(PESAJET_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': PESAJET_API_KEY
    },
    body: JSON.stringify(payload)
  });

  const responseText = await response.text();
  
  try {
    const result = JSON.parse(responseText);
    if (!response.ok) {
      throw new Error(result.message || 'PesaJet API declined the transaction.');
    }
    return result;
  } catch (e) {
    throw new Error(`PesaJet Error: ${responseText}`);
  }
};

// ==========================================
// HELPER: Atomic & Idempotent Payment Approval
// ==========================================
const processPaymentApproval = async (paymentKey, paymentData, extraUpdates = {}) => {
  const paymentRef = getRef(`payments/${paymentKey}`);
  
  const result = await paymentRef.transaction((currentPayment) => {
    if (currentPayment && currentPayment.status === 'pending') {
      currentPayment.status = 'approved';
      currentPayment.approvedAt = new Date().toISOString();
      
      for (const key in extraUpdates) {
        currentPayment[key] = extraUpdates[key];
      }
      
      return currentPayment; 
    }
    return; 
  });

  if (!result.committed) {
    return false; 
  }

  await getRef(`transactions/${paymentKey}`).update({ status: 'approved' });
  
  const userBalanceRef = getRef(`users/${paymentData.userId}/balance`);
  await userBalanceRef.transaction((currentBalance) => {
    return (currentBalance || 0) + paymentData.totalCredit;
  });

  return true; 
};

/**
 * @desc    Create a deposit request (Manual or Automated API)
 * @route   POST /api/v1/payments/deposit
 * @access  Private
 */
export const createDeposit = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { amount, method, email, phoneNumber } = req.body;
    
    if (amount <= 0) {
      return errorResponse(res, 'Amount must be greater than 0', 400);
    }

    const bonus = 0.20;
    const totalCredit = parseFloat(amount) + bonus;
    
    // ==========================================
    // ANTI-DOUBLE SUBMISSION CHECK (MTN/AIRTEL)
    // ==========================================
    if (method === 'mtn' || method === 'airtel') {
      const userPaymentsSnap = await getRef('payments').orderByChild('userId').equalTo(userId).get();
      const fiveMinsAgo = Date.now() - (5 * 60 * 1000);
      
      let hasRecentPending = false;
      const updates = {};
      
      if (userPaymentsSnap.exists()) {
        const userPayments = Object.values(userPaymentsSnap.val());
        
        userPayments.forEach(p => {
          if (p.status === 'pending' && (p.method === 'mtn' || p.method === 'airtel')) {
            const createdAtTime = new Date(p.createdAt).getTime();
            
            if (createdAtTime > fiveMinsAgo) {
              // It's less than 5 minutes old, block the new deposit
              hasRecentPending = true;
            } else {
              // It's older than 5 minutes, automatically cancel it so they can try again
              updates[`payments/${p.id}/status`] = 'cancelled';
              updates[`payments/${p.id}/failureReason`] = 'Timed out (older than 5 mins)';
              updates[`payments/${p.id}/cancelledAt`] = new Date().toISOString();
              updates[`transactions/${p.id}/status`] = 'cancelled';
            }
          }
        });
        
        // Apply the cancellations to the database
        if (Object.keys(updates).length > 0) {
          await getRef().update(updates);
        }
      }
      
      if (hasRecentPending) {
        return errorResponse(res, 'You already have a pending Mobile Money deposit. Please wait 5 minutes for it to expire, or use the Cancel button on the wallet page.', 400);
      }
    }

    const paymentId = generateUUID();
    const paymentData = {
      id: paymentId,
      userId,
      amount: parseFloat(amount),
      bonus: bonus,
      totalCredit: totalCredit,
      method,
      status: 'pending',
      createdAt: new Date().toISOString()
    };

    // PATH 2: CARD PAYMENTS (MARZPAY INTEGRATION)
    if (method === 'card') {
      try {
        const MARZPAY_API_URL = process.env.MARZPAY_API_URL || 'https://wallet.wearemarz.com/api/v1';
        const MARZPAY_API_CREDENTIALS = process.env.MARZPAY_API_CREDENTIALS;
        const MARZPAY_CALLBACK_URL = process.env.MARZPAY_CALLBACK_URL;

        if (!MARZPAY_API_CREDENTIALS) {
          throw new Error('MarzPay API credentials are not configured.');
        }

        const amountInUGX = Math.round(parseFloat(amount) * USD_TO_UGX_RATE);
        const marzpayReference = generateUUID();

        const marzpayPayload = {
          amount: amountInUGX,
          method: "card",
          reference: marzpayReference,
          country: "UG",
          description: "SMMMARIA Wallet Deposit",
          callback_url: MARZPAY_CALLBACK_URL
        };

        const response = await fetch(`${MARZPAY_API_URL}/collect-money`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Basic ${MARZPAY_API_CREDENTIALS}`
          },
          body: JSON.stringify(marzpayPayload)
        });

        const result = await response.json();

        if (!response.ok || !result.data || !result.data.redirect_url) {
          throw new Error(result.message || 'MarzPay did not return a redirect URL.');
        }

        const redirectUrl = result.data.redirect_url;
        const marzpayTransactionId = result.data.transaction ? result.data.transaction.uuid : null;

        paymentData.gateway = "marzpay";
        paymentData.gatewayReference = marzpayReference;
        paymentData.marzpayTransactionId = marzpayTransactionId;
        paymentData.amountUGX = amountInUGX;

        await getRef(`payments/${paymentId}`).set(paymentData);
        await getRef(`transactions/${paymentId}`).set({
          id: paymentId, userId, type: 'deposit', amount: totalCredit, status: 'pending', date: new Date().toISOString()
        });

        return successResponse(res, 'Card payment initiated successfully', {
          paymentId,
          reference: marzpayReference,
          redirect_url: redirectUrl
        }, 201);

      } catch (apiError) {
        paymentData.status = 'rejected';
        paymentData.failureReason = apiError.message;
        paymentData.gateway = "marzpay";
        await getRef(`payments/${paymentId}`).set(paymentData);
        return errorResponse(res, `Card payment failed: ${apiError.message}`, 400);
      }
    }

    // PATH 3: AUTOMATED API (MTN & Airtel)
    if (method === 'mtn' || method === 'airtel') {
      try {
        if (!phoneNumber) return errorResponse(res, 'Phone number is required', 400);
        
        const amountInUGX = Math.round(parseFloat(amount) * USD_TO_UGX_RATE);
        
        let formattedPhone = phoneNumber.replace(/\s+/g, '').replace(/^\+/, '');
        if (formattedPhone.startsWith('0')) {
          formattedPhone = '256' + formattedPhone.substring(1);
        } else if (!formattedPhone.startsWith('256')) {
          formattedPhone = '256' + formattedPhone;
        }
        formattedPhone = '+' + formattedPhone;

        let gatewayPayload = { 
          type: "COLLECTION", 
          amount: amountInUGX, 
          currency: "UGX",
          phoneNumber: formattedPhone,
          provider: method.toUpperCase() // FIX: Send 'MTN' and 'AIRTEL' in uppercase
        };

        const gatewayResponse = await processPesaJetPayment(gatewayPayload);
        
        paymentData.gatewayReference = gatewayResponse.transactionId || gatewayResponse.id || 'N/A';
        
        await getRef(`payments/${paymentId}`).set(paymentData);
        await getRef(`transactions/${paymentId}`).set({
          id: paymentId, userId, type: 'deposit', amount: totalCredit, status: 'pending', date: new Date().toISOString()
        });

        return successResponse(res, 'Payment request sent to your phone. Please approve the prompt to complete the deposit.', paymentData, 201);

      } catch (apiError) {
        paymentData.status = 'rejected';
        paymentData.failureReason = apiError.message;
        await getRef(`payments/${paymentId}`).set(paymentData);
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
    
    if (!transactionId) {
      return res.status(400).send('Transaction ID is required');
    }

    const snapshot = await getRef('payments').orderByChild('gatewayReference').equalTo(transactionId).get();
    
    if (snapshot.exists()) {
      const paymentKey = Object.keys(snapshot.val())[0];
      const payment = snapshot.val()[paymentKey];

      if (status === 'SUCCESS' || status === 'COMPLETED' || status === 'SUCCESSFUL') {
        const credited = await processPaymentApproval(paymentKey, payment);
        if (credited) logger.success(`Webhook: Payment ${paymentKey} approved automatically. Credited $${payment.totalCredit}`);
      } else if (status === 'FAILED' || status === 'CANCELLED' || status === 'REJECTED' || status === 'EXPIRED') {
        await getRef(`payments/${paymentKey}`).update({ status: 'rejected', failureReason: status });
        await getRef(`transactions/${paymentKey}`).update({ status: 'rejected' });
        logger.warn(`Webhook: Payment ${paymentKey} marked as ${status}`);
      }
    }

    return res.status(200).send('Webhook received');
  } catch (error) {
    next(error);
  }
};

// ==========================================
// MARZPAY WEBHOOK 
// ==========================================
export const marzPayWebhook = async (req, res, next) => {
  try {
    const { event_type, collection } = req.body;
    
    if (!collection || !collection.reference) {
      return res.status(400).send('Invalid MarzPay webhook payload: Missing collection reference.');
    }

    const reference = collection.reference;
    const snapshot = await getRef('payments').orderByChild('gatewayReference').equalTo(reference).get();
    
    if (!snapshot.exists()) {
      logger.warn(`MarzPay Webhook: Payment not found for reference ${reference}`);
      return res.status(200).send('Payment not found');
    }

    const paymentKey = Object.keys(snapshot.val())[0];
    const payment = snapshot.val()[paymentKey];

    if (payment.gateway !== 'marzpay') return res.status(200).send('Ignored: Not a MarzPay payment');

    const isSuccess = (event_type === "collection.completed" || collection.status === "completed");
    const isFailed = (event_type === "collection.failed" || collection.status === "failed");

    if (isSuccess) {
      const extraUpdates = { providerTransactionId: collection.provider_transaction_id || null };
      const credited = await processPaymentApproval(paymentKey, payment, extraUpdates);
      if (credited) logger.success(`MarzPay Webhook: Payment ${paymentKey} approved automatically. Credited $${payment.totalCredit}`);
    } else if (isFailed) {
      await getRef(`payments/${paymentKey}`).update({ status: 'rejected', failureReason: collection.status || 'Failed' });
      await getRef(`transactions/${paymentKey}`).update({ status: 'rejected' });
      logger.warn(`MarzPay Webhook: Payment ${paymentKey} marked as ${collection.status}`);
    }

    return res.status(200).send('Webhook received');
  } catch (error) {
    next(error);
  }
};

// ==========================================
// CRON JOB FUNCTION 
// ==========================================
export const checkPendingPayments = async () => {
  try {
    const PESAJET_API_KEY = process.env.PESAJET_API_KEY;
    const PESAJET_API_URL = process.env.PESAJET_API_URL || 'https://api.pesajet.com/v1/transactions';

    const snapshot = await getRef('payments').orderByChild('status').equalTo('pending').get();
    if (!snapshot.exists()) return;

    const pendingPayments = Object.values(snapshot.val());
    
    for (const payment of pendingPayments) {
      if (payment.gatewayReference && payment.gatewayReference !== 'N/A') {
        
        const response = await fetch(`${PESAJET_API_URL}/${payment.gatewayReference}`, {
          headers: { 'X-API-KEY': PESAJET_API_KEY }
        });
        const result = await response.json();

        if (result.status === 'SUCCESS' || result.status === 'COMPLETED' || result.status === 'SUCCESSFUL') {
          const credited = await processPaymentApproval(payment.id, payment);
          if (credited) logger.success(`Cron Job: Auto-approved pending payment ${payment.id}`);
        } else if (result.status === 'FAILED' || result.status === 'EXPIRED' || result.status === 'CANCELLED') {
          await getRef(`payments/${payment.id}`).update({ status: 'rejected', failureReason: result.status });
          await getRef(`transactions/${payment.id}`).update({ status: 'rejected' });
          logger.warn(`Cron Job: Rejected expired/failed payment ${payment.id}`);
        }
      }
    }
  } catch (error) {
    console.error('Error checking pending payments:', error.message);
  }
};

// ==========================================
// ADMIN FUNCTIONS 
// ==========================================
export const approvePayment = async (req, res, next) => {
  try {
    const { id } = req.params;
    const paymentRef = getRef(`payments/${id}`);
    const paymentSnapshot = await paymentRef.get();
    
    if (!paymentSnapshot.exists()) return errorResponse(res, 'Payment not found', 404);
    
    const payment = paymentSnapshot.val();
    if (payment.status === 'approved') return errorResponse(res, 'Payment already approved', 400);
    
    const credited = await processPaymentApproval(id, payment);
    if (!credited) return errorResponse(res, 'Payment already approved automatically', 400);
    
    return successResponse(res, 'Payment approved and wallet credited successfully');
  } catch (error) {
    next(error);
  }
};

export const rejectPayment = async (req, res, next) => {
  try {
    const { id } = req.params;
    const paymentRef = getRef(`payments/${id}`);
    const paymentSnapshot = await paymentRef.get();
    
    if (!paymentSnapshot.exists()) return errorResponse(res, 'Payment not found', 404);
    
    await paymentRef.update({ status: 'rejected', rejectedAt: new Date().toISOString() });
    await getRef(`transactions/${id}`).update({ status: 'rejected' });
    
    return successResponse(res, 'Payment rejected successfully');
  } catch (error) {
    next(error);
  }
};

// ==========================================
// USER CANCEL PENDING DEPOSIT
// ==========================================
export const cancelPendingDeposit = async (req, res, next) => {
  try {
    const userId = req.user.id;
    
    // Find any pending MTN/Airtel payments for this user
    const snapshot = await getRef('payments').orderByChild('userId').equalTo(userId).get();
    
    if (!snapshot.exists()) {
      return errorResponse(res, 'No pending deposits found to cancel.', 404);
    }

    const userPayments = snapshot.val();
    let cancelledCount = 0;
    const updates = {};
    const PESAJET_API_URL = process.env.PESAJET_API_URL || 'https://api.pesajet.com/v1/transactions';
    const PESAJET_API_KEY = process.env.PESAJET_API_KEY;

    for (const key in userPayments) {
      const payment = userPayments[key];
      if (payment.status === 'pending' && (payment.method === 'mtn' || payment.method === 'airtel')) {
        
        // 1. Attempt to cancel on PesaJet side to stop the phone prompts
        if (payment.gatewayReference && payment.gatewayReference !== 'N/A' && PESAJET_API_KEY) {
          try {
            await fetch(`${PESAJET_API_URL}/${payment.gatewayReference}/cancel`, {
              method: 'POST',
              headers: { 'X-API-KEY': PESAJET_API_KEY }
            });
          } catch (e) {
            // Ignore if PesaJet cancel fails, we still mark as cancelled locally
          }
        }
        
        // 2. Mark as cancelled in our database
        updates[`payments/${key}/status`] = 'cancelled';
        updates[`payments/${key}/failureReason`] = 'Cancelled by user';
        updates[`payments/${key}/cancelledAt`] = new Date().toISOString();
        updates[`transactions/${key}/status`] = 'cancelled';
        cancelledCount++;
      }
    }

    if (cancelledCount > 0) {
      await getRef().update(updates);
      return successResponse(res, 'Pending deposit cancelled successfully. You can try again now.');
    } else {
      return errorResponse(res, 'No pending MTN/Airtel deposits found to cancel.', 404);
    }
  } catch (error) {
    next(error);
  }
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
        usersMap[key] = usersObj[key].username || usersObj[key].email || 'Unknown User';
      }
    }

    payments = payments.map(p => ({
      ...p,
      username: usersMap[p.userId] || 'Unknown User'
    }));

    if (req.user.role === 'user') {
      payments = payments.filter(p => p.userId === req.user.id);
    }
    
    return successResponse(res, 'Payments fetched successfully', payments);
  } catch (error) {
    next(error);
  }
};

// ===============================================
// Payment Controller
// ===============================================

import { getRef } from '../database/firebase.js';
import { generateUUID } from '../utils/helpers.js';
import { successResponse, errorResponse } from '../utils/response.js';
import { logger } from '../utils/logger.js';

// Exchange Rate: 1 USD = 3730 UGX (You can adjust this rate in the future)
const USD_TO_UGX_RATE = 3730;

// ==========================================
// HELPER: Process MTN/Airtel via PesaJet API
// ==========================================
const processPesaJetPayment = async (payload) => {
  const PESAJET_API_KEY = process.env.PESAJET_API_KEY;
  const PESAJET_API_URL = process.env.PESAJET_API_URL || 'https://api.pesajet.com/v1/transactions';

  if (!PESAJET_API_KEY) {
    throw new Error('PesaJet API key is not configured in Railway.');
  }

  console.log("Sending to PesaJet:", JSON.stringify(payload));

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

    // Flat $0.20 bonus logic
    const bonus = 0.20;
    const totalCredit = parseFloat(amount) + bonus;
    
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

    // ==========================================
    // PATH 1: MANUAL UPLOAD (Admin Approval Flow)
    // ==========================================
    if (method === 'manual') {
      await getRef(`payments/${paymentId}`).set(paymentData);
      await getRef(`transactions/${paymentId}`).set({
        id: paymentId,
        userId,
        type: 'deposit',
        amount: totalCredit,
        status: 'pending',
        date: new Date().toISOString()
      });
      
      logger.info(`Manual deposit request created: ${paymentId} for user ${userId}`);
      return successResponse(res, 'Deposit request created. Awaiting admin approval.', paymentData, 201);
    }

    // ==========================================
    // PATH 2: CARD PAYMENTS (Disabled for now)
    // ==========================================
    if (method === 'card') {
      return errorResponse(res, 'Card payments are temporarily disabled. Please use MTN or Airtel Mobile Money.', 400);
    }

    // ==========================================
    // PATH 3: AUTOMATED API (MTN & Airtel via PesaJet)
    // ==========================================
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

        // Construct payload exactly as PesaJet documentation requests
        let gatewayPayload = { 
          type: "COLLECTION", 
          amount: amountInUGX, 
          currency: "UGX",
          phoneNumber: formattedPhone,
          provider: method // <--- ADDED THIS: Sends "mtn" or "airtel" to PesaJet
        };

        const gatewayResponse = await processPesaJetPayment(gatewayPayload);
        
        paymentData.gatewayReference = gatewayResponse.transactionId || gatewayResponse.id || 'N/A';
        
        await getRef(`payments/${paymentId}`).set(paymentData);
        await getRef(`transactions/${paymentId}`).set({
          id: paymentId,
          userId,
          type: 'deposit',
          amount: totalCredit,
          status: 'pending',
          date: new Date().toISOString()
        });

        logger.info(`PesaJet Collection initiated: ${paymentId}. Waiting for user to approve phone prompt.`);
        return successResponse(res, 'Payment request sent to your phone. Please approve the prompt to complete the deposit.', paymentData, 201);

      } catch (apiError) {
        logger.error(`PesaJet API Error: ${apiError.message}`);
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

/**
 * @desc    Admin: Approve MANUAL payment and credit wallet atomically (with bonus)
 * @route   PUT /api/v1/payments/:id/approve
 * @access  Private/Admin
 */
export const approvePayment = async (req, res, next) => {
  try {
    const { id } = req.params;
    const paymentRef = getRef(`payments/${id}`);
    const paymentSnapshot = await paymentRef.get();
    
    if (!paymentSnapshot.exists()) {
      return errorResponse(res, 'Payment not found', 404);
    }
    
    const payment = paymentSnapshot.val();
    
    if (payment.status === 'approved') {
      return errorResponse(res, 'Payment already approved', 400);
    }
    
    await paymentRef.update({ status: 'approved', approvedAt: new Date().toISOString() });
    await getRef(`transactions/${id}`).update({ status: 'approved' });
    
    const userBalanceRef = getRef(`users/${payment.userId}/balance`);
    await userBalanceRef.transaction((currentBalance) => {
      const creditAmount = payment.totalCredit || (parseFloat(payment.amount) + 0.20);
      return (currentBalance || 0) + creditAmount;
    });
    
    logger.success(`Payment ${id} approved. Credited to user ${payment.userId}`);
    return successResponse(res, 'Payment approved and wallet credited successfully');
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Admin: Reject payment
 * @route   PUT /api/v1/payments/:id/reject
 * @access  Private/Admin
 */
export const rejectPayment = async (req, res, next) => {
  try {
    const { id } = req.params;
    const paymentRef = getRef(`payments/${id}`);
    const paymentSnapshot = await paymentRef.get();
    
    if (!paymentSnapshot.exists()) {
      return errorResponse(res, 'Payment not found', 404);
    }
    
    await paymentRef.update({ status: 'rejected', rejectedAt: new Date().toISOString() });
    await getRef(`transactions/${id}`).update({ status: 'rejected' });
    
    logger.warn(`Payment ${id} rejected.`);
    return successResponse(res, 'Payment rejected successfully');
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get all payments (Admin) or user specific payments
 * @route   GET /api/v1/payments
 * @access  Private
 */
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

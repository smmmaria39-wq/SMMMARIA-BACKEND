// ===============================================
// Payment Controller
// ===============================================

import { getRef } from '../database/firebase.js';
import { generateUUID } from '../utils/helpers.js';
import { successResponse, errorResponse } from '../utils/response.js';
import { logger } from '../utils/logger.js';

// Exchange Rate: 1 USD = 3730 UGX (You can adjust this rate in the future)
const USD_TO_UGX_RATE = 3730;

// Helper function to call WearAmaze API
const processWearAmazePayment = async (payload) => {
  // We will use the Base64 Authorization Header from your Railway variables
  const WEARAMAZE_AUTH = process.env.WEARAMAZE_BASE64_AUTH;
  // Updated to the correct collect-money endpoint
  const WEARAMAZE_API_URL = process.env.WEARAMAZE_API_URL || 'https://wallet.wearemarz.com/api/v1/collect-money'; 

  if (!WEARAMAZE_AUTH) {
    throw new Error('WearAmaze API credentials are not configured in Railway.');
  }

  const response = await fetch(WEARAMAZE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Basic ${WEARAMAZE_AUTH}`
    },
    body: JSON.stringify(payload)
  });

  const result = await response.json();

  if (!response.ok || result.status !== 'success') {
    throw new Error(result.message || 'Payment gateway declined the transaction.');
  }

  return result; // Contains gateway reference/transaction ID
};

/**
 * @desc    Create a deposit request (Manual or Automated API)
 * @route   POST /api/v1/payments/deposit
 * @access  Private
 */
export const createDeposit = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { amount, method, phoneNumber, cardNumber, cardExpiry, cardCvv } = req.body;
    
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
      amount: parseFloat(amount), // Keep in USD for your internal records
      bonus: bonus,
      totalCredit: totalCredit,
      method,
      status: 'pending', // Starts as pending
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
        amount: totalCredit, // Store the total credited amount in ledger
        status: 'pending',
        date: new Date().toISOString()
      });
      
      logger.info(`Manual deposit request created: ${paymentId} for user ${userId}`);
      return successResponse(res, 'Deposit request created. Awaiting admin approval.', paymentData, 201);
    }

    // ==========================================
    // PATH 2: AUTOMATED API (MTN, Airtel, Card)
    // ==========================================
    try {
      // Convert USD amount to UGX for the WearAmaze API
      const amountInUGX = Math.round(parseFloat(amount) * USD_TO_UGX_RATE);

      // Generate a unique reference for the gateway
      const gatewayReference = `SMMMARIA-${paymentId.substring(0, 8)}`;

      // Construct payload for WearAmaze based on method
      let gatewayPayload = { 
        amount: amountInUGX, 
        currency: "UGX",
        reference: gatewayReference,
        description: "Wallet Deposit"
      };
      
      if (method === 'mtn' || method === 'airtel') {
        if (!phoneNumber) return errorResponse(res, 'Phone number is required', 400);
        
        // Format phone number to 256XXXXXXXXX
        let formattedPhone = phoneNumber.replace(/\s+/g, '').replace(/^\+/, '');
        if (formattedPhone.startsWith('0')) {
          formattedPhone = '256' + formattedPhone.substring(1);
        } else if (!formattedPhone.startsWith('256')) {
          formattedPhone = '256' + formattedPhone;
        }
        
        gatewayPayload.phoneNumber = formattedPhone;
        gatewayPayload.network = method; // Some APIs prefer "network" over "method"
      } else if (method === 'card') {
        if (!cardNumber || !cardExpiry || !cardCvv) return errorResponse(res, 'Card details are required', 400);
        gatewayPayload.cardNumber = cardNumber;
        gatewayPayload.cardExpiry = cardExpiry;
        gatewayPayload.cardCvv = cardCvv;
      }

      // Call WearAmaze API with UGX amount
      const gatewayResponse = await processWearAmazePayment(gatewayPayload);

      // If API succeeds, update payment data to approved
      paymentData.status = 'approved';
      paymentData.gatewayReference = gatewayResponse.transactionId || gatewayReference;

      // Save to Firebase (Internal records stay in USD)
      await getRef(`payments/${paymentId}`).set(paymentData);
      await getRef(`transactions/${paymentId}`).set({
        id: paymentId,
        userId,
        type: 'deposit',
        amount: totalCredit,
        status: 'approved',
        date: new Date().toISOString()
      });

      // Atomically Credit User Wallet (Amount + $0.20 Bonus)
      const userBalanceRef = getRef(`users/${userId}/balance`);
      await userBalanceRef.transaction((currentBalance) => {
        return (currentBalance || 0) + totalCredit;
      });

      logger.success(`Automated deposit successful: ${paymentId} for user ${userId}. Credited $${totalCredit}`);
      return successResponse(res, 'Deposit successful! Wallet credited automatically.', paymentData, 201);

    } catch (apiError) {
      logger.error(`WearAmaze API Error: ${apiError.message}`);
      // Save failed attempt for records
      paymentData.status = 'rejected';
      paymentData.failureReason = apiError.message;
      await getRef(`payments/${paymentId}`).set(paymentData);
      
      return errorResponse(res, `Payment failed: ${apiError.message}`, 400);
    }
    
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
    
    // 1. Update Payment Status to Approved
    await paymentRef.update({ status: 'approved', approvedAt: new Date().toISOString() });
    
    // 2. Update Transaction Status
    await getRef(`transactions/${id}`).update({ status: 'approved' });
    
    // 3. Atomically Credit User Wallet with Amount + Bonus
    const userBalanceRef = getRef(`users/${payment.userId}/balance`);
    await userBalanceRef.transaction((currentBalance) => {
      // Use totalCredit if it exists, otherwise fallback to amount + 0.20 (for old records)
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
    
    // If not admin, filter to only show the user's payments
    if (req.user.role === 'user') {
      payments = payments.filter(p => p.userId === req.user.id);
    }
    
    return successResponse(res, 'Payments fetched successfully', payments);
  } catch (error) {
    next(error);
  }
};

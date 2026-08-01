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
  const PESAJET_API_URL = process.env.PESAJET_API_URL || 'https://api.pesajet.com/v1/collections'; // Update to exact PesaJet endpoint

  if (!PESAJET_API_KEY) {
    throw new Error('PesaJet API credentials are not configured in Railway.');
  }

  // Log the exact payload being sent so we can see it in Railway logs
  console.log("Sending to PesaJet:", JSON.stringify(payload));

  const response = await fetch(PESAJET_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${PESAJET_API_KEY}` // PesaJet typically uses Bearer tokens
    },
    body: JSON.stringify(payload)
  });

  const result = await response.json();

  if (!response.ok || result.status !== 'success') {
    throw new Error(result.message || 'PesaJet API declined the transaction.');
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
    const { amount, method, email, phoneNumber, cardNumber, cardExpiry, cardCvv } = req.body;
    
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
        
        // Convert USD amount to UGX for the PesaJet API
        const amountInUGX = Math.round(parseFloat(amount) * USD_TO_UGX_RATE);
        
        // Format phone number to 256XXXXXXXXX
        let formattedPhone = phoneNumber.replace(/\s+/g, '').replace(/^\+/, '');
        if (formattedPhone.startsWith('0')) {
          formattedPhone = '256' + formattedPhone.substring(1);
        } else if (!formattedPhone.startsWith('256')) {
          formattedPhone = '256' + formattedPhone;
        }

        // Construct payload for PesaJet based on standard API structures
        let gatewayPayload = { 
          amount: amountInUGX, 
          currency: "UGX",
          phone_number: formattedPhone,
          network: method === 'mtn' ? "MTN_MOMO" : "AIRTEL_MONEY",
          reference: `SMMMARIA-${paymentId.substring(0, 8)}`, 
          description: "Wallet Deposit", 
          email: email || "support@smmmaria.com",
          callback_url: "https://smmaria.netlify.app/api/v1/payments/webhook" 
        };

        // Call PesaJet API
        const gatewayResponse = await processPesaJetPayment(gatewayPayload);

        // If API succeeds, update payment data to approved
        paymentData.status = 'approved';
        paymentData.gatewayReference = gatewayResponse.transactionId || gatewayResponse.reference || 'N/A';

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
        logger.error(`PesaJet API Error: ${apiError.message}`);
        // Save failed attempt for records
        paymentData.status = 'rejected';
        paymentData.failureReason = apiError.message;
        await getRef(`payments/${paymentId}`).set(paymentData);
        
        return errorResponse(res, `Payment failed: ${apiError.message}`, 400);
      }
    }
    
    // Fallback if an unknown method is sent
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
    
    // Fetch all users to map their names to the payments
    const usersSnapshot = await getRef('users').get();
    const usersMap = {};
    if (usersSnapshot.exists()) {
      const usersObj = usersSnapshot.val();
      for (const key in usersObj) {
        usersMap[key] = usersObj[key].username || usersObj[key].email || 'Unknown User';
      }
    }

    // Attach the username to each payment object
    payments = payments.map(p => ({
      ...p,
      username: usersMap[p.userId] || 'Unknown User'
    }));

    // If not admin, filter to only show the user's payments
    if (req.user.role === 'user') {
      payments = payments.filter(p => p.userId === req.user.id);
    }
    
    return successResponse(res, 'Payments fetched successfully', payments);
  } catch (error) {
    next(error);
  }
};

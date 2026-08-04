// ===============================================
// Child Wallet Controller
// ===============================================

import { getRef } from '../database/firebase.js';
import { generateUUID } from '../utils/helpers.js';
import { successResponse, errorResponse } from '../utils/response.js';

/**
 * @desc    Get reseller transactions (Main panel deposits)
 * @route   GET /api/v1/child-panel/wallet/transactions
 * @access  Private/Reseller
 */
export const getPanelTransactions = async (req, res, next) => {
  try {
    const userId = req.user.id; // Reseller's main user ID
    const snap = await getRef('transactions').orderByChild('userId').equalTo(userId).get();
    
    const transactions = snap.exists() ? Object.values(snap.val()).reverse() : [];
    return successResponse(res, 'Transactions fetched', transactions);
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Submit manual deposit request
 * @route   POST /api/v1/child-panel/wallet/deposit
 * @access  Private/Reseller
 */
export const requestPanelDeposit = async (req, res, next) => {
  try {
    const userId = req.user.id; // Reseller's main user ID
    const { amount, method } = req.body;

    const paymentId = generateUUID();
    await getRef(`payments/${paymentId}`).set({
      id: paymentId,
      userId,
      amount: parseFloat(amount),
      method,
      status: 'pending',
      type: 'reseller_deposit', // Mark so admin knows it's for a reseller wallet
      createdAt: new Date().toISOString()
    });

    return successResponse(res, 'Deposit request submitted successfully', null, 201);
  } catch (error) {
    next(error);
  }
};

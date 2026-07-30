// ===============================================
// Wallet Controller
// ===============================================

import { getRef } from '../database/firebase.js';
import { successResponse, errorResponse } from '../utils/response.js';

/**
 * @desc    Get user's wallet balance and transaction history
 * @route   GET /api/v1/wallet
 * @access  Private
 */
export const getWallet = async (req, res, next) => {
  try {
    const userId = req.user.id;
    
    // 1. Fetch user balance
    const userRef = await getRef(`users/${userId}`).get();
    const balance = userRef.exists() ? userRef.val().balance || 0 : 0;
    
    // 2. Fetch ALL transactions and filter in JS (Bypasses Firebase Index requirement)
    const txSnapshot = await getRef('transactions').get();
    let transactions = [];
    
    if (txSnapshot.exists()) {
      const allTx = txSnapshot.val();
      // Filter for this specific user, add the ID, and reverse (newest first)
      transactions = Object.keys(allTx)
        .filter(key => allTx[key].userId === userId)
        .map(key => ({ id: key, ...allTx[key] }))
        .reverse();
    }
    
    return successResponse(res, 'Wallet data fetched successfully', {
      balance,
      transactions
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Admin manually adjusts a user's wallet balance
 * @route   POST /api/v1/wallet/adjust
 * @access  Private/Admin
 */
export const adjustWallet = async (req, res, next) => {
  try {
    const { userId, amount, action, note } = req.body;

    if (!userId || !amount || !action) {
      return errorResponse(res, 'User ID, amount, and action are required.', 400);
    }

    const numericAmount = parseFloat(amount);
    if (isNaN(numericAmount) || numericAmount <= 0) {
      return errorResponse(res, 'Amount must be a positive number.', 400);
    }

    const userRef = getRef(`users/${userId}`);
    const userSnapshot = await userRef.get();
    
    if (!userSnapshot.exists()) {
      return errorResponse(res, 'User not found.', 404);
    }

    const userData = userSnapshot.val();
    const currentBalance = parseFloat(userData.balance) || 0;

    let newBalance;
    if (action === 'add') {
      newBalance = currentBalance + numericAmount;
    } else if (action === 'subtract') {
      newBalance = currentBalance - numericAmount;
    } else {
      return errorResponse(res, 'Invalid action. Must be "add" or "subtract".', 400);
    }

    await userRef.update({ balance: newBalance });

    const txRef = getRef('transactions').push();
    await txRef.set({
      userId: userId,
      type: action === 'add' ? 'credit' : 'debit',
      amount: numericAmount,
      note: note || 'Manual admin adjustment',
      balanceAfter: newBalance,
      createdAt: Date.now()
    });

    return successResponse(res, 'Wallet adjusted successfully', { newBalance });

  } catch (error) {
    next(error);
  }
};

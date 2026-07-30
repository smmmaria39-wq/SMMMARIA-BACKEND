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
    
    // Fetch user balance
    const userRef = await getRef(`users/${userId}`).get();
    const balance = userRef.exists() ? userRef.val().balance || 0 : 0;
    
    // Fetch user transactions
    const txSnapshot = await getRef('transactions').orderByChild('userId').equalTo(userId).get();
    const transactions = txSnapshot.exists() ? Object.values(txSnapshot.val()).reverse() : [];
    
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

    // 1. Validate inputs
    if (!userId || !amount || !action) {
      return errorResponse(res, 'User ID, amount, and action are required.', 400);
    }

    const numericAmount = parseFloat(amount);
    if (isNaN(numericAmount) || numericAmount <= 0) {
      return errorResponse(res, 'Amount must be a positive number.', 400);
    }

    // 2. Fetch the user from Firebase
    const userRef = getRef(`users/${userId}`);
    const userSnapshot = await userRef.get();
    
    if (!userSnapshot.exists()) {
      return errorResponse(res, 'User not found.', 404);
    }

    const userData = userSnapshot.val();
    const currentBalance = parseFloat(userData.balance) || 0;

    // 3. Calculate new balance
    let newBalance;
    if (action === 'add') {
      newBalance = currentBalance + numericAmount;
    } else if (action === 'subtract') {
      newBalance = currentBalance - numericAmount;
    } else {
      return errorResponse(res, 'Invalid action. Must be "add" or "subtract".', 400);
    }

    // 4. Update Firebase with the new balance
    await userRef.update({ balance: newBalance });

    // 5. Log this transaction in the transactions node
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

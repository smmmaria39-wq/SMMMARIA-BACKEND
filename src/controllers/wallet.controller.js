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
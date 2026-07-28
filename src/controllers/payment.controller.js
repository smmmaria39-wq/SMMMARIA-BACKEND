// ===============================================
// Payment Controller
// ===============================================

import { getRef } from '../database/firebase.js';
import { generateUUID } from '../utils/helpers.js';
import { successResponse, errorResponse } from '../utils/response.js';
import { logger } from '../utils/logger.js';

/**
 * @desc    Create a deposit request (Manual/Gateway placeholder)
 * @route   POST /api/v1/payments/deposit
 * @access  Private
 */
export const createDeposit = async (req, res, next) => {
 try {
  const userId = req.user.id;
  const { amount, method, reference } = req.body;
  
  if (amount <= 0) {
   return errorResponse(res, 'Amount must be greater than 0', 400);
  }
  
  const paymentId = generateUUID();
  
  const paymentData = {
   id: paymentId,
   userId,
   amount: parseFloat(amount),
   method,
   reference: reference || 'N/A',
   status: 'pending', // pending, approved, rejected
   createdAt: new Date().toISOString()
  };
  
  await getRef(`payments/${paymentId}`).set(paymentData);
  await getRef(`transactions/${paymentId}`).set({
   id: paymentId,
   userId,
   type: 'deposit',
   amount: parseFloat(amount),
   status: 'pending',
   date: new Date().toISOString()
  });
  
  logger.info(`Deposit request created: ${paymentId} for user ${userId}`);
  return successResponse(res, 'Deposit request created. Awaiting confirmation.', paymentData, 201);
 } catch (error) {
  next(error);
 }
};

/**
 * @desc    Admin: Approve payment and credit wallet atomically
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
  
  // 3. Atomically Credit User Wallet using Firebase Transactions
  const userBalanceRef = getRef(`users/${payment.userId}/balance`);
  await userBalanceRef.transaction((currentBalance) => {
   return (currentBalance || 0) + payment.amount;
  });
  
  logger.success(`Payment ${id} approved. Credited ${payment.amount} to user ${payment.userId}`);
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
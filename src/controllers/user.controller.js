// ===============================================
// User Controller
// ===============================================

import { getRef } from '../database/firebase.js';
import { successResponse, errorResponse } from '../utils/response.js';
import crypto from 'crypto'; // Import Node.js built-in crypto module

/**
 * @desc    Update user profile
 * @route   PUT /api/v1/users/profile
 * @access  Private
 */
export const updateProfile = async (req, res, next) => {
 try {
  // 1. Added 'fullname' to the destructured body
  const { fullname, username, country, phone } = req.body;
  const userId = req.user.id;
  
  const updates = {};
  // 2. Added fullname to the updates object
  if (fullname) updates.fullname = fullname;
  if (username) updates.username = username;
  if (country) updates.country = country;
  if (phone) updates.phone = phone;
  
  await getRef(`users/${userId}`).update(updates);
  
  // 3. Fetch the updated user to send back to the frontend
  const updatedSnapshot = await getRef(`users/${userId}`).get();
  const updatedUser = updatedSnapshot.val();
  delete updatedUser.password; // Never send password back
  
  return successResponse(res, 'Profile updated successfully', updatedUser);
 } catch (error) {
  next(error);
 }
};

/**
 * @desc    Get all users (Admin)
 * @route   GET /api/v1/users
 * @access  Private/Admin
 */
export const getAllUsers = async (req, res, next) => {
 try {
  const snapshot = await getRef('users').get();
  const users = [];
  
  if (snapshot.exists()) {
   const usersData = snapshot.val();
   // Loop through Firebase data and attach the key as 'id'
   for (const key in usersData) {
    if (Object.hasOwnProperty.call(usersData, key)) {
     const { password, ...userWithoutPassword } = usersData[key]; // Remove password
     users.push({ id: key, ...userWithoutPassword }); // Add 'id' to the object
    }
   }
  }
  
  return successResponse(res, 'Users fetched successfully', users);
 } catch (error) {
  next(error);
 }
};

/**
 * @desc    Suspend or Activate user (Admin)
 * @route   PUT /api/v1/users/:id/status
 * @access  Private/Admin
 */
export const updateUserStatus = async (req, res, next) => {
 try {
  const { id } = req.params;
  const { status } = req.body; // 'active' or 'suspended'
  
  const userRef = getRef(`users/${id}`);
  const snapshot = await userRef.get();
  
  if (!snapshot.exists()) {
   return errorResponse(res, 'User not found', 404);
  }
  
  await userRef.update({ status });
  
  return successResponse(res, `User status updated to ${status}`);
 } catch (error) {
  next(error);
 }
};

/**
 * @desc    Generate or Reset User API Key
 * @route   POST /api/v1/users/apikey
 * @access  Private
 */
export const generateApiKey = async (req, res, next) => {
 try {
  const userId = req.user.id;
  
  // Generate a secure random 32-character API key
  const newApiKey = crypto.randomBytes(16).toString('hex');
  
  // Save it to the user's profile in Firebase
  await getRef(`users/${userId}/apiKey`).set(newApiKey);
  
  return successResponse(res, 'API Key generated successfully', { apiKey: newApiKey });
 } catch (error) {
  next(error);
 }
};
/**
 * @desc    Delete user account and move data to deletedAccounts for security
 * @route   DELETE /api/v1/users/me
 * @access  Private
 */
export const deleteAccount = async (req, res, next) => {
 try {
  const userId = req.user.id;
  
  // 1. Fetch the user's main profile data
  const userSnapshot = await getRef(`users/${userId}`).get();
  if (!userSnapshot.exists()) {
   return errorResponse(res, 'User not found', 404);
  }
  
  // Prepare the object to be saved in the deletedAccounts node
  const deletedAccountData = {
   ...userSnapshot.val(),
   deletedAt: new Date().toISOString(),
   transactions: {},
   orders: {},
   tickets: {}
  };
  
  // We will use a multi-path update to save the backup and delete active data atomically
  const updates = {};
  
  // 2. Fetch and move Transactions
  const txSnapshot = await getRef('transactions').orderByChild('userId').equalTo(userId).get();
  if (txSnapshot.exists()) {
   txSnapshot.forEach(child => {
    const key = child.key;
    deletedAccountData.transactions[key] = child.val();
    updates[`transactions/${key}`] = null; // Mark for deletion
   });
  }
  
  // 3. Fetch and move Orders
  const ordersSnapshot = await getRef('orders').orderByChild('userId').equalTo(userId).get();
  if (ordersSnapshot.exists()) {
   ordersSnapshot.forEach(child => {
    const key = child.key;
    deletedAccountData.orders[key] = child.val();
    updates[`orders/${key}`] = null; // Mark for deletion
   });
  }
  
  // 4. Fetch and move Tickets
  const ticketsSnapshot = await getRef('tickets').orderByChild('userId').equalTo(userId).get();
  if (ticketsSnapshot.exists()) {
   ticketsSnapshot.forEach(child => {
    const key = child.key;
    deletedAccountData.tickets[key] = child.val();
    updates[`tickets/${key}`] = null; // Mark for deletion
   });
  }
  
  // 5. Save the backed-up data to deletedAccounts node
  updates[`deletedAccounts/${userId}`] = deletedAccountData;
  
  // 6. Delete the user record itself from the active users node
  updates[`users/${userId}`] = null;
  
  // Execute the multi-path update atomically
  await getRef().update(updates);
  
  return successResponse(res, 'Account deleted successfully');
 } catch (error) {
  next(error);
 }
};

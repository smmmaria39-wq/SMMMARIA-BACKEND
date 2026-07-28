// ===============================================
// User Controller
// ===============================================

import { getRef } from '../database/firebase.js';
import { successResponse, errorResponse } from '../utils/response.js';

/**
 * @desc    Update user profile
 * @route   PUT /api/v1/users/profile
 * @access  Private
 */
export const updateProfile = async (req, res, next) => {
 try {
  const { username, country, phone } = req.body;
  const userId = req.user.id;
  
  const updates = {};
  if (username) updates.username = username;
  if (country) updates.country = country;
  if (phone) updates.phone = phone;
  
  await getRef(`users/${userId}`).update(updates);
  
  return successResponse(res, 'Profile updated successfully');
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
  const users = snapshot.exists() ? Object.values(snapshot.val()) : [];
  
  // Remove passwords from array
  const sanitizedUsers = users.map(user => {
   const { password, ...userWithoutPassword } = user;
   return userWithoutPassword;
  });
  
  return successResponse(res, 'Users fetched successfully', sanitizedUsers);
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
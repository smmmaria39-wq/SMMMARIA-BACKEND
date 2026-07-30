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

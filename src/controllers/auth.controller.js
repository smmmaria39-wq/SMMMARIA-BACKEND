// ===============================================
// Auth Controller
// ===============================================

import { getRef } from '../database/firebase.js';
import { hashPassword, comparePassword } from '../utils/bcrypt.js';
import { generateToken } from '../utils/jwt.js';
import { generateUUID, generateApiKey, generateReferralCode } from '../utils/helpers.js';
import { successResponse, errorResponse } from '../utils/response.js';
import { logger } from '../utils/logger.js';

/**
 * @desc    Register a new user
 * @route   POST /api/v1/auth/register
 * @access  Public
 */
export const registerUser = async (req, res, next) => {
 try {
  const { username, email, password, country, phone } = req.body;
  
  // Check if email already exists
  const emailSnapshot = await getRef('users').orderByChild('email').equalTo(email).get();
  if (emailSnapshot.exists()) {
   return errorResponse(res, 'Email is already registered', 400);
  }
  
  // Check if username already exists
  const usernameSnapshot = await getRef('users').orderByChild('username').equalTo(username).get();
  if (usernameSnapshot.exists()) {
   return errorResponse(res, 'Username is already taken', 400);
  }
  
  // Hash password
  const hashedPassword = await hashPassword(password);
  
  // Generate user details
  const userId = generateUUID();
  const apiKey = generateApiKey();
  const referralCode = generateReferralCode(username);
  
  // Create user object
  const newUser = {
   id: userId,
   username,
   email,
   password: hashedPassword,
   country: country || '',
   phone: phone || '',
   role: 'user', // Default role
   status: 'active',
   balance: 0,
   spent: 0,
   apiKey,
   referralCode,
   referredBy: req.body.referralCode || null,
   createdAt: new Date().toISOString(),
   lastLogin: new Date().toISOString()
  };
  
  // Save to Firebase
  await getRef(`users/${userId}`).set(newUser);
  
  // Generate JWT
  const token = generateToken({ id: userId, role: newUser.role });
  
  logger.success(`New user registered: ${username}`);
  
  // Return response (exclude password)
  const { password: pass, ...userWithoutPassword } = newUser;
  
  return successResponse(res, 'User registered successfully', { token, user: userWithoutPassword }, 201);
 } catch (error) {
  next(error);
 }
};

/**
 * @desc    Login user & get token
 * @route   POST /api/v1/auth/login
 * @access  Public
 */
export const loginUser = async (req, res, next) => {
 try {
  const { email, password } = req.body;
  
  // Find user by email
  const snapshot = await getRef('users').orderByChild('email').equalTo(email).get();
  if (!snapshot.exists()) {
   return errorResponse(res, 'Invalid credentials', 401);
  }
  
  // Extract user data (Firebase returns an object with keys)
  const user = Object.values(snapshot.val())[0];
  
  // Check password
  const isMatch = await comparePassword(password, user.password);
  if (!isMatch) {
   return errorResponse(res, 'Invalid credentials', 401);
  }
  
  // Check if account is active
  if (user.status !== 'active') {
   return errorResponse(res, `Account is ${user.status}. Please contact support.`, 403);
  }
  
  // Update last login
  await getRef(`users/${user.id}/lastLogin`).set(new Date().toISOString());
  
  // Generate JWT
  const token = generateToken({ id: user.id, role: user.role });
  
  // Remove password before sending response
  delete user.password;
  
  return successResponse(res, 'Login successful', { token, user });
 } catch (error) {
  next(error);
 }
};

/**
 * @desc    Get current logged in user profile
 * @route   GET /api/v1/auth/me
 * @access  Private
 */
export const getMe = async (req, res, next) => {
 try {
  const snapshot = await getRef(`users/${req.user.id}`).get();
  if (!snapshot.exists()) {
   return errorResponse(res, 'User not found', 404);
  }
  
  const user = snapshot.val();
  delete user.password;
  
  return successResponse(res, 'User profile fetched', user);
 } catch (error) {
  next(error);
 }
};
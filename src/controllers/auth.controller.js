// ===============================================
// Auth Controller
// ===============================================

import { getRef } from '../database/firebase.js';
import { hashPassword, comparePassword } from '../utils/bcrypt.js';
import { generateToken } from '../utils/jwt.js';
import { generateUUID, generateApiKey, generateReferralCode } from '../utils/helpers.js';
import { successResponse, errorResponse } from '../utils/response.js';
import { logger } from '../utils/logger.js';

// Helper to generate a short, unique 6-digit numeric Account ID (e.g., 693045)
const generateShortAccountId = () => {
    return Math.floor(100000 + Math.random() * 900000).toString();
};

/**
 * @desc    Register a new user
 * @route   POST /api/v1/auth/register
 * @access  Public
 */
export const registerUser = async (req, res, next) => {
 try {
  const { username, email, password, country, phone, fullname } = req.body;
  
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
  const accountId = generateShortAccountId(); // Now generates a 6-digit number
  
  // Create user object
  const newUser = {
   id: userId,
   accountId, // Save the 6-digit ID
   fullname: fullname || '',
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
  
  logger.success(`New user registered: ${username} (Account ID: ${accountId})`);
  
  // Return response (exclude password)
  const { password: pass, ...userWithoutPassword } = newUser;
  
  return successResponse(res, 'User registered successfully', { token, user: userWithoutPassword }, 201);
 } catch (error) {
  next(error);
 }
};

/**
 * @desc    Login user & get token (Email, Username, or Account ID)
 * @route   POST /api/v1/auth/login
 * @access  Public
 */
export const loginUser = async (req, res, next) => {
 try {
  const { identifier, password } = req.body;
  
  if (!identifier) {
   return errorResponse(res, 'Please enter your email, username, or Account ID', 400);
  }

  let user = null;

  // 1. Try finding user by Email
  let snapshot = await getRef('users').orderByChild('email').equalTo(identifier).get();
  if (snapshot.exists()) {
   user = Object.values(snapshot.val())[0];
  }

  // 2. Try finding user by Username
  if (!user) {
    snapshot = await getRef('users').orderByChild('username').equalTo(identifier).get();
    if (snapshot.exists()) {
     user = Object.values(snapshot.val())[0];
    }
  }

  // 3. Try finding user by Account ID
  if (!user) {
    snapshot = await getRef('users').orderByChild('accountId').equalTo(identifier).get();
    if (snapshot.exists()) {
     user = Object.values(snapshot.val())[0];
    }
  }

  // If user still not found
  if (!user) {
   return errorResponse(res, 'Invalid credentials', 401);
  }

  // PASSWORD LOGIC: 
  // If they logged in with Account ID, skip password check. Otherwise, require password.
  const isAccountIdLogin = (user.accountId === identifier);

  if (!isAccountIdLogin) {
   if (!password) {
    return errorResponse(res, 'Password is required', 401);
   }
   const isMatch = await comparePassword(password, user.password);
   if (!isMatch) {
    return errorResponse(res, 'Invalid credentials', 401);
   }
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
 * @desc    Login or Register via Google Account
 * @route   POST /api/v1/auth/google
 * @access  Public
 */
export const googleAuth = async (req, res, next) => {
 try {
  const { credential } = req.body;
  
  if (!credential) {
   return errorResponse(res, 'Google credential is missing', 400);
  }

  // Verify Google Token using Google's tokeninfo endpoint
  const googleRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${credential}`);
  const payload = await googleRes.json();

  if (payload.error || !payload.email) {
   return errorResponse(res, 'Invalid Google token', 401);
  }

  const { email, name, sub: googleId } = payload;

  // Check if user already exists with this email
  let snapshot = await getRef('users').orderByChild('email').equalTo(email).get();
  let user = snapshot.exists() ? Object.values(snapshot.val())[0] : null;

  // If user doesn't exist, register them automatically
  if (!user) {
   const userId = generateUUID();
   const username = email.split('@')[0] + Math.floor(Math.random() * 100); // Ensure unique username
   const accountId = generateShortAccountId();
   
   user = {
    id: userId,
    accountId,
    fullname: name || '',
    username,
    email,
    password: '', // No password for Google users
    country: '',
    phone: '',
    role: 'user',
    status: 'active',
    balance: 0,
    spent: 0,
    apiKey: generateApiKey(),
    referralCode: generateReferralCode(username),
    googleId,
    createdAt: new Date().toISOString(),
    lastLogin: new Date().toISOString()
   };

   await getRef(`users/${userId}`).set(user);
   logger.success(`New user registered via Google: ${email}`);
  } else {
   // Update last login for existing user
   await getRef(`users/${user.id}/lastLogin`).set(new Date().toISOString());
  }

  // Generate JWT
  const token = generateToken({ id: user.id, role: user.role });
  delete user.password;

  return successResponse(res, 'Google authentication successful', { token, user });
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

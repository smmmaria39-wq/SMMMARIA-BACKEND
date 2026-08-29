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
  const accountId = generateShortAccountId(); // Generates as a String
  
  // Create user object
  const newUser = {
   id: userId,
   accountId, // Saved as String
   fullname: fullname || '',
   username,
   email,
   password: hashedPassword,
   country: country || '',
   phone: phone || '',
   role: 'user',
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
  let { identifier, password } = req.body;
  
  if (!identifier) {
   return errorResponse(res, 'Please enter your email, username, or Account ID', 400);
  }

  // Force identifier to string and trim it just in case
  identifier = String(identifier).trim();
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

  // 3. Try finding user by Account ID (Type-Safe Check)
  if (!user) {
    // Try as String first
    snapshot = await getRef('users').orderByChild('accountId').equalTo(identifier).get();
    if (snapshot.exists()) {
     user = Object.values(snapshot.val())[0];
    } else if (!isNaN(identifier)) {
      // If not found and identifier is numeric, try querying as a Number type
      // This fixes the issue if Firebase accidentally stored it as a Number
      snapshot = await getRef('users').orderByChild('accountId').equalTo(Number(identifier)).get();
      if (snapshot.exists()) {
        user = Object.values(snapshot.val())[0];
      }
    }
  }

  // If user still not found
  if (!user) {
   return errorResponse(res, 'Invalid credentials', 401);
  }

  // PASSWORD LOGIC: 
  // Use String() to prevent type mismatch (e.g., Number vs String in DB)
  const isAccountIdLogin = (String(user.accountId) === identifier);

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
 * @desc    Login or Register via Google Account (OAuth 2.0 Code Flow)
 * @route   POST /api/v1/auth/google
 * @access  Public
 */
export const googleAuth = async (req, res, next) => {
 try {
  const { code } = req.body; // Changed from 'credential' to 'code'
  
  if (!code) {
   return errorResponse(res, 'Google authorization code is missing', 400);
  }
  
  // 1. Exchange the authorization code for Google tokens
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
   method: 'POST',
   headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
   body: new URLSearchParams({
    code: code,
    client_id: process.env.GOOGLE_CLIENT_ID || '354475709339-2g48o0nrugv0f1kg9n4nbn798c9upaud.apps.googleusercontent.com',
    client_secret: process.env.GOOGLE_CLIENT_SECRET, // You MUST add this to Railway env variables
    redirect_uri: 'postmessage', // Required by Google for popup JS flow
    grant_type: 'authorization_code'
   })
  });
  
  const tokens = await tokenResponse.json();
  
  if (tokens.error || !tokens.id_token) {
   return errorResponse(res, 'Failed to exchange Google authorization code', 401);
  }
  
  // 2. Verify the ID token to get user details
  const googleRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${tokens.id_token}`);
  const payload = await googleRes.json();
  
  if (payload.error || !payload.email) {
   return errorResponse(res, 'Invalid Google token', 401);
  }
  
  const { email, name, sub: googleId } = payload;
  
  // 3. Find or Create the user in Firebase
  let snapshot = await getRef('users').orderByChild('email').equalTo(email).get();
  let user = snapshot.exists() ? Object.values(snapshot.val())[0] : null;
  
  if (!user) {
   const userId = generateUUID();
   const username = email.split('@')[0] + Math.floor(Math.random() * 100);
   const accountId = generateShortAccountId();
   
   user = {
    id: userId,
    accountId,
    fullname: name || '',
    username,
    email,
    password: '',
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
   await getRef(`users/${user.id}/lastLogin`).set(new Date().toISOString());
  }
  
  // 4. Generate your app's JWT and return it
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

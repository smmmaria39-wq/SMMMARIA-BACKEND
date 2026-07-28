// ===============================================
// Authentication Middleware
// ===============================================

import { verifyToken } from '../utils/jwt.js';
import { errorResponse } from '../utils/response.js';
import { getRef } from '../database/firebase.js';

export const protect = async (req, res, next) => {
 let token;
 
 // Check for token in headers
 if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
  token = req.headers.authorization.split(' ')[1];
 }
 
 if (!token) {
  return errorResponse(res, 'Not authorized, no token provided', 401);
 }
 
 try {
  // Verify token
  const decoded = verifyToken(token);
  if (!decoded) {
   return errorResponse(res, 'Not authorized, token failed', 401);
  }
  
  // Fetch user from Firebase to ensure they still exist and are active
  const userRef = await getRef(`users/${decoded.id}`).get();
  if (!userRef.exists()) {
   return errorResponse(res, 'User no longer exists', 401);
  }
  
  const user = userRef.val();
  if (user.status === 'suspended') {
   return errorResponse(res, 'Account is suspended', 403);
  }
  
  // Attach user to request object (exclude password hash)
  req.user = {
   id: decoded.id,
   role: user.role,
   username: user.username,
   balance: user.balance || 0
  };
  
  next();
 } catch (error) {
  return errorResponse(res, 'Not authorized, token failed', 401);
 }
};
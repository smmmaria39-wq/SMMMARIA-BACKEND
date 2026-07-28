// ===============================================
// Admin Authorization Middleware
// ===============================================

import { errorResponse } from '../utils/response.js';

export const admin = (req, res, next) => {
 if (req.user && (req.user.role === 'admin' || req.user.role === 'super_admin')) {
  next();
 } else {
  return errorResponse(res, 'Not authorized as an admin', 403);
 }
};

export const superAdmin = (req, res, next) => {
 if (req.user && req.user.role === 'super_admin') {
  next();
 } else {
  return errorResponse(res, 'Not authorized as a super admin', 403);
 }
};
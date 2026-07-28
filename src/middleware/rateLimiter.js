// ===============================================
// Rate Limiting Middleware
// ===============================================

import rateLimit from 'express-rate-limit';

// General API rate limiter
export const apiLimiter = rateLimit({
 windowMs: 15 * 60 * 1000, // 15 minutes
 max: 100, // Limit each IP to 100 requests per window
 standardHeaders: true,
 legacyHeaders: false,
 message: {
  success: false,
  message: 'Too many requests from this IP, please try again after 15 minutes'
 }
});

// Strict rate limiter for authentication routes
export const authLimiter = rateLimit({
 windowMs: 60 * 60 * 1000, // 1 hour
 max: 10, // Limit each IP to 10 auth requests per hour
 standardHeaders: true,
 legacyHeaders: false,
 message: {
  success: false,
  message: 'Too many authentication attempts, please try again after an hour'
 }
});
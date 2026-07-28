// ===============================================
// Error Handling Middleware
// ===============================================

import { logger } from '../utils/logger.js';

// 404 Not Found Handler
export const notFound = (req, res, next) => {
 res.status(404).json({
  success: false,
  message: `Route Not Found - ${req.originalUrl}`
 });
};

// Global Error Handler
export const errorHandler = (err, req, res, next) => {
 logger.error(err.message);
 
 const statusCode = err.statusCode || 500;
 const message = err.message || 'Internal Server Error';
 
 res.status(statusCode).json({
  success: false,
  message,
  // Only show stack trace in development
  stack: process.env.NODE_ENV === 'production' ? null : err.stack
 });
};
// ===============================================
// Validation Middleware (Using Zod)
// ===============================================

import { errorResponse } from '../utils/response.js';

/**
 * Validate request against a Zod schema
 * @param {Object} schema - Zod schema object { body, query, params }
 */
export const validate = (schema) => (req, res, next) => {
 try {
  // Zod allows parsing specific parts of the request
  if (schema.body) schema.body.parse(req.body);
  if (schema.query) schema.query.parse(req.query);
  if (schema.params) schema.params.parse(req.params);
  
  next();
 } catch (error) {
  // Format Zod errors into a readable object
  const formattedErrors = error.errors.map(err => ({
   field: err.path.join('.'),
   message: err.message
  }));
  return errorResponse(res, 'Validation failed', 400, formattedErrors);
 }
};
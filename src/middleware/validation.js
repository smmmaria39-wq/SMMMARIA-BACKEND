// ===============================================
// Validation Middleware (Using Zod)
// ===============================================

import { errorResponse } from '../utils/response.js';

/**
 * Validate request against a Zod schema
 * @param {Object} schema - Zod schema object { body, query, params }
 */
export const validate = (schema) => (req, res, next) => {
  const errors = [];

  // Use safeParse to avoid throwing exceptions
  if (schema.body) {
    const result = schema.body.safeParse(req.body);
    if (!result.success) {
      errors.push(...result.error.errors.map(err => ({
        field: err.path.join('.'),
        message: err.message
      })));
    } else {
      // Overwrite req.body with the parsed data (strips unknown fields if not using .strict())
      req.body = result.data;
    }
  }

  if (schema.query) {
    const result = schema.query.safeParse(req.query);
    if (!result.success) {
      errors.push(...result.error.errors.map(err => ({
        field: err.path.join('.'),
        message: err.message
      })));
    } else {
      req.query = result.data;
    }
  }

  if (schema.params) {
    const result = schema.params.safeParse(req.params);
    if (!result.success) {
      errors.push(...result.error.errors.map(err => ({
        field: err.path.join('.'),
        message: err.message
      })));
    } else {
      req.params = result.data;
    }
  }

  // If any errors were collected, return them
  if (errors.length > 0) {
    return errorResponse(res, 'Validation failed', 400, errors);
  }

  next();
};

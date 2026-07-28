// ===============================================
// API Response Utilities
// ===============================================

/**
 * Send a success response
 * @param {Object} res - Express response object
 * @param {String} message - Success message
 * @param {Object} data - Data payload
 * @param {Number} statusCode - HTTP status code (default: 200)
 */
export const successResponse = (res, message, data = {}, statusCode = 200) => {
 return res.status(statusCode).json({
  success: true,
  message,
  data
 });
};

/**
 * Send an error response
 * @param {Object} res - Express response object
 * @param {String} message - Error message
 * @param {Number} statusCode - HTTP status code (default: 400)
 * @param {Object} errors - Detailed errors (e.g., validation errors)
 */
export const errorResponse = (res, message, statusCode = 400, errors = null) => {
 const response = {
  success: false,
  message
 };
 if (errors) response.errors = errors;
 return res.status(statusCode).json(response);
};
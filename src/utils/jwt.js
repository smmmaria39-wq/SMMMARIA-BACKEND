// ===============================================
// JWT Utilities
// ===============================================

import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

/**
 * Generate a JWT token for a user
 * @param {Object} payload - Usually contains user ID and role
 * @returns {String} - Signed JWT token
 */
export const generateToken = (payload) => {
 return jwt.sign(payload, env.jwt.secret, {
  expiresIn: env.jwt.expiresIn
 });
};

/**
 * Verify a JWT token
 * @param {String} token - The JWT token to verify
 * @returns {Object|null} - Decoded payload or null if invalid
 */
export const verifyToken = (token) => {
 try {
  return jwt.verify(token, env.jwt.secret);
 } catch (error) {
  return null;
 }
};
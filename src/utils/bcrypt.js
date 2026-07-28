// ===============================================
// Bcrypt Utilities
// ===============================================

import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 10;

/**
 * Hash a plaintext password
 * @param {String} password
 * @returns {Promise<String>} - Hashed password
 */
export const hashPassword = async (password) => {
 const salt = await bcrypt.genSalt(SALT_ROUNDS);
 return bcrypt.hash(password, salt);
};

/**
 * Compare a plaintext password with a hashed password
 * @param {String} password 
 * @param {String} hashedPassword 
 * @returns {Promise<Boolean>}
 */
export const comparePassword = async (password, hashedPassword) => {
 return bcrypt.compare(password, hashedPassword);
};
// ===============================================
// Helper Utilities
// ===============================================

import { v4 as uuidv4 } from 'uuid';

/**
 * Generate a unique ID using UUID v4
 * @returns {String}
 */
export const generateUUID = () => uuidv4();

/**
 * Generate a random API key for users
 * @returns {String}
 */
export const generateApiKey = () => {
 return `sk_${uuidv4().replace(/-/g, '')}${uuidv4().replace(/-/g, '').substring(0, 16)}`;
};

/**
 * Generate a random referral code
 * @param {String} username 
 * @returns {String}
 */
export const generateReferralCode = (username) => {
 const randomStr = Math.random().toString(36).substring(2, 7).toUpperCase();
 return `${username.substring(0, 4).toUpperCase()}${randomStr}`;
};
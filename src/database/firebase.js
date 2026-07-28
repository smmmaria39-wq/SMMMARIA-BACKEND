// ===============================================
// Firebase Realtime Database Reference
// ===============================================

import admin from '../config/firebase.js';

// Initialize the Realtime Database
const db = admin.database();

/**
 * Helper function to get a database reference safely
 * @param {string} path - The database path (e.g., 'users/userId123')
 * @returns {admin.database.Reference}
 */
export const getRef = (path) => db.ref(path);

export default db;
// ===============================================
// Firebase Admin SDK Initialization
// ===============================================

import admin from 'firebase-admin';
import { env } from './env.js';

// Prevent re-initializing if already initialized (useful for HMR/Nodemon)
if (admin.apps.length === 0) {
 try {
  admin.initializeApp({
   credential: admin.credential.cert({
    projectId: env.firebase.projectId,
    clientEmail: env.firebase.clientEmail,
    privateKey: env.firebase.privateKey
   }),
   databaseURL: env.firebase.databaseURL
  });
  console.log('✅ Firebase Admin SDK initialized successfully.');
 } catch (error) {
  console.error('❌ Firebase initialization error:', error.message);
  process.exit(1);
 }
}

// Export the auth and firestore instances if needed later (primarily using RTDB)
export const firebaseAuth = admin.auth();
export default admin;
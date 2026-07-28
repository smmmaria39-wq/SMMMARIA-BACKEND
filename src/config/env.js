// ===============================================
// Environment Configuration
// ===============================================

import dotenv from 'dotenv';

dotenv.config();

// Validate required environment variables
const requiredEnvVars = [
 'PORT',
 'JWT_SECRET',
 'FIREBASE_PROJECT_ID',
 'FIREBASE_CLIENT_EMAIL',
 'FIREBASE_PRIVATE_KEY',
 'FIREBASE_DATABASE_URL'
];

requiredEnvVars.forEach((envVar) => {
 if (!process.env[envVar]) {
  console.error(`[ENV ERROR] Missing required environment variable: ${envVar}`);
  process.exit(1); // Kill the app if a critical var is missing
 }
});

export const env = {
 port: process.env.PORT || 3000,
 baseUrl: process.env.BASE_URL || `http://localhost:${process.env.PORT}`,
 
 jwt: {
  secret: process.env.JWT_SECRET,
  expiresIn: process.env.JWT_EXPIRES || '7d'
 },
 
 firebase: {
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  // Replace literal \n with actual line breaks for the private key
  privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  databaseURL: process.env.FIREBASE_DATABASE_URL
 },
 
 supplier: {
  timeout: parseInt(process.env.SUPPLIER_TIMEOUT) || 30000
 },
 
 nodeEnv: process.env.NODE_ENV || 'development',
 isProduction: process.env.NODE_ENV === 'production'
};
// ===============================================
// Auth Routes
// ===============================================

import express from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validation.js';
import { authLimiter } from '../middleware/rateLimiter.js';
import { registerUser, loginUser, getMe, googleAuth } from '../controllers/auth.controller.js'; // Added googleAuth
import { protect } from '../middleware/auth.js';

const router = express.Router();

// Validation Schemas
const registerSchema = {
 body: z.object({
  username: z.string().min(3).max(20),
  email: z.string().email(),
  password: z.string().min(6),
  fullname: z.string().optional(), // Added fullname
  country: z.string().optional(),
  phone: z.string().optional(),
  referralCode: z.string().optional()
 })
};

// Updated login schema to accept 'identifier' and made password optional for Account ID login
const loginSchema = {
 body: z.object({
  identifier: z.string().min(3, "Identifier is required"),
  password: z.string().optional() // Optional because Account ID login doesn't use a password
 })
};

// Validation schema for Google login
const googleAuthSchema = {
 body: z.object({
  credential: z.string()
 })
};

// Routes
router.post('/register', authLimiter, validate(registerSchema), registerUser);
router.post('/login', authLimiter, validate(loginSchema), loginUser);
router.post('/google', authLimiter, validate(googleAuthSchema), googleAuth); // Added Google Route
router.get('/me', protect, getMe);

export default router;

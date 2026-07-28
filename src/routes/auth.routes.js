// ===============================================
// Auth Routes
// ===============================================

import express from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validation.js';
import { authLimiter } from '../middleware/rateLimiter.js';
import { registerUser, loginUser, getMe } from '../controllers/auth.controller.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

// Validation Schemas
const registerSchema = {
 body: z.object({
  username: z.string().min(3).max(20),
  email: z.string().email(),
  password: z.string().min(6),
  country: z.string().optional(),
  phone: z.string().optional(),
  referralCode: z.string().optional()
 })
};

const loginSchema = {
 body: z.object({
  email: z.string().email(),
  password: z.string().min(6)
 })
};

// Routes
router.post('/register', authLimiter, validate(registerSchema), registerUser);
router.post('/login', authLimiter, validate(loginSchema), loginUser);
router.get('/me', protect, getMe);

export default router;
// ===============================================
// User Routes
// ===============================================

import express from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validation.js';
import { protect } from '../middleware/auth.js';
import { admin } from '../middleware/admin.js';
import { updateProfile, getAllUsers, updateUserStatus, generateApiKey, deleteAccount } from '../controllers/user.controller.js';

const router = express.Router();

// Validation Schemas
const updateProfileSchema = {
 body: z.object({
  fullname: z.string().optional(), 
  username: z.string().min(3).max(20).optional(),
  country: z.string().optional(),
  phone: z.string().optional()
 })
};

const statusSchema = {
 body: z.object({
  status: z.enum(['active', 'suspended'])
 })
};

// Routes
router.put('/profile', protect, validate(updateProfileSchema), updateProfile);
router.delete('/me', protect, deleteAccount); // <-- ADDED DELETE ACCOUNT ROUTE
router.post('/apikey', protect, generateApiKey); 

// Admin Routes
router.get('/', protect, admin, getAllUsers);
router.put('/:id/status', protect, admin, validate(statusSchema), updateUserStatus);

export default router;

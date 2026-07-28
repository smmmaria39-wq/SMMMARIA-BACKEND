// ===============================================
// Payment Routes
// ===============================================

import express from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validation.js';
import { protect } from '../middleware/auth.js';
import { admin } from '../middleware/admin.js';
import { createDeposit, approvePayment, rejectPayment, getPayments } from '../controllers/payment.controller.js';

const router = express.Router();

const depositSchema = {
 body: z.object({
  amount: z.number().positive(),
  method: z.string().min(2),
  reference: z.string().optional()
 })
};

router.post('/deposit', protect, validate(depositSchema), createDeposit);
router.get('/', protect, getPayments);

// Admin Routes
router.put('/:id/approve', protect, admin, approvePayment);
router.put('/:id/reject', protect, admin, rejectPayment);

export default router;

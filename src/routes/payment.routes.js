// ===============================================
// Payment Routes
// ===============================================

import express from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validation.js';
import { protect } from '../middleware/auth.js';
import { admin } from '../middleware/admin.js';
import {
  createDeposit,
  approvePayment,
  rejectPayment,
  getPayments,
  pesajetWebhook,
  marzPayWebhook
} from '../controllers/payment.controller.js';

const router = express.Router();

// Updated schema to accept phone number and other gateway fields
const depositSchema = {
 body: z.object({
  amount: z.number().positive(),
  method: z.string().min(2),
  email: z.string().optional(),
  phoneNumber: z.string().optional(),
  country: z.string().optional(),
  reference: z.string().optional(),
  description: z.string().optional(),
  callback_url: z.string().optional(),
  cardNumber: z.string().optional(),
  cardExpiry: z.string().optional(),
  cardCvv: z.string().optional(),
  receipt: z.string().optional()
 })
};

// PesaJet Webhook — MTN/Airtel
router.post('/webhook', pesajetWebhook);

// MarzPay Webhook — Card payments
router.post('/marzpay-webhook', marzPayWebhook);

// User Routes
router.post('/deposit', protect, validate(depositSchema), createDeposit);
router.get('/', protect, getPayments);

// Admin Routes
router.put('/:id/approve', protect, admin, approvePayment);
router.put('/:id/reject', protect, admin, rejectPayment);

export default router;

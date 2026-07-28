// ===============================================
// Order Routes
// ===============================================

import express from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validation.js';
import { protect } from '../middleware/auth.js';
import { createOrder, getOrders, getOrderById } from '../controllers/order.controller.js';

const router = express.Router();

const createOrderSchema = {
 body: z.object({
  serviceId: z.string().min(5),
  link: z.string().url(),
  quantity: z.number().int().positive()
 })
};

router.post('/', protect, validate(createOrderSchema), createOrder);
router.get('/', protect, getOrders);
router.get('/:id', protect, getOrderById);

export default router;
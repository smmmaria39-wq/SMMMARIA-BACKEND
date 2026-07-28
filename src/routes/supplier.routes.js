// ===============================================
// Supplier Routes
// ===============================================

import express from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validation.js';
import { protect, admin } from '../middleware/auth.js';
import { addSupplier, checkSupplierBalance, syncSupplierServices } from '../controllers/supplier.controller.js';

const router = express.Router();

const addSupplierSchema = {
 body: z.object({
  name: z.string().min(2),
  apiUrl: z.string().url(),
  apiKey: z.string().min(5),
  priority: z.number().optional(),
  markup: z.number().optional()
 })
};

router.post('/', protect, admin, validate(addSupplierSchema), addSupplier);
router.get('/:id/balance', protect, admin, checkSupplierBalance);
router.post('/:id/sync', protect, admin, syncSupplierServices);

export default router;
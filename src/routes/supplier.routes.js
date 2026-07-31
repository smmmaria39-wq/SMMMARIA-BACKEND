// ===============================================
// Supplier Routes
// ===============================================

import express from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validation.js';
import { protect } from '../middleware/auth.js';
import { admin } from '../middleware/admin.js';
// Added deleteSupplier to the imports below:
import { getSuppliers, addSupplier, checkSupplierBalance, syncSupplierServices, deleteSupplier } from '../controllers/supplier.controller.js';

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

// Routes
router.get('/', protect, admin, getSuppliers);
router.post('/', protect, admin, validate(addSupplierSchema), addSupplier);
router.get('/:id/balance', protect, admin, checkSupplierBalance);
router.post('/:id/sync', protect, admin, syncSupplierServices);
router.delete('/:id', protect, admin, deleteSupplier); // <-- Added the DELETE route

export default router;

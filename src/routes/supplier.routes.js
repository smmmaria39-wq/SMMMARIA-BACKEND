// ===============================================
// Supplier Routes
// ===============================================

import express from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validation.js';
import { protect } from '../middleware/auth.js';
import { admin } from '../middleware/admin.js';
import { getSuppliers, addSupplier, checkSupplierBalance, syncSupplierServices, deleteSupplier, getSupplierCategories } from '../controllers/supplier.controller.js';

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

// NEW: Zod schema for selective synchronization
const syncSupplierSchema = {
 body: z.object({
  type: z.enum(['all', 'category', 'service']).optional().default('all'),
  category: z.string().min(1).optional(),
  serviceId: z.string().min(1).optional()
 }).refine(data => {
  // Validate that the required fields are present based on the type
  if (data.type === 'category') return !!data.category;
  if (data.type === 'service') return !!data.serviceId;
  return true;
 }, {
  message: 'Category or Service ID is required for the selected sync type.'
 })
};

// Routes
router.get('/', protect, admin, getSuppliers);
router.post('/', protect, admin, validate(addSupplierSchema), addSupplier);

// Get supplier categories from external API
router.get('/:id/categories', protect, admin, getSupplierCategories);

router.get('/:id/balance', protect, admin, checkSupplierBalance);

// Updated Sync Route with Validation
router.post('/:id/sync', protect, admin, validate(syncSupplierSchema), syncSupplierServices);

router.delete('/:id', protect, admin, deleteSupplier);

export default router;

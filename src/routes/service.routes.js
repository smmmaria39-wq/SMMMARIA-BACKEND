// ===============================================
// Service Routes
// ===============================================

import express from 'express';
import { protect } from '../middleware/auth.js';
import { admin } from '../middleware/admin.js';
import { getServices, getCategories, updateService, deleteService, deleteCategory, bulkUpdateServices } from '../controllers/service.controller.js';

const router = express.Router();

// User Routes
router.get('/', protect, getServices);
router.get('/categories', protect, getCategories);

// Admin Routes
router.put('/bulk-update', protect, admin, bulkUpdateServices); // Added bulk update route
router.put('/:id', protect, admin, updateService);
router.delete('/:id', protect, admin, deleteService); // Added
router.delete('/categories/:id', protect, admin, deleteCategory); // Added

export default router;

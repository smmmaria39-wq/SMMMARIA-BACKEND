// ===============================================
// Service Routes
// ===============================================

import express from 'express';
import { protect, admin } from '../middleware/auth.js';
import { getServices, getCategories, updateService } from '../controllers/service.controller.js';

const router = express.Router();

// User Routes
router.get('/', protect, getServices);
router.get('/categories', protect, getCategories);

// Admin Routes
router.put('/:id', protect, admin, updateService);

export default router;
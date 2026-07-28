// ===============================================
// Admin Routes
// ===============================================

import express from 'express';
import { protect } from '../middleware/auth.js';
import { admin } from '../middleware/admin.js';
import { getDashboardStats } from '../controllers/admin.controller.js';

const router = express.Router();

// All routes in this file are protected by admin middleware
router.use(protect, admin);

router.get('/dashboard', getDashboardStats);

export default router;

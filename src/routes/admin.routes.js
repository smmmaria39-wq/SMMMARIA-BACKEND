// ===============================================
// Admin Routes
// ===============================================

import express from 'express';
import { protect, admin } from '../middleware/auth.js';
import { getDashboardStats } from '../controllers/admin.controller.js';

const router = express.Router();

// All routes in this file are protected by admin middleware
router.use(protect, admin);

router.get('/dashboard', getDashboardStats);

// Future admin routes can go here:
// router.get('/users', getAllUsers); // (Already in user.routes.js but could be moved here)

export default router;
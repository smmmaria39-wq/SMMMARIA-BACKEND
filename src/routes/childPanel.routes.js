// ===============================================
// Child Panel Routes
// ===============================================

import express from 'express';
import { protect } from '../middleware/auth.js';
import { purchaseChildPanel, getMyPanel, updatePanelBranding } from '../controllers/childPanel.controller.js';

const router = express.Router();

// Route for users to purchase a child panel
router.post('/purchase', protect, purchaseChildPanel);

// Routes for resellers to manage their own panel
router.get('/me', protect, getMyPanel);
router.put('/branding', protect, updatePanelBranding);

export default router;

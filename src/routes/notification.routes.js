// ===============================================
// Notification Routes
// ===============================================

import express from 'express';
import { protect } from '../middleware/auth.js';
import { getNotifications, markAsRead } from '../controllers/notification.controller.js';

const router = express.Router();

router.get('/', protect, getNotifications);
router.put('/:id/read', protect, markAsRead);

export default router;
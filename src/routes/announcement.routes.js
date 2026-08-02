// ===============================================
// Announcement Routes
// ===============================================

import express from 'express';
import { protect } from '../middleware/auth.js';
import { admin } from '../middleware/admin.js';
import { createAnnouncement, getAnnouncements, deleteAnnouncement } from '../controllers/announcement.controller.js';

const router = express.Router();

// User Route
router.get('/', protect, getAnnouncements);

// Admin Routes
router.post('/', protect, admin, createAnnouncement);
router.delete('/:id', protect, admin, deleteAnnouncement);

export default router;

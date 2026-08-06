// ===============================================
// Refill Routes
// ===============================================

import express from 'express';
import { protect } from '../middleware/auth.js';
import { requestRefill, getRefills } from '../controllers/refill.controller.js';

const router = express.Router();

router.post('/', protect, requestRefill);
router.get('/', protect, getRefills);

export default router;

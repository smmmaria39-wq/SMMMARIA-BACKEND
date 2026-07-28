// ===============================================
// Wallet Routes
// ===============================================

import express from 'express';
import { protect } from '../middleware/auth.js';
import { getWallet } from '../controllers/wallet.controller.js';

const router = express.Router();

router.get('/', protect, getWallet);

export default router;
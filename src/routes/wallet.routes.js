// ===============================================
// Wallet Routes
// ===============================================

import express from 'express';
import { protect } from '../middleware/auth.js';
import { getWallet, adjustWallet } from '../controllers/wallet.controller.js'; // Make sure adjustWallet is imported!

const router = express.Router();

router.get('/', protect, getWallet);
router.post('/adjust', protect, adjustWallet); // The new route

export default router;

import express from 'express';
import { apiKeyAuth } from '../middleware/apiKeyAuth.js';
import { getBalance, getServices, createOrder, getOrderStatus } from '../controllers/api.controller.js';

const router = express.Router();

router.get('/balance', apiKeyAuth, getBalance);
router.get('/services', apiKeyAuth, getServices);
router.post('/orders', apiKeyAuth, createOrder);
router.get('/orders/:id', apiKeyAuth, getOrderStatus);

export default router;

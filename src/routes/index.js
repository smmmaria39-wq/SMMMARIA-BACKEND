// ===============================================
// API Central Router
// ===============================================

import { Router } from 'express';
import authRoutes from './auth.routes.js';
import userRoutes from './user.routes.js';
import walletRoutes from './wallet.routes.js';
import paymentRoutes from './payment.routes.js';
import supplierRoutes from './supplier.routes.js';
import serviceRoutes from './service.routes.js';
import orderRoutes from './order.routes.js';
import ticketRoutes from './ticket.routes.js';
import notificationRoutes from './notification.routes.js';
import adminRoutes from './admin.routes.js';

const router = Router();

// Health Check Route
router.get('/health', (req, res) => {
 res.status(200).json({ success: true, message: 'SMMMARIA API is running smoothly!' });
});

// Mount Routers
router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/wallet', walletRoutes);
router.use('/payments', paymentRoutes);
router.use('/suppliers', supplierRoutes);
router.use('/services', serviceRoutes);
router.use('/orders', orderRoutes);
router.use('/tickets', ticketRoutes);
router.use('/notifications', notificationRoutes);
router.use('/admin', adminRoutes);

export default router;
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
import announcementRoutes from './announcement.routes.js';
import childPanelRoutes from './childPanel.routes.js'; 
import refillRoutes from './refill.routes.js'; 
import adminRoutes from './admin.routes.js';

// ---> NEW IMPORTS FOR BUY ACCOUNT MARKETPLACE <---
import accountRoutes from './account.routes.js';
import accountAdminRoutes from './accountAdmin.routes.js';

// ---> NEW IMPORTS FOR LIVE CHAT <---
import chatRoutes from './chat.routes.js';
import adminChatRoutes from './admin-chat.routes.js';

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
router.use('/announcements', announcementRoutes);
router.use('/child-panel', childPanelRoutes); 
router.use('/refills', refillRoutes); 
router.use('/admin', adminRoutes);

// ---> NEW MOUNT POINTS FOR BUY ACCOUNT MARKETPLACE <---
// Customer-facing endpoints: /api/v1/accounts
router.use('/accounts', accountRoutes);

// Admin-facing endpoints: /api/v1/admin/accounts
router.use('/admin/accounts', accountAdminRoutes);

// ---> NEW MOUNT POINTS FOR LIVE CHAT <---
// User-facing endpoints: /api/v1/chat
router.use('/chat', chatRoutes);

// Admin-facing endpoints: /api/v1/admin/chat
router.use('/admin/chat', adminChatRoutes);

export default router;  

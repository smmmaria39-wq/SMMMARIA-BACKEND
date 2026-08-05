// ===============================================
// Child Panel Routes
// ===============================================

import express from 'express';
import { protect } from '../middleware/auth.js';
import { admin } from '../middleware/admin.js';
import { identifyPanel } from '../middleware/panelContext.js';

// Controllers
import { 
    purchaseChildPanel, 
    getMyPanel, 
    updatePanelBranding,
    getAllPanels,
    getChildPanelDetails,
    updateChildPanelStatus,
    fundChildPanelWallet,
    deductChildPanelWallet,         // ADDED
    setChildPanelBalance,           // ADDED
    bulkFundChildPanelWallets,      // ADDED
    getChildPanelTransactions,      // ADDED
    adminCreateChildPanel,
    getPanelAnnouncements, 
    createPanelAnnouncement, 
    deletePanelAnnouncement 
} from '../controllers/childPanel.controller.js';

import { childLogin, childRegister, getMe } from '../controllers/childAuth.controller.js';
import { getPanelUsers, updatePanelUserStatus, fundChildUser } from '../controllers/childUser.controller.js';
import { getPanelServices, bulkUpdatePanelPrices } from '../controllers/childService.controller.js';
import { getPanelTransactions, requestPanelDeposit } from '../controllers/childWallet.controller.js';
import { createChildOrder, getPanelOrders } from '../controllers/childOrder.controller.js';

const router = express.Router();

// Apply panel context middleware to ALL child-panel routes
router.use(identifyPanel);

// --- Public Child Panel Auth Routes ---
router.post('/auth/register', childRegister);
router.post('/auth/login', childLogin);
router.get('/auth/me', protect, getMe);

// --- Main User Routes (Buying & Managing Panel) ---
router.post('/purchase', protect, purchaseChildPanel);

// --- Reseller Panel Routes (Requires Reseller JWT) ---
router.get('/me', protect, getMyPanel);
router.put('/branding', protect, updatePanelBranding);

router.get('/users', protect, getPanelUsers);
router.put('/users/:id/status', protect, updatePanelUserStatus);
router.post('/users/:id/fund', protect, fundChildUser);

router.get('/services', protect, getPanelServices);
router.put('/services/bulk-update', protect, bulkUpdatePanelPrices);

router.get('/wallet/transactions', protect, getPanelTransactions);
router.post('/wallet/deposit', protect, requestPanelDeposit);

router.get('/orders', protect, getPanelOrders);
router.post('/orders', protect, createChildOrder);

// --- Announcements ---
router.get('/announcements', protect, getPanelAnnouncements);
router.post('/announcements', protect, createPanelAnnouncement);
router.delete('/announcements/:id', protect, deletePanelAnnouncement);

// --- Super Admin Routes ---
// NOTE: Static routes (/all, /admin-create, /bulk-fund) MUST be above /:id routes
router.get('/all', protect, admin, getAllPanels);
router.post('/admin-create', protect, admin, adminCreateChildPanel);
router.post('/bulk-fund', protect, admin, bulkFundChildPanelWallets);

// Dynamic Panel ID Routes
router.get('/:id', protect, admin, getChildPanelDetails);
router.get('/:id/transactions', protect, admin, getChildPanelTransactions);
router.put('/:id/status', protect, admin, updateChildPanelStatus);
router.put('/:id/balance', protect, admin, setChildPanelBalance);
router.post('/:id/fund', protect, admin, fundChildPanelWallet);
router.post('/:id/deduct', protect, admin, deductChildPanelWallet);

export default router;

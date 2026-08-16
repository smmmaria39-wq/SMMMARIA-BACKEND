import { Router } from 'express';
import accountController from '../controllers/account.controller.js';
import { purchaseAccountSchema } from '../validators/account.validation.js';
import { protect } from '../middleware/auth.js';
import { validate } from '../middleware/validation.js';

const router = Router();

// Protect all routes
router.use(protect);

// ===============================================
// FIXED ROUTE ORDERING (Static routes BEFORE /:id)
// ===============================================

// Categories & Inventory
router.get('/categories', accountController.getCategories);
router.get('/', accountController.getAccounts);

// User purchase history & secure invoice retrieval (MUST COME BEFORE /:id)
router.get('/purchases', accountController.getMyPurchases);
router.get('/purchases/:id', accountController.getMyPurchaseDetails);
router.get('/purchases/:id/invoice', accountController.getMyPurchaseDetails);

// Dynamic account routes — MUST COME LAST
router.get('/:id', accountController.getAccountDetails);
router.post('/:id/purchase', validate(purchaseAccountSchema), accountController.purchaseAccount);

export default router;

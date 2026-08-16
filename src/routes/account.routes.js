import { Router } from 'express';
import accountController from '../controllers/account.controller.js';
import { purchaseAccountRules } from '../validators/account.validation.js';
import authMiddleware from '../middleware/auth.js'; // Adjusted to ES Modules

const router = Router();

// Protect all routes
router.use(authMiddleware);

// Categories & Inventory
router.get('/categories', accountController.getCategories);
router.get('/', accountController.getAccounts);
router.get('/:id', accountController.getAccountDetails);

// Purchase flow
router.post('/:id/purchase', purchaseAccountRules, accountController.purchaseAccount);

// User purchase history & secure invoice retrieval
router.get('/purchases', accountController.getMyPurchases);
router.get('/purchases/:id', accountController.getMyPurchaseDetails);
router.get('/purchases/:id/invoice', accountController.getMyPurchaseDetails); // Re-use details for invoice data

export default router;

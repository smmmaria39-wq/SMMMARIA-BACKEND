import { Router } from 'express';
import accountController from '../controllers/account.controller.js';
import { purchaseAccountSchema } from '../validators/account.validation.js';
import { protect } from '../middleware/auth.js';
import { validate } from '../middleware/validation.js'; // <-- FIX: Added curly braces

const router = Router();

router.use(protect);

router.get('/categories', accountController.getCategories);
router.get('/', accountController.getAccounts);
router.get('/:id', accountController.getAccountDetails);

// Apply Zod validate middleware
router.post('/:id/purchase', validate(purchaseAccountSchema), accountController.purchaseAccount);

router.get('/purchases', accountController.getMyPurchases);
router.get('/purchases/:id', accountController.getMyPurchaseDetails);
router.get('/purchases/:id/invoice', accountController.getMyPurchaseDetails);

export default router;

import { Router } from 'express';
import accountController from '../controllers/account.controller.js';
import { purchaseAccountSchema } from '../validators/account.validation.js';
import authMiddleware from '../middleware/auth.js'; 
import validate from '../middleware/validation.js'; // Your existing validation middleware

const router = Router();

router.use(authMiddleware);

router.get('/categories', accountController.getCategories);
router.get('/', accountController.getAccounts);
router.get('/:id', accountController.getAccountDetails);

// Apply Zod validate middleware
router.post('/:id/purchase', validate(purchaseAccountSchema), accountController.purchaseAccount);

router.get('/purchases', accountController.getMyPurchases);
router.get('/purchases/:id', accountController.getMyPurchaseDetails);
router.get('/purchases/:id/invoice', accountController.getMyPurchaseDetails);

export default router;

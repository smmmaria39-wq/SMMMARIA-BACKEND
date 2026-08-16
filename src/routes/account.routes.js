const express = require('express');
const router = express.Router();
const accountController = require('../controllers/account.controller');
const { purchaseAccountRules } = require('../validators/account.validation');

// Protect all routes
const authMiddleware = require('../middleware/auth'); 

router.use(authMiddleware);

router.get('/categories', accountController.getCategories);
router.get('/', accountController.getAccounts);
router.get('/:id', accountController.getAccountDetails);

// Purchase flow
router.post('/:id/purchase', purchaseAccountRules, accountController.purchaseAccount);

// User purchase history & secure invoice retrieval
router.get('/purchases', accountController.getMyPurchases);
router.get('/purchases/:id', accountController.getMyPurchaseDetails);
router.get('/purchases/:id/invoice', accountController.getMyPurchaseDetails); // Re-use details for invoice data

module.exports = router;

const express = require('express');
const router = express.Router();
const accountAdminController = require('../controllers/accountAdmin.controller');
const { createAccountRules, updateAccountRules, createCategoryRules } = require('../validators/account.validation');

// Protect all routes with Admin middleware
const authMiddleware = require('../middleware/auth');
const adminMiddleware = require('../middleware/admin');

router.use(authMiddleware, adminMiddleware);

// Inventory Management
router.get('/', accountAdminController.getStats);
router.post('/', createAccountRules, accountAdminController.createAccount);
router.post('/import', accountAdminController.bulkImport);

router.get('/:id', (req, res) => res.json({ message: 'Get specific admin account - implemented in controller' }));
router.patch('/:id', updateAccountRules, accountAdminController.updateAccount);
router.delete('/:id', accountAdminController.deleteAccount);
router.post('/:id/disable', accountAdminController.disableAccount);
router.post('/:id/mark-sold', (req, res) => res.json({ message: 'Mark sold endpoint - can be added to controller' }));

// Category Management
router.get('/categories', (req, res) => res.json({ message: 'Admin get categories' }));
router.post('/categories', createCategoryRules, accountAdminController.createCategory);
router.patch('/categories/:id', (req, res) => res.json({ message: 'Update category endpoint' }));

module.exports = router;

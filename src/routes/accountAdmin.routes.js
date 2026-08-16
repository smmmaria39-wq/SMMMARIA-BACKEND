import { Router } from 'express';
import accountAdminController from '../controllers/accountAdmin.controller.js';
import { createAccountSchema, updateAccountSchema, createCategorySchema } from '../validators/account.validation.js';
import { protect } from '../middleware/auth.js';
import { admin } from '../middleware/admin.js';
import { validate } from '../middleware/validation.js';

const router = Router();

// Protect all routes with Admin middleware
router.use(protect, admin);

// ===============================================
// FIXED ROUTE ORDERING (Static routes BEFORE /:id)
// ===============================================

// Stats
router.get('/', accountAdminController.getStats);

// Inventory collection
router.get('/all', accountAdminController.getAllAccounts);
router.post('/', validate(createAccountSchema), accountAdminController.createAccount);
router.post('/import', accountAdminController.bulkImport);

// Categories — MUST COME BEFORE /:id
router.get('/categories', accountAdminController.getCategories);
router.post('/categories', validate(createCategorySchema), accountAdminController.createCategory);
router.patch('/categories/:id', (req, res) => res.json({ message: 'Update category endpoint' }));

// Dynamic account routes — MUST COME LAST
router.get('/:id', (req, res) => res.json({ message: 'Get specific admin account' }));
router.patch('/:id', validate(updateAccountSchema), accountAdminController.updateAccount);
router.delete('/:id', accountAdminController.deleteAccount);
router.post('/:id/disable', accountAdminController.disableAccount);
router.post('/:id/mark-sold', (req, res) => res.json({ message: 'Mark sold endpoint' }));

export default router;

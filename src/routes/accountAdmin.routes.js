import { Router } from 'express';
import accountAdminController from '../controllers/accountAdmin.controller.js';
import { createAccountSchema, updateAccountSchema, createCategorySchema } from '../validators/account.validation.js';
import { protect } from '../middleware/auth.js';
import { admin } from '../middleware/admin.js';
import { validate } from '../middleware/validation.js'; // <-- FIX: Added curly braces

const router = Router();

router.use(protect, admin);

router.get('/', accountAdminController.getStats);
router.post('/', validate(createAccountSchema), accountAdminController.createAccount);
router.post('/import', accountAdminController.bulkImport);

router.get('/:id', (req, res) => res.json({ message: 'Get specific admin account' }));
router.patch('/:id', validate(updateAccountSchema), accountAdminController.updateAccount);
router.delete('/:id', accountAdminController.deleteAccount);
router.post('/:id/disable', accountAdminController.disableAccount);

router.get('/categories', (req, res) => res.json({ message: 'Admin get categories' }));
router.post('/categories', validate(createCategorySchema), accountAdminController.createCategory);
router.patch('/categories/:id', (req, res) => res.json({ message: 'Update category endpoint' }));

export default router;

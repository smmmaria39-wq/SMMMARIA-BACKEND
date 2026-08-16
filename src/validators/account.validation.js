import { body, query, param } from 'express-validator';

const createAccountRules = [
  body('categoryId').isString().notEmpty(),
  body('platform').isString().notEmpty(),
  body('username').isString().notEmpty(),
  body('email').optional().isString(),
  body('emailPassword').optional().isString(),
  body('accountPassword').optional().isString(),
  body('accountType').optional().isString(),
  body('accountAge').optional().isString(),
  body('followers').optional().isNumeric(),
  body('country').optional().isString(),
  body('niche').optional().isString(),
  body('price').isNumeric().toFloat(),
  body('currency').optional().isString()
];

const updateAccountRules = [
  body('price').optional().isNumeric().toFloat(),
  body('status').optional().isIn(['available', 'reserved', 'sold', 'disabled']),
  // other fields optional
];

const createCategoryRules = [
  body('name').isString().notEmpty(),
  body('platform').isString().notEmpty(),
  body('description').optional().isString(),
  body('icon').optional().isString(),
  body('lowStockThreshold').optional().isNumeric().toInt()
];

const purchaseAccountRules = [
  param('id').isString().notEmpty()
];

export {
  createAccountRules,
  updateAccountRules,
  createCategoryRules,
  purchaseAccountRules
};

import { z } from 'zod';

// Schema for creating an account
const createAccountSchema = z.object({
  body: z.object({
    categoryId: z.string().min(1, 'Category ID is required'),
    platform: z.string().min(1, 'Platform is required'),
    username: z.string().min(1, 'Username is required'),
    email: z.string().optional(),
    emailPassword: z.string().optional(),
    accountPassword: z.string().optional(),
    accountType: z.string().optional(),
    accountAge: z.string().optional(),
    followers: z.number().optional(),
    country: z.string().optional(),
    niche: z.string().optional(),
    price: z.number({ invalid_type_error: 'Price must be a number' }).positive('Price must be greater than 0'),
    currency: z.string().optional()
  })
});

// Schema for updating an account
const updateAccountSchema = z.object({
  body: z.object({
    price: z.number().positive().optional(),
    status: z.enum(['available', 'reserved', 'sold', 'disabled']).optional(),
    accountType: z.string().optional(),
    accountAge: z.string().optional(),
    followers: z.number().optional(),
    country: z.string().optional(),
    niche: z.string().optional()
  })
});

// Schema for creating a category
const createCategorySchema = z.object({
  body: z.object({
    name: z.string().min(1, 'Name is required'),
    platform: z.string().min(1, 'Platform is required'),
    description: z.string().optional(),
    icon: z.string().optional(),
    lowStockThreshold: z.number().int().optional().default(10)
  })
});

// Schema for purchase request (just needs the ID in params)
const purchaseAccountSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'Account ID is required')
  })
});

export {
  createAccountSchema,
  updateAccountSchema,
  createCategorySchema,
  purchaseAccountSchema
};

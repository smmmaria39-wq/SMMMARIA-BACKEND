// ===============================================
// Ticket Routes
// ===============================================

import express from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validation.js';
import { protect } from '../middleware/auth.js';
import { admin } from '../middleware/admin.js';
import { 
 createTicket, 
 replyTicket, 
 getTickets, 
 getTicketById, 
 closeTicket,
 // Admin Imports
 getAdminTickets,
 getAdminTicketStats,
 getAdminTicketById,
 replyAsAdmin,
 updateTicketStatus,
 updateTicketPriority,
 reopenTicket
} from '../controllers/ticket.controller.js';

const router = express.Router();

// ===============================================
// Validation Schemas
// ===============================================

const createTicketSchema = {
 body: z.object({
  subject: z.enum([
   'Order',
   'Payment',
   'API',
   'Request',
   'Discount',
   'Others'
  ]),
  orderId: z.string().trim().optional(),
  requestType: z.enum([
   'Speed Up',
   'Cancel',
   'Refill',
   'Restart',
   'Not Started',
   'Others'
  ]).optional(),
  message: z.string().trim().min(5).max(5000),
  priority: z.enum(['low', 'medium', 'high']).optional().default('medium')
 }).superRefine((data, ctx) => {
  if (data.subject === 'Order' && !data.orderId) {
   ctx.addIssue({
    code: 'custom',
    path: ['orderId'],
    message: 'Order ID is required for Order tickets'
   });
  }
  if (data.subject === 'Request') {
   if (!data.orderId) {
    ctx.addIssue({
     code: 'custom',
     path: ['orderId'],
     message: 'Order ID is required for Request tickets'
    });
   }
   if (!data.requestType) {
    ctx.addIssue({
     code: 'custom',
     path: ['requestType'],
     message: 'Request type is required'
    });
   }
  }
 })
};

const replySchema = {
 body: z.object({
  message: z.string().min(1)
 })
};

const statusSchema = {
 body: z.object({
  status: z.enum(['open', 'awaiting_admin_reply', 'awaiting_user_reply', 'closed'])
 })
};

const prioritySchema = {
 body: z.object({
  priority: z.enum(['low', 'medium', 'high'])
 })
};

// ===============================================
// Admin Routes (Must be placed before /:id to avoid route conflict)
// ===============================================

router.get('/admin/stats', protect, admin, getAdminTicketStats);
router.get('/admin', protect, admin, getAdminTickets);
router.get('/admin/:id', protect, admin, getAdminTicketById);
router.post('/admin/:id/reply', protect, admin, validate(replySchema), replyAsAdmin);
router.patch('/admin/:id/status', protect, admin, validate(statusSchema), updateTicketStatus);
router.patch('/admin/:id/priority', protect, admin, validate(prioritySchema), updateTicketPriority);
router.patch('/admin/:id/reopen', protect, admin, reopenTicket);

// ===============================================
// Customer Routes
// ===============================================

router.post('/', protect, validate(createTicketSchema), createTicket);
router.get('/', protect, getTickets);
router.get('/:id', protect, getTicketById);
router.post('/:id/reply', protect, validate(replySchema), replyTicket);
router.put('/:id/close', protect, admin, closeTicket); // Already restricted to admin in original code

export default router;

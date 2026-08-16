// ===============================================
// Ticket Routes
// ===============================================

import express from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validation.js';
import { protect } from '../middleware/auth.js';
import { admin } from '../middleware/admin.js';
import { createTicket, replyTicket, getTickets, getTicketById, closeTicket } from '../controllers/ticket.controller.js';

const router = express.Router();

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
  // Conditional Validation for 'Order' Subject
  if (data.subject === 'Order' && !data.orderId) {
   ctx.addIssue({
    code: 'custom',
    path: ['orderId'],
    message: 'Order ID is required for Order tickets'
   });
  }

  // Conditional Validation for 'Request' Subject
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

router.post('/', protect, validate(createTicketSchema), createTicket);
router.get('/', protect, getTickets);
router.get('/:id', protect, getTicketById);
router.post('/:id/reply', protect, validate(replySchema), replyTicket);

// Admin Routes
router.put('/:id/close', protect, admin, closeTicket);

export default router;

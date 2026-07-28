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
  subject: z.string().min(3),
  message: z.string().min(5),
  priority: z.enum(['low', 'medium', 'high']).optional()
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

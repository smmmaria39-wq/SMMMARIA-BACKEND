// ===============================================
// Ticket Controller
// ===============================================

import { getRef } from '../database/firebase.js';
import { generateUUID } from '../utils/helpers.js';
import { successResponse, errorResponse } from '../utils/response.js';

/**
 * @desc    Create a new support ticket
 * @route   POST /api/v1/tickets
 * @access  Private
 */
export const createTicket = async (req, res, next) => {
 try {
  const { subject, orderId, requestType, message, priority } = req.body;
  const ticketId = generateUUID();
  const messageId = generateUUID();
  
  // Normalize Order IDs (trim spaces, remove empty values)
  const normalizedOrderId = orderId 
   ? orderId.split(',').map(id => id.trim()).filter(Boolean).join(',') 
   : null;

  // Only store requestType if subject is 'Request', otherwise enforce null
  const finalRequestType = subject === 'Request' ? (requestType || null) : null;
  
  const ticketData = {
   id: ticketId,
   userId: req.user.id,
   username: req.user.username,
   subject,
   orderId: normalizedOrderId,
   requestType: finalRequestType,
   priority: priority || 'medium',
   status: 'open',
   createdAt: new Date().toISOString(),
   updatedAt: new Date().toISOString()
  };
  
  const messageData = {
   id: messageId,
   ticketId,
   userId: req.user.id,
   message,
   createdAt: new Date().toISOString()
  };
  
  await getRef(`tickets/${ticketId}`).set(ticketData);
  await getRef(`ticketMessages/${ticketId}/${messageId}`).set(messageData);
  
  return successResponse(res, 'Ticket created successfully', ticketData, 201);
 } catch (error) {
  next(error);
 }
};

/**
 * @desc    Reply to a ticket
 * @route   POST /api/v1/tickets/:id/reply
 * @access  Private
 */
export const replyTicket = async (req, res, next) => {
 try {
  const { id } = req.params;
  const { message } = req.body;
  
  const ticketRef = getRef(`tickets/${id}`);
  const ticketSnap = await ticketRef.get();
  
  if (!ticketSnap.exists()) return errorResponse(res, 'Ticket not found', 404);
  
  // Ensure user owns the ticket or is an admin
  const ticket = ticketSnap.val();
  if (req.user.role === 'user' && ticket.userId !== req.user.id) {
   return errorResponse(res, 'Not authorized', 403);
  }
  
  const messageId = generateUUID();
  const messageData = {
   id: messageId,
   ticketId: id,
   userId: req.user.id,
   message,
   isAdmin: req.user.role === 'admin' || req.user.role === 'super_admin',
   createdAt: new Date().toISOString()
  };
  
  await getRef(`ticketMessages/${id}/${messageId}`).set(messageData);
  
  // Update ticket status and timestamp
  const updates = { updatedAt: new Date().toISOString() };
  if (ticket.status === 'closed') updates.status = 'open'; // Reopen if closed
  if (req.user.role === 'user') updates.status = 'awaiting_admin_reply';
  if (req.user.role === 'admin' || req.user.role === 'super_admin') updates.status = 'awaiting_user_reply';
  
  await ticketRef.update(updates);
  
  return successResponse(res, 'Reply added successfully', messageData);
 } catch (error) {
  next(error);
 }
};

/**
 * @desc    Get tickets (User gets own, Admin gets all)
 * @route   GET /api/v1/tickets
 * @access  Private
 */
export const getTickets = async (req, res, next) => {
 try {
  const snapshot = await getRef('tickets').get();
  let tickets = snapshot.exists() ? Object.values(snapshot.val()).reverse() : [];
  
  // SECURE FIX: Only show all tickets to admins. Everyone else only sees their own.
  const isAdmin = req.user.role === 'admin' || req.user.role === 'super_admin';
  if (!isAdmin) {
   tickets = tickets.filter(t => t.userId === req.user.id);
  }
  
  return successResponse(res, 'Tickets fetched successfully', tickets);
 } catch (error) {
  next(error);
 }
}; 

/**
 * @desc    Get single ticket with messages
 * @route   GET /api/v1/tickets/:id
 * @access  Private
 */
export const getTicketById = async (req, res, next) => {
 try {
  const { id } = req.params;
  const ticketSnap = await getRef(`tickets/${id}`).get();
  
  if (!ticketSnap.exists()) return errorResponse(res, 'Ticket not found', 404);
  
  const ticket = ticketSnap.val();
  
  // SECURE FIX: Only allow admins to view any ticket. Everyone else gets blocked.
  const isAdmin = req.user.role === 'admin' || req.user.role === 'super_admin';
  if (!isAdmin && ticket.userId !== req.user.id) {
   return errorResponse(res, 'Not authorized', 403);
  }
  
  const msgSnap = await getRef(`ticketMessages/${id}`).get();
  const messages = msgSnap.exists() ? Object.values(msgSnap.val()) : [];
  
  return successResponse(res, 'Ticket fetched successfully', { ticket, messages });
 } catch (error) {
  next(error);
 }
};

/**
 * @desc    Admin: Close ticket
 * @route   PUT /api/v1/tickets/:id/close
 * @access  Private/Admin
 */
export const closeTicket = async (req, res, next) => {
 try {
  const { id } = req.params;
  await getRef(`tickets/${id}`).update({ status: 'closed', updatedAt: new Date().toISOString() });
  return successResponse(res, 'Ticket closed successfully');
 } catch (error) {
  next(error);
 }
};
// ===============================================
// ADMIN TICKET CONTROLLERS
// ===============================================

/**
 * @desc    Admin: Get all tickets with filtering & pagination
 * @route   GET /api/v1/tickets/admin
 * @access  Private/Admin
 */
export const getAdminTickets = async (req, res, next) => {
 try {
  const { status, priority, subject, search, page = 1, limit = 20 } = req.query;
  const snapshot = await getRef('tickets').get();
  let tickets = snapshot.exists() ? Object.values(snapshot.val()) : [];

  // Apply Filters
  if (status) tickets = tickets.filter(t => t.status === status);
  if (priority) tickets = tickets.filter(t => t.priority === priority);
  if (subject) tickets = tickets.filter(t => t.subject === subject);
  
  if (search) {
   const lowerSearch = search.toLowerCase();
   tickets = tickets.filter(t => 
    (t.id && t.id.includes(lowerSearch)) ||
    (t.username && t.username.toLowerCase().includes(lowerSearch)) ||
    (t.userId && t.userId.includes(lowerSearch)) ||
    (t.orderId && t.orderId.includes(lowerSearch)) ||
    (t.subject && t.subject.toLowerCase().includes(lowerSearch))
   );
  }

  // Sort by updatedAt descending
  tickets.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

  // Pagination Logic
  const pageNum = parseInt(page, 10) || 1;
  const limitNum = Math.min(parseInt(limit, 10) || 20, 100); // Max 100 limit
  const startIndex = (pageNum - 1) * limitNum;
  const endIndex = pageNum * limitNum;
  const paginatedTickets = tickets.slice(startIndex, endIndex);

  return successResponse(res, 'Tickets fetched successfully', {
   tickets: paginatedTickets,
   pagination: {
    page: pageNum,
    limit: limitNum,
    total: tickets.length,
    totalPages: Math.ceil(tickets.length / limitNum)
   }
  });
 } catch (error) {
  next(error);
 }
};

/**
 * @desc    Admin: Get ticket statistics
 * @route   GET /api/v1/tickets/admin/stats
 * @access  Private/Admin
 */
export const getAdminTicketStats = async (req, res, next) => {
 try {
  const snapshot = await getRef('tickets').get();
  const tickets = snapshot.exists() ? Object.values(snapshot.val()) : [];
  
  const stats = {
   total: tickets.length,
   open: tickets.filter(t => t.status === 'open').length,
   awaitingAdminReply: tickets.filter(t => t.status === 'awaiting_admin_reply').length,
   awaitingUserReply: tickets.filter(t => t.status === 'awaiting_user_reply').length,
   closed: tickets.filter(t => t.status === 'closed').length,
   highPriority: tickets.filter(t => t.priority === 'high').length,
   mediumPriority: tickets.filter(t => t.priority === 'medium').length,
   lowPriority: tickets.filter(t => t.priority === 'low').length,
  };

  return successResponse(res, 'Ticket stats fetched successfully', stats);
 } catch (error) {
  next(error);
 }
};

/**
 * @desc    Admin: Get single ticket with messages
 * @route   GET /api/v1/tickets/admin/:id
 * @access  Private/Admin
 */
export const getAdminTicketById = async (req, res, next) => {
 try {
  const { id } = req.params;
  const ticketSnap = await getRef(`tickets/${id}`).get();
  
  if (!ticketSnap.exists()) return errorResponse(res, 'Ticket not found', 404);
  
  const ticket = ticketSnap.val();
  // No ownership check here, admins can view any ticket
  
  const msgSnap = await getRef(`ticketMessages/${id}`).get();
  const messages = msgSnap.exists() ? Object.values(msgSnap.val()) : [];
  
  return successResponse(res, 'Ticket fetched successfully', { ticket, messages });
 } catch (error) {
  next(error);
 }
};

/**
 * @desc    Admin: Reply to a ticket
 * @route   POST /api/v1/tickets/admin/:id/reply
 * @access  Private/Admin
 */
export const replyAsAdmin = async (req, res, next) => {
 try {
  const { id } = req.params;
  const { message } = req.body;
  
  const ticketRef = getRef(`tickets/${id}`);
  const ticketSnap = await ticketRef.get();
  
  if (!ticketSnap.exists()) return errorResponse(res, 'Ticket not found', 404);
  
  const messageId = generateUUID();
  const messageData = {
   id: messageId,
   ticketId: id,
   userId: req.user.id,
   message,
   isAdmin: true, // Hardcoded true for admin routes
   createdAt: new Date().toISOString()
  };
  
  await getRef(`ticketMessages/${id}/${messageId}`).set(messageData);
  
  // Update ticket status and timestamp
  const updates = { 
   updatedAt: new Date().toISOString(),
   status: 'awaiting_user_reply' 
  };
  
  await ticketRef.update(updates);
  
  return successResponse(res, 'Reply added successfully', messageData);
 } catch (error) {
  next(error);
 }
};

/**
 * @desc    Admin: Update ticket status
 * @route   PATCH /api/v1/tickets/admin/:id/status
 * @access  Private/Admin
 */
export const updateTicketStatus = async (req, res, next) => {
 try {
  const { id } = req.params;
  const { status } = req.body;
  
  const ticketRef = getRef(`tickets/${id}`);
  const ticketSnap = await ticketRef.get();
  
  if (!ticketSnap.exists()) return errorResponse(res, 'Ticket not found', 404);
  
  await ticketRef.update({ 
   status, 
   updatedAt: new Date().toISOString() 
  });
  
  return successResponse(res, 'Ticket status updated successfully');
 } catch (error) {
  next(error);
 }
};

/**
 * @desc    Admin: Update ticket priority
 * @route   PATCH /api/v1/tickets/admin/:id/priority
 * @access  Private/Admin
 */
export const updateTicketPriority = async (req, res, next) => {
 try {
  const { id } = req.params;
  const { priority } = req.body;
  
  const ticketRef = getRef(`tickets/${id}`);
  const ticketSnap = await ticketRef.get();
  
  if (!ticketSnap.exists()) return errorResponse(res, 'Ticket not found', 404);
  
  await ticketRef.update({ 
   priority, 
   updatedAt: new Date().toISOString() 
  });
  
  return successResponse(res, 'Ticket priority updated successfully');
 } catch (error) {
  next(error);
 }
};

/**
 * @desc    Admin: Reopen a closed ticket
 * @route   PATCH /api/v1/tickets/admin/:id/reopen
 * @access  Private/Admin
 */
export const reopenTicket = async (req, res, next) => {
 try {
  const { id } = req.params;
  
  const ticketRef = getRef(`tickets/${id}`);
  const ticketSnap = await ticketRef.get();
  
  if (!ticketSnap.exists()) return errorResponse(res, 'Ticket not found', 404);
  
  await ticketRef.update({ 
   status: 'open', 
   updatedAt: new Date().toISOString() 
  });
  
  return successResponse(res, 'Ticket reopened successfully');
 } catch (error) {
  next(error);
 }
};

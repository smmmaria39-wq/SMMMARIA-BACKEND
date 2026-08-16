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
  
  if (req.user.role === 'user') {
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
  if (req.user.role === 'user' && ticket.userId !== req.user.id) {
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

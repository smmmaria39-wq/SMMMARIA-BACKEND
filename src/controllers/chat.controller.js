import { chatService } from '../services/chat.service.js';
import { successResponse, errorResponse } from '../utils/response.js';

export const getPrivateChat = async (req, res, next) => {
  try {
    const messages = await chatService.getPrivateMessages(req.user.id);
    return successResponse(res, 'Private chat fetched', messages);
  } catch (error) { next(error); }
};

export const sendPrivateMessage = async (req, res, next) => {
  try {
    // Non-admins cannot send media
    if (req.body.media) {
      return errorResponse(res, 'Media support is for admin accounts only.', 403);
    }
    const msg = await chatService.sendPrivateMessage(req.user.id, req.body, false);
    return successResponse(res, 'Message sent', msg, 201);
  } catch (error) { next(error); }
};

export const markPrivateRead = async (req, res, next) => {
  try {
    await chatService.markPrivateMessagesRead(req.user.id, false);
    return successResponse(res, 'Messages marked as read');
  } catch (error) { next(error); }
};

export const getPublicChat = async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const messages = await chatService.getPublicMessages(limit);
    return successResponse(res, 'Public chat fetched', messages);
  } catch (error) { next(error); }
};

export const sendPublicMessage = async (req, res, next) => {
  try {
    if (req.body.media) {
      return errorResponse(res, 'Media support is for admin accounts only.', 403);
    }
    const msg = await chatService.sendPublicMessage(req.user.id, req.body, false);
    return successResponse(res, 'Message sent', msg, 201);
  } catch (error) { next(error); }
};

export const updateMessage = async (req, res, next) => {
  try {
    const result = await chatService.updateMessage(req.params.messageId, req.user.id, req.body.message, false);
    return successResponse(res, 'Message updated', result);
  } catch (error) { next(error); }
};

export const deleteMessage = async (req, res, next) => {
  try {
    const result = await chatService.deleteMessage(req.params.messageId, req.user.id, false);
    return successResponse(res, 'Message deleted', result);
  } catch (error) { next(error); }
};

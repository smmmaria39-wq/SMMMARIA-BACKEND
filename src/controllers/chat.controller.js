import { 
  getPrivateMessages, 
  sendPrivateMessage, 
  markPrivateMessagesRead, 
  getPublicMessages, 
  sendPublicMessage, 
  updateMessage, 
  deleteMessage 
} from '../services/chat.service.js';
import { successResponse, errorResponse } from '../utils/response.js';

export const getPrivateChat = async (req, res, next) => {
  try {
    const messages = await getPrivateMessages(req.user.id);
    return successResponse(res, 'Private chat fetched', messages);
  } catch (error) { next(error); }
};

export const sendPrivateMessageCtrl = async (req, res, next) => {
  try {
    // Non-admins cannot send media
    if (req.body.media) {
      return errorResponse(res, 'Media support is for admin accounts only.', 403);
    }
    const msg = await sendPrivateMessage(req.user.id, req.body, false);
    return successResponse(res, 'Message sent', msg, 201);
  } catch (error) { next(error); }
};

export const markPrivateRead = async (req, res, next) => {
  try {
    await markPrivateMessagesRead(req.user.id, false);
    return successResponse(res, 'Messages marked as read');
  } catch (error) { next(error); }
};

export const getPublicChat = async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const messages = await getPublicMessages(limit);
    return successResponse(res, 'Public chat fetched', messages);
  } catch (error) { next(error); }
};

export const sendPublicMessageCtrl = async (req, res, next) => {
  try {
    if (req.body.media) {
      return errorResponse(res, 'Media support is for admin accounts only.', 403);
    }
    const msg = await sendPublicMessage(req.user.id, req.body, false);
    return successResponse(res, 'Message sent', msg, 201);
  } catch (error) { next(error); }
};

export const updateMessageCtrl = async (req, res, next) => {
  try {
    const result = await updateMessage(req.params.messageId, req.user.id, req.body.message, false);
    return successResponse(res, 'Message updated', result);
  } catch (error) { next(error); }
};

export const deleteMessageCtrl = async (req, res, next) => {
  try {
    const result = await deleteMessage(req.params.messageId, req.user.id, false);
    return successResponse(res, 'Message deleted', result);
  } catch (error) { next(error); }
};

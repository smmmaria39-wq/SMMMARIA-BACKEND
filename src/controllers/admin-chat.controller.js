import { chatService } from '../services/chat.service.js';
import { successResponse, errorResponse } from '../utils/response.js';

export const getPrivateUsers = async (req, res, next) => {
  try {
    const users = await chatService.getPrivateChatUsers();
    return successResponse(res, 'Private chat users fetched', users);
  } catch (error) { next(error); }
};

export const getUserPrivateChat = async (req, res, next) => {
  try {
    const messages = await chatService.getPrivateMessages(req.params.userId);
    return successResponse(res, 'User private chat fetched', messages);
  } catch (error) { next(error); }
};

export const adminSendPrivateMessage = async (req, res, next) => {
  try {
    const msg = await chatService.sendPrivateMessage(req.params.userId, req.body, true);
    return successResponse(res, 'Admin message sent', msg, 201);
  } catch (error) { next(error); }
};

export const adminMarkPrivateRead = async (req, res, next) => {
  try {
    await chatService.markPrivateMessagesRead(req.params.userId, true);
    return successResponse(res, 'Messages marked as read');
  } catch (error) { next(error); }
};

export const adminGetPublicChat = async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const messages = await chatService.getPublicMessages(limit);
    return successResponse(res, 'Public chat fetched', messages);
  } catch (error) { next(error); }
};

export const adminDeletePublicMessage = async (req, res, next) => {
  try {
    const result = await chatService.adminDeletePublicMessage(req.params.messageId);
    return successResponse(res, 'Message deleted', result);
  } catch (error) { next(error); }
};

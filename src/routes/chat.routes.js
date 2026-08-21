import express from 'express';
import rateLimit from 'express-rate-limit';
import { protect } from '../middleware/auth.js';
import { validate } from '../middleware/validation.js';
import { sendMessageSchema, editMessageSchema } from '../validators/chat.validation.js';
import * as chatController from '../controllers/chat.controller.js';

const router = express.Router();

const chatLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20, // 20 messages per minute
  message: { success: false, message: 'Too many messages, please slow down.' }
});

router.use(protect);

router.get('/private', chatController.getPrivateChat);
router.post('/private', chatLimiter, validate(sendMessageSchema), chatController.sendPrivateMessage);
router.put('/private/read', chatController.markPrivateRead);

router.get('/public', chatController.getPublicChat);
router.post('/public', chatLimiter, validate(sendMessageSchema), chatController.sendPublicMessage);

router.patch('/messages/:messageId', validate(editMessageSchema), chatController.updateMessage);
router.delete('/messages/:messageId', chatController.deleteMessage);

export default router;

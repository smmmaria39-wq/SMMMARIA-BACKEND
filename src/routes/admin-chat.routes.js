import express from 'express';
import { protect } from '../middleware/auth.js';
import { admin } from '../middleware/admin.js';
import { validate } from '../middleware/validation.js';
import { sendMessageSchema } from '../validators/chat.validation.js';
import * as adminChatController from '../controllers/admin-chat.controller.js';

const router = express.Router();

router.use(protect, admin);

router.get('/private', adminChatController.getPrivateUsers);
router.get('/private/:userId', adminChatController.getUserPrivateChat);
router.post('/private/:userId', validate(sendMessageSchema), adminChatController.adminSendPrivateMessage);
router.put('/private/:userId/read', adminChatController.adminMarkPrivateRead);

router.get('/public', adminChatController.adminGetPublicChat);
router.delete('/public/:messageId', adminChatController.adminDeletePublicMsg);

export default router;

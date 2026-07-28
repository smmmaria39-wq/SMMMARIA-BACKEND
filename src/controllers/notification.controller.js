// ===============================================
// Notification Controller
// ===============================================

import { getRef } from '../database/firebase.js';
import { successResponse } from '../utils/response.js';

/**
 * @desc    Get user's notifications
 * @route   GET /api/v1/notifications
 * @access  Private
 */
export const getNotifications = async (req, res, next) => {
 try {
  const snapshot = await getRef('notifications').orderByChild('userId').equalTo(req.user.id).get();
  const notifications = snapshot.exists() ? Object.values(snapshot.val()).reverse() : [];
  
  return successResponse(res, 'Notifications fetched successfully', notifications);
 } catch (error) {
  next(error);
 }
};

/**
 * @desc    Mark notification as read
 * @route   PUT /api/v1/notifications/:id/read
 * @access  Private
 */
export const markAsRead = async (req, res, next) => {
 try {
  await getRef(`notifications/${req.params.id}`).update({ isRead: true });
  return successResponse(res, 'Notification marked as read');
 } catch (error) {
  next(error);
 }
};
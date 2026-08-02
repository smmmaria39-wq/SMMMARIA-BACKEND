// ===============================================
// Notification Controller
// ===============================================

import { getRef } from '../database/firebase.js';
import { successResponse } from '../utils/response.js';

/**
 * @desc    Get Global Announcements (Displays on User Dashboard & Settings)
 * @route   GET /api/v1/notifications
 * @access  Private
 */
export const getNotifications = async (req, res, next) => {
  try {
    // Fetch Global Announcements ONLY
    const announceSnap = await getRef('announcements').get();
    const announcements = announceSnap.exists() ? Object.values(announceSnap.val()) : [];

    // Format them so the frontend has consistent data to render
    const formattedAnnouncements = announcements.map(a => ({
      id: a.id,
      title: a.title || 'Announcement',
      message: a.message,
      type: 'announcement',
      isRead: false, 
      createdAt: a.createdAt
    }));

    // Sort by date (newest first)
    const sortedAnnouncements = formattedAnnouncements.sort((a, b) => {
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
    
    return successResponse(res, 'Notifications fetched successfully', sortedAnnouncements);
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
  // Since we are only using announcements globally right now, 
  // we won't crash if this is called, but we won't do anything either.
  return successResponse(res, 'Notification marked as read');
 } catch (error) {
  next(error);
 }
};

// ===============================================
// Announcement Controller
// ===============================================

import { getRef } from '../database/firebase.js';
import { generateUUID } from '../utils/helpers.js';
import { successResponse, errorResponse } from '../utils/response.js';
import { logger } from '../utils/logger.js';

/**
 * @desc    Create a new announcement (Admin)
 * @route   POST /api/v1/announcements
 * @access  Private/Admin
 */
export const createAnnouncement = async (req, res, next) => {
  try {
    const { title, message } = req.body;
    
    if (!title || !message) {
      return errorResponse(res, 'Title and message are required', 400);
    }
    
    const announcementId = generateUUID();
    const announcementData = {
      id: announcementId,
      title,
      message,
      createdAt: new Date().toISOString()
    };
    
    await getRef(`announcements/${announcementId}`).set(announcementData);
    
    logger.success(`New announcement created: ${title}`);
    return successResponse(res, 'Announcement published successfully', announcementData, 201);
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get all announcements (Public/User)
 * @route   GET /api/v1/announcements
 * @access  Private
 */
export const getAnnouncements = async (req, res, next) => {
  try {
    const snapshot = await getRef('announcements').get();
    const announcements = snapshot.exists() ? Object.values(snapshot.val()).reverse() : [];
    
    return successResponse(res, 'Announcements fetched successfully', announcements);
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Delete an announcement (Admin)
 * @route   DELETE /api/v1/announcements/:id
 * @access  Private/Admin
 */
export const deleteAnnouncement = async (req, res, next) => {
  try {
    const { id } = req.params;
    await getRef(`announcements/${id}`).remove();
    
    return successResponse(res, 'Announcement deleted successfully');
  } catch (error) {
    next(error);
  }
};

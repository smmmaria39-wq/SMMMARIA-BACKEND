// ===============================================
// Child User Controller
// ===============================================

import { getRef } from '../database/firebase.js';
import { successResponse, errorResponse } from '../utils/response.js';
import { logger } from '../utils/logger.js';

/**
 * @desc    Get all users on the reseller's panel
 * @route   GET /api/v1/child-panel/users
 * @access  Private/Reseller
 */
export const getPanelUsers = async (req, res, next) => {
  try {
    const panelId = req.user.childPanelId; // Extracted from Reseller JWT
    if (!panelId) return errorResponse(res, 'Not authorized as reseller', 403);

    const snap = await getRef(`childPanels/${panelId}/users`).get();
    const users = snap.exists() ? Object.values(snap.val()).map(u => {
      delete u.password; // Never send passwords to the frontend
      return u;
    }) : [];

    return successResponse(res, 'Users fetched successfully', users);
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Toggle child user status (Active/Suspended)
 * @route   PUT /api/v1/child-panel/users/:id/status
 * @access  Private/Reseller
 */
export const updatePanelUserStatus = async (req, res, next) => {
  try {
    const panelId = req.user.childPanelId;
    const { id } = req.params;
    const { status } = req.body; // 'active' or 'suspended'

    // Validate status
    if (!['active', 'suspended'].includes(status)) {
      return errorResponse(res, 'Invalid status provided', 400);
    }

    // Check if user exists in this specific panel
    const userSnap = await getRef(`childPanels/${panelId}/users/${id}`).get();
    if (!userSnap.exists()) return errorResponse(res, 'User not found in this panel', 404);

    await getRef(`childPanels/${panelId}/users/${id}/status`).set(status);
    
    return successResponse(res, `User status updated to ${status}`);
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Manually add funds to a child user's wallet (Deducts from Reseller main wallet)
 * @route   POST /api/v1/child-panel/users/:id/fund
 * @access  Private/Reseller
 */
export const fundChildUser = async (req, res, next) => {
  try {
    const panelId = req.user.childPanelId;
    const resellerId = req.user.id; // Reseller's main User ID
    const { id } = req.params;
    const { amount } = req.body;

    if (isNaN(amount) || amount <= 0) {
      return errorResponse(res, 'Amount must be greater than 0', 400);
    }

    // 1. Check if user exists in this panel
    const userSnap = await getRef(`childPanels/${panelId}/users/${id}`).get();
    if (!userSnap.exists()) return errorResponse(res, 'User not found in this panel', 404);

    // 2. Deduct funds from Reseller's Main SMMMARIA Wallet
    const resellerBalRef = getRef(`users/${resellerId}/balance`);
    let hasFunds = false;

    await resellerBalRef.transaction(curr => {
      if ((curr || 0) >= amount) {
        hasFunds = true;
        return curr - amount;
      }
      return curr;
    });

    if (!hasFunds) {
      return errorResponse(res, 'Insufficient main wallet balance to fund this user', 400);
    }

    // 3. Add funds to the Child User's Wallet
    const childBalRef = getRef(`childPanels/${panelId}/users/${id}/balance`);
    await childBalRef.transaction(curr => (curr || 0) + amount);

    logger.success(`Reseller ${resellerId} funded child user ${id} with $${amount}`);
    return successResponse(res, `User funded with $${amount} successfully`);
  } catch (error) {
    next(error);
  }
};

// ===============================================
// Refill Controller
// ===============================================

import { getRef } from '../database/firebase.js';
import { generateUUID } from '../utils/helpers.js';
import { successResponse, errorResponse } from '../utils/response.js';
import { logger } from '../utils/logger.js';

/**
 * @desc    Submit a refill request
 * @route   POST /api/v1/refills
 * @access  Private
 */
export const requestRefill = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { orderId, link } = req.body;

        // 1. Validate Input
        if (!orderId || !link) {
            return errorResponse(res, 'Order ID and Link are required', 400);
        }

        // 2. Security: Verify the order exists AND belongs to the logged-in user
        const orderSnap = await getRef(`orders/${orderId}`).get();
        if (!orderSnap.exists()) {
            return errorResponse(res, 'Order not found', 404);
        }
        
        const order = orderSnap.val();
        if (order.userId !== userId) {
            return errorResponse(res, 'You can only request refills for your own orders', 403);
        }

        // 3. Create Refill Record
        const refillId = generateUUID();
        const refillData = {
            id: refillId,
            userId,
            orderId,
            link,
            status: 'pending', // pending, approved, rejected, completed
            createdAt: new Date().toISOString()
        };

        await getRef(`refills/${refillId}`).set(refillData);

        logger.info(`Refill requested by user ${userId} for order ${orderId}`);
        return successResponse(res, 'Refill request submitted successfully', refillData, 201);

    } catch (error) {
        next(error);
    }
};

/**
 * @desc    Get refill history for logged-in user
 * @route   GET /api/v1/refills
 * @access  Private
 */
export const getRefills = async (req, res, next) => {
    try {
        const userId = req.user.id;

        // Fetch all refills and filter in memory (bypasses Firebase indexing issues)
        const snapshot = await getRef('refills').get();
        let refills = snapshot.exists() ? Object.values(snapshot.val()) : [];

        // SECURE FILTER: Only show refills belonging to the authenticated user
        // Admins can see all refills, normal users only see their own
        const isAdmin = req.user.role === 'admin' || req.user.role === 'super_admin';
        if (!isAdmin) {
            refills = refills.filter(r => r.userId === userId);
        }

        // Sort newest first
        refills.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        return successResponse(res, 'Refills fetched successfully', refills);

    } catch (error) {
        next(error);
    }
};

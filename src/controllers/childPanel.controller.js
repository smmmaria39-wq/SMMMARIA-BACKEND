// ===============================================
// Child Panel Controller
// ===============================================

import { getRef } from '../database/firebase.js';
import { generateUUID } from '../utils/helpers.js';
import { successResponse, errorResponse } from '../utils/response.js';
import { logger } from '../utils/logger.js';

/**
 * @desc    Purchase and provision a new Child Panel
 * @route   POST /api/v1/child-panel/purchase
 * @access  Private
 */
export const purchaseChildPanel = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { plan, price, panelName, subdomain } = req.body;

        // 1. Validate Input
        if (!plan || !price || !panelName || !subdomain) {
            return errorResponse(res, 'Please provide plan, price, panel name, and subdomain', 400);
        }

        const cleanSubdomain = subdomain.toLowerCase().replace(/[^a-z0-9-]/g, '');

        // 2. Check if subdomain is already taken
        const subdomainSnap = await getRef('childPanels').orderByChild('info/subdomain').equalTo(cleanSubdomain).get();
        if (subdomainSnap.exists()) {
            return errorResponse(res, 'This subdomain is already taken. Please choose another.', 400);
        }

        // 3. Check & Deduct Wallet Balance Atomically
        const userBalanceRef = getRef(`users/${userId}/balance`);
        let hasSufficientFunds = false;

        await userBalanceRef.transaction((currentBalance) => {
            if ((currentBalance || 0) >= price) {
                hasSufficientFunds = true;
                return (currentBalance || 0) - price; // Deduct price
            }
            return currentBalance; // Not enough funds
        });

        if (!hasSufficientFunds) {
            return errorResponse(res, 'Insufficient wallet balance to purchase this panel.', 400);
        }

        // 4. Create the Child Panel Record in Firebase
        const panelId = generateUUID();
        const createdAt = new Date().toISOString();

        const panelData = {
            info: {
                panelId: panelId,
                panelName: panelName,
                ownerId: userId,
                subdomain: cleanSubdomain,
                customDomain: null, // Can be added later by reseller
                status: 'active',
                plan: plan,
                createdAt: createdAt
            },
            branding: {
                logoUrl: '',
                primaryColor: '#F5A623', // Default SMMMARIA gold
                secondaryColor: '#08164A', // Default dark blue
                footerText: `${panelName} - All rights reserved.`
            },
            settings: {
                maintenanceMode: false,
                allowRegistration: true,
                currency: 'USD'
            },
            statistics: {
                totalUsers: 0,
                totalOrders: 0,
                totalRevenue: 0
            },
            // Nodes for child panel specific data
            users: {},
            orders: {},
            transactions: {},
            pricing: {} // They will set their custom prices here
        };

        await getRef(`childPanels/${panelId}`).set(panelData);

        // 5. Upgrade User Role to Reseller
        await getRef(`users/${userId}`).update({
            role: 'reseller',
            childPanelId: panelId
        });

        logger.success(`Child Panel created: ${panelName} (${cleanSubdomain}.smmmaria.com) for user ${userId}`);

        return successResponse(res, 'Child Panel purchased successfully! Proceed to your reseller dashboard.', { 
            panelId, 
            subdomain: cleanSubdomain,
            panelName 
        }, 201);

    } catch (error) {
        logger.error(`Error purchasing child panel: ${error.message}`);
        next(error);
    }
};

/**
 * @desc    Get Reseller Panel Details (for the reseller dashboard)
 * @route   GET /api/v1/child-panel/me
 * @access  Private/Reseller
 */
export const getMyPanel = async (req, res, next) => {
    try {
        const userId = req.user.id;
        
        // Fetch user to get their childPanelId
        const userSnap = await getRef(`users/${userId}`).get();
        if (!userSnap.exists()) {
            return errorResponse(res, 'User not found', 404);
        }
        
        const user = userSnap.val();
        if (user.role !== 'reseller' || !user.childPanelId) {
            return errorResponse(res, 'You do not own a child panel.', 403);
        }

        // Fetch the panel data
        const panelSnap = await getRef(`childPanels/${user.childPanelId}`).get();
        if (!panelSnap.exists()) {
            return errorResponse(res, 'Child panel not found', 404);
        }

        const panelData = panelSnap.val();

        return successResponse(res, 'Panel details fetched successfully', panelData);
    } catch (error) {
        next(error);
    }
};

/**
 * @desc    Update Panel Branding & Settings
 * @route   PUT /api/v1/child-panel/branding
 * @access  Private/Reseller
 */
export const updatePanelBranding = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { panelName, logoUrl, primaryColor, secondaryColor, footerText } = req.body;

        const userSnap = await getRef(`users/${userId}`).get();
        const user = userSnap.val();

        if (!user || user.role !== 'reseller' || !user.childPanelId) {
            return errorResponse(res, 'Not authorized', 403);
        }

        const panelId = user.childPanelId;
        const updates = {};
        
        if (panelName) updates[`childPanels/${panelId}/info/panelName`] = panelName;
        if (logoUrl !== undefined) updates[`childPanels/${panelId}/branding/logoUrl`] = logoUrl;
        if (primaryColor) updates[`childPanels/${panelId}/branding/primaryColor`] = primaryColor;
        if (secondaryColor) updates[`childPanels/${panelId}/branding/secondaryColor`] = secondaryColor;
        if (footerText) updates[`childPanels/${panelId}/branding/footerText`] = footerText;

        await getRef().update(updates);

        return successResponse(res, 'Branding updated successfully');
    } catch (error) {
        next(error);
    }
};

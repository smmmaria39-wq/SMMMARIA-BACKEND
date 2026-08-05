// ===============================================
// Child Panel Controller
// ===============================================

import { getRef } from '../database/firebase.js';
import { generateUUID } from '../utils/helpers.js';
import { successResponse, errorResponse } from '../utils/response.js';
import { logger } from '../utils/logger.js';
import { hashPassword } from '../utils/bcrypt.js';

// ===============================================
// HELPER: Log Wallet Transactions
// ===============================================
const logWalletTransaction = async (userId, type, amount, description, source = 'System') => {
    const txId = generateUUID();
    const txData = {
        id: txId,
        type, // 'credit' or 'debit'
        amount: parseFloat(amount),
        description,
        source,
        date: new Date().toISOString()
    };
    await getRef(`users/${userId}/transactions/${txId}`).set(txData);
};

// ===============================================
// RESELLER FUNCTIONS
// ===============================================

/**
 * @desc    Purchase and provision a new Child Panel
 * @route   POST /api/v1/child-panel/purchase
 * @access  Private
 */
export const purchaseChildPanel = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { plan, price, panelName, subdomain, adminUsername, adminPassword } = req.body;

        if (!plan || !price || !panelName || !subdomain || !adminUsername || !adminPassword) {
            return errorResponse(res, 'Please provide plan, price, panel name, subdomain, and admin credentials', 400);
        }

        const cleanSubdomain = subdomain.toLowerCase().replace(/[^a-z0-9-]/g, '');

        const subdomainSnap = await getRef('childPanels').orderByChild('info/subdomain').equalTo(cleanSubdomain).get();
        if (subdomainSnap.exists()) {
            return errorResponse(res, 'This subdomain is already taken. Please choose another.', 400);
        }

        // Atomic Wallet Deduction
        const userBalanceRef = getRef(`users/${userId}/balance`);
        let hasSufficientFunds = false;

        await userBalanceRef.transaction((currentBalance) => {
            if ((currentBalance || 0) >= price) {
                hasSufficientFunds = true;
                return (currentBalance || 0) - price;
            }
            return currentBalance;
        });

        if (!hasSufficientFunds) {
            return errorResponse(res, 'Insufficient wallet balance to purchase this panel.', 400);
        }

        // Log the purchase transaction
        await logWalletTransaction(userId, 'debit', price, `Child Panel Purchase: ${panelName}`, 'Panel System');

        const hashedAdminPassword = await hashPassword(adminPassword);
        const panelId = generateUUID();
        const createdAt = new Date().toISOString();

        const panelData = {
            info: {
                panelId: panelId,
                panelName: panelName,
                ownerId: userId,
                subdomain: cleanSubdomain,
                customDomain: null,
                status: 'active',
                plan: plan,
                createdAt: createdAt,
                admin: { username: adminUsername, password: hashedAdminPassword }
            },
            branding: {
                logoUrl: '',
                primaryColor: '#F5A623',
                secondaryColor: '#08164A',
                footerText: `${panelName} - All rights reserved.`
            },
            settings: { maintenanceMode: false, allowRegistration: true, currency: 'USD' },
            statistics: { totalUsers: 0, totalOrders: 0, totalRevenue: 0 },
            users: {}, orders: {}, transactions: {}, pricing: {}
        };

        await getRef(`childPanels/${panelId}`).set(panelData);

        await getRef(`users/${userId}`).update({ role: 'reseller', childPanelId: panelId });

        logger.success(`Child Panel created: ${panelName} (${cleanSubdomain}) for user ${userId}`);
        return successResponse(res, 'Child Panel purchased successfully!', { panelId, subdomain: cleanSubdomain, panelName }, 201);

    } catch (error) {
        logger.error(`Error purchasing child panel: ${error.message}`);
        next(error);
    }
};

/**
 * @desc    Get Reseller Panel Details
 * @route   GET /api/v1/child-panel/me
 * @access  Private/Reseller
 */
export const getMyPanel = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const userSnap = await getRef(`users/${userId}`).get();
        
        if (!userSnap.exists()) return errorResponse(res, 'User not found', 404);
        
        const user = userSnap.val();
        if (user.role !== 'reseller' || !user.childPanelId) {
            return errorResponse(res, 'You do not own a child panel.', 403);
        }

        const panelSnap = await getRef(`childPanels/${user.childPanelId}`).get();
        if (!panelSnap.exists()) return errorResponse(res, 'Child panel not found', 404);

        return successResponse(res, 'Panel details fetched successfully', panelSnap.val());
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


// ===============================================
// SUPER ADMIN FUNCTIONS
// ===============================================

/**
 * @desc    Admin: Get all child panels
 * @route   GET /api/v1/child-panel/all
 * @access  Private/Admin
 */
export const getAllPanels = async (req, res, next) => {
    try {
        const snapshot = await getRef('childPanels').get();
        let panels = [];
        
        if (snapshot.exists()) {
            const panelsData = snapshot.val();
            
            for (const key in panelsData) {
                if (Object.hasOwnProperty.call(panelsData, key)) {
                    const panel = panelsData[key];
                    const ownerId = panel.info?.ownerId;
                    
                    const ownerSnap = ownerId ? await getRef(`users/${ownerId}`).get() : { exists: () => false };
                    const owner = ownerSnap.exists() ? ownerSnap.val() : {};
                    
                    panels.push({
                        id: key, 
                        info: {
                            ...panel.info,
                            ownerUsername: owner.username || 'Unknown',
                            ownerEmail: owner.email || '',
                            balance: owner.balance || 0,
                            totalDeposited: owner.totalDeposited || 0,
                            totalSpent: owner.spent || 0
                        },
                        statistics: panel.statistics || { totalUsers: 0, totalOrders: 0, totalRevenue: 0 }
                    });
                }
            }
        }
        return successResponse(res, 'Panels fetched successfully', panels);
    } catch (error) {
        next(error);
    }
};

/**
 * @desc    Admin: Get details of a specific child panel
 * @route   GET /api/v1/child-panel/:id
 * @access  Private/Admin
 */
export const getChildPanelDetails = async (req, res, next) => {
    try {
        const { id } = req.params;
        const snapshot = await getRef(`childPanels/${id}`).get();
        
        if (!snapshot.exists()) return errorResponse(res, 'Panel not found', 404);
        
        const panel = snapshot.val();
        const ownerSnap = await getRef(`users/${panel.info.ownerId}`).get();
        const owner = ownerSnap.exists() ? ownerSnap.val() : {};
        
        panel.info.ownerUsername = owner.username;
        panel.info.ownerEmail = owner.email;
        panel.info.balance = owner.balance || 0;
        
        return successResponse(res, 'Panel details fetched', panel);
    } catch (error) {
        next(error);
    }
};

/**
 * @desc    Admin: Suspend or Activate a child panel
 * @route   PUT /api/v1/child-panel/:id/status
 * @access  Private/Admin
 */
export const updateChildPanelStatus = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { status } = req.body; 
        
        if (!['active', 'suspended'].includes(status)) {
            return errorResponse(res, 'Status must be active or suspended', 400);
        }
        
        await getRef(`childPanels/${id}/info/status`).set(status);
        logger.success(`Panel ${id} status updated to ${status}`);
        return successResponse(res, `Panel status updated to ${status}`);
    } catch (error) {
        next(error);
    }
};

/**
 * @desc    Admin: Manually create a child panel (Bypass Payment)
 * @route   POST /api/v1/child-panel/admin-create
 * @access  Private/Admin
 */
export const adminCreateChildPanel = async (req, res, next) => {
    try {
        const { panelName, ownerId, subdomain, plan, adminUsername, adminPassword } = req.body;
        const cleanSubdomain = subdomain.toLowerCase().replace(/[^a-z0-9-]/g, '');

        const userSnap = await getRef(`users/${ownerId}`).get();
        if (!userSnap.exists()) return errorResponse(res, 'Owner User ID not found', 404);

        const subdomainSnap = await getRef('childPanels').orderByChild('info/subdomain').equalTo(cleanSubdomain).get();
        if (subdomainSnap.exists()) return errorResponse(res, 'Subdomain already taken', 400);

        const finalAdminUsername = adminUsername || `admin_${cleanSubdomain}`;
        const finalAdminPassword = adminPassword || 'password123'; 
        const hashedAdminPassword = await hashPassword(finalAdminPassword);

        const panelId = generateUUID();
        const createdAt = new Date().toISOString();

        const panelData = {
            info: {
                panelId, panelName, ownerId, subdomain: cleanSubdomain, customDomain: null,
                status: 'active', plan, createdAt,
                admin: { username: finalAdminUsername, password: hashedAdminPassword }
            },
            branding: { logoUrl: '', primaryColor: '#F5A623', secondaryColor: '#08164A', footerText: `${panelName} - All rights reserved.` },
            settings: { maintenanceMode: false, allowRegistration: true, currency: 'USD' },
            statistics: { totalUsers: 0, totalOrders: 0, totalRevenue: 0 },
            users: {}, orders: {}, transactions: {}, pricing: {}
        };

        await getRef(`childPanels/${panelId}`).set(panelData);
        await getRef(`users/${ownerId}`).update({ role: 'reseller', childPanelId: panelId });

        logger.success(`Admin created Child Panel: ${panelName} for user ${ownerId}`);
        return successResponse(res, 'Child Panel created successfully', { panelId, subdomain: cleanSubdomain }, 201);

    } catch (error) {
        next(error);
    }
};


// ===============================================
// SUPER ADMIN WALLET MANAGEMENT FUNCTIONS
// ===============================================

/**
 * @desc    Admin: Manually fund a reseller's main wallet
 * @route   POST /api/v1/child-panel/:id/fund
 * @access  Private/Admin
 */
export const fundChildPanelWallet = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { amount, description } = req.body;
        const finalAmount = parseFloat(amount);
        
        if (isNaN(finalAmount) || finalAmount <= 0) {
            return errorResponse(res, 'Invalid amount', 400);
        }

        const panelSnap = await getRef(`childPanels/${id}/info/ownerId`).get();
        if (!panelSnap.exists()) return errorResponse(res, 'Panel owner not found', 404);
        
        const ownerId = panelSnap.val();
        const ownerBalRef = getRef(`users/${ownerId}/balance`);
        
        await ownerBalRef.transaction((curr) => (curr || 0) + finalAmount);
        await logWalletTransaction(ownerId, 'credit', finalAmount, description || 'Manual deposit by Admin', 'Admin Top Up');
        
        logger.success(`Admin funded wallet of ${ownerId} with $${finalAmount}`);
        return successResponse(res, `Wallet funded with $${finalAmount.toFixed(2)} successfully`);
    } catch (error) {
        next(error);
    }
};

/**
 * @desc    Admin: Deduct funds from a reseller's main wallet
 * @route   POST /api/v1/child-panel/:id/deduct
 * @access  Private/Admin
 */
export const deductChildPanelWallet = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { amount, description } = req.body;
        const finalAmount = parseFloat(amount);

        if (isNaN(finalAmount) || finalAmount <= 0) {
            return errorResponse(res, 'Invalid amount', 400);
        }

        const panelSnap = await getRef(`childPanels/${id}/info/ownerId`).get();
        if (!panelSnap.exists()) return errorResponse(res, 'Panel owner not found', 404);

        const ownerId = panelSnap.val();
        const ownerBalRef = getRef(`users/${ownerId}/balance`);
        let deductionSuccessful = false;

        // Atomic check AND deduction to prevent race conditions
        await ownerBalRef.transaction((currentBalance) => {
            if ((currentBalance || 0) >= finalAmount) {
                deductionSuccessful = true;
                return (currentBalance || 0) - finalAmount;
            }
            return currentBalance; // Abort transaction if insufficient funds
        });

        if (!deductionSuccessful) {
            return errorResponse(res, 'Insufficient wallet balance to deduct this amount.', 400);
        }

        await logWalletTransaction(ownerId, 'debit', finalAmount, description || 'Manual deduction by Admin', 'Admin Deduction');

        logger.success(`Admin deducted $${finalAmount} from wallet of ${ownerId}`);
        return successResponse(res, `Wallet deducted by $${finalAmount.toFixed(2)} successfully`);
    } catch (error) {
        next(error);
    }
};

/**
 * @desc    Admin: Set (Overwrite) a reseller's main wallet balance
 * @route   PUT /api/v1/child-panel/:id/balance
 * @access  Private/Admin
 */
export const setChildPanelBalance = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { amount, reason } = req.body;
        const finalAmount = parseFloat(amount);

        if (isNaN(finalAmount) || finalAmount < 0) {
            return errorResponse(res, 'Invalid amount', 400);
        }

        const panelSnap = await getRef(`childPanels/${id}/info/ownerId`).get();
        if (!panelSnap.exists()) return errorResponse(res, 'Panel owner not found', 404);

        const ownerId = panelSnap.val();
        const ownerBalRef = getRef(`users/${ownerId}/balance`);
        let oldBalance = 0;

        await ownerBalRef.transaction((currentBalance) => {
            oldBalance = currentBalance || 0;
            return finalAmount; // Overwrite with new amount
        });

        const difference = finalAmount - oldBalance;
        if (difference !== 0) {
            const type = difference > 0 ? 'credit' : 'debit';
            const desc = `Balance set to $${finalAmount.toFixed(2)} by Admin. ${reason || ''}`.trim();
            await logWalletTransaction(ownerId, type, Math.abs(difference), desc, 'Admin Balance Set');
        }

        logger.success(`Admin set balance of ${ownerId} to $${finalAmount.toFixed(2)}`);
        return successResponse(res, `Balance updated to $${finalAmount.toFixed(2)} successfully`);
    } catch (error) {
        next(error);
    }
};

/**
 * @desc    Admin: Bulk fund multiple reseller wallets
 * @route   POST /api/v1/child-panel/bulk-fund
 * @access  Private/Admin
 */
export const bulkFundChildPanelWallets = async (req, res, next) => {
    try {
        const { panelIds, amount, description } = req.body;
        const finalAmount = parseFloat(amount);

        if (!Array.isArray(panelIds) || panelIds.length === 0) {
            return errorResponse(res, 'No panel IDs provided', 400);
        }
        if (isNaN(finalAmount) || finalAmount <= 0) {
            return errorResponse(res, 'Invalid amount', 400);
        }

        let successCount = 0;
        let failCount = 0;

        // Using for...of to ensure atomic transactions execute safely sequentially 
        // (prevents Firebase write quota exhaustion from Promise.all on huge arrays)
        for (const panelId of panelIds) {
            try {
                const panelSnap = await getRef(`childPanels/${panelId}/info/ownerId`).get();
                if (panelSnap.exists()) {
                    const ownerId = panelSnap.val();
                    const ownerBalRef = getRef(`users/${ownerId}/balance`);
                    
                    await ownerBalRef.transaction((curr) => (curr || 0) + finalAmount);
                    await logWalletTransaction(ownerId, 'credit', finalAmount, description || 'Bulk manual deposit by Admin', 'Admin Bulk Top Up');
                    successCount++;
                } else {
                    failCount++;
                }
            } catch (err) {
                logger.error(`Bulk fund failed for panel ${panelId}: ${err.message}`);
                failCount++;
            }
        }

        logger.success(`Admin bulk funded ${successCount} panels. Failed: ${failCount}`);
        return successResponse(res, `Successfully funded ${successCount} panels${failCount > 0 ? `. Failed to fund ${failCount} panels.` : ''}`);
    } catch (error) {
        next(error);
    }
};

/**
 * @desc    Admin: Get transactions for a specific panel owner (for the History Modal)
 * @route   GET /api/v1/child-panel/:id/transactions
 * @access  Private/Admin
 */
export const getChildPanelTransactions = async (req, res, next) => {
    try {
        const { id } = req.params;
        const panelSnap = await getRef(`childPanels/${id}/info/ownerId`).get();
        
        if (!panelSnap.exists()) return errorResponse(res, 'Panel owner not found', 404);

        const ownerId = panelSnap.val();
        const txSnap = await getRef(`users/${ownerId}/transactions`).get();
        
        if (!txSnap.exists()) return successResponse(res, 'Transactions fetched', []);

        // Convert object to array and sort by date descending
        const transactions = Object.values(txSnap.val()).sort((a, b) => new Date(b.date) - new Date(a.date));
        
        return successResponse(res, 'Transactions fetched', transactions);
    } catch (error) {
        next(error);
    }
};


// ===============================================
// ANNOUNCEMENTS FUNCTIONS
// ===============================================

/**
 * @desc    Get announcements for a specific child panel
 * @route   GET /api/v1/child-panel/announcements
 * @access  Private
 */
export const getPanelAnnouncements = async (req, res, next) => {
  try {
    let panelId = req.user.childPanelId || req.user.panelId;
    if (!panelId) {
      const userSnap = await getRef(`users/${req.user.id}/childPanelId`).get();
      panelId = userSnap.exists() ? userSnap.val() : null;
    }
    if (!panelId) return errorResponse(res, 'Panel ID not found', 400);

    const snap = await getRef(`childPanels/${panelId}/announcements`).get();
    const announcements = snap.exists() ? Object.values(snap.val()).reverse() : [];
    
    return successResponse(res, 'Announcements fetched', announcements);
  } catch (error) { next(error); }
};

/**
 * @desc    Create an announcement (Reseller only)
 * @route   POST /api/v1/child-panel/announcements
 * @access  Private/Reseller
 */
export const createPanelAnnouncement = async (req, res, next) => {
  try {
    let panelId = req.user.childPanelId;
    if (!panelId) {
      const userSnap = await getRef(`users/${req.user.id}/childPanelId`).get();
      panelId = userSnap.exists() ? userSnap.val() : null;
    }
    if (!panelId) return errorResponse(res, 'Not authorized as reseller', 403);

    const { title, message } = req.body;
    if (!title || !message) return errorResponse(res, 'Title and message are required', 400);

    const annId = generateUUID();
    const annData = { id: annId, title, message, createdAt: new Date().toISOString() };

    await getRef(`childPanels/${panelId}/announcements/${annId}`).set(annData);
    return successResponse(res, 'Announcement created successfully', annData, 201);
  } catch (error) { next(error); }
};

/**
 * @desc    Delete an announcement (Reseller only)
 * @route   DELETE /api/v1/child-panel/announcements/:id
 * @access  Private/Reseller
 */
export const deletePanelAnnouncement = async (req, res, next) => {
  try {
    let panelId = req.user.childPanelId;
    if (!panelId) {
      const userSnap = await getRef(`users/${req.user.id}/childPanelId`).get();
      panelId = userSnap.exists() ? userSnap.val() : null;
    }
    if (!panelId) return errorResponse(res, 'Not authorized as reseller', 403);

    const { id } = req.params;
    await getRef(`childPanels/${panelId}/announcements/${id}`).remove();
    return successResponse(res, 'Announcement deleted successfully');
  } catch (error) { next(error); }
};

// ===============================================
// Child Service Controller
// ===============================================

import { getRef } from '../database/firebase.js';
import { successResponse, errorResponse } from '../utils/response.js';

/**
 * @desc    Get services with reseller pricing
 * @route   GET /api/v1/child-panel/services
 * @access  Private/Reseller
 */
export const getPanelServices = async (req, res, next) => {
  try {
    const panelId = req.user.childPanelId;
    if (!panelId) return errorResponse(res, 'Not authorized', 403);

    const [mainServSnap, panelPricingSnap] = await Promise.all([
      getRef('services').get(),
      getRef(`childPanels/${panelId}/pricing`).get()
    ]);

    const panelPricing = panelPricingSnap.exists() ? panelPricingSnap.val() : {};
    const services = [];

    if (mainServSnap.exists()) {
      const mainServices = mainServSnap.val();
      for (const key in mainServices) {
        const svc = mainServices[key];
        if (svc.status === 'active') {
          services.push({
            id: key,
            name: svc.name,
            category: svc.category,
            costPrice: svc.costPrice, // What reseller pays
            sellingPrice: panelPricing[key]?.sellingPrice || svc.sellingPrice, // Reseller's custom price or fallback
            min: svc.min,
            max: svc.max,
            status: svc.status
          });
        }
      }
    }

    return successResponse(res, 'Services fetched', services);
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Bulk update reseller selling prices
 * @route   PUT /api/v1/child-panel/services/bulk-update
 * @access  Private/Reseller
 */
export const bulkUpdatePanelPrices = async (req, res, next) => {
  try {
    const panelId = req.user.childPanelId;
    const { updates } = req.body; // [{ id: "svc1", sellingPrice: 1.50 }]

    if (!Array.isArray(updates)) return errorResponse(res, 'Invalid updates format', 400);

    const updatesObj = {};
    updates.forEach(upd => {
      if (upd.id && upd.sellingPrice !== undefined) {
        updatesObj[`childPanels/${panelId}/pricing/${upd.id}/sellingPrice`] = parseFloat(upd.sellingPrice);
      }
    });

    await getRef().update(updatesObj);
    return successResponse(res, 'Prices updated successfully');
  } catch (error) {
    next(error);
  }
};

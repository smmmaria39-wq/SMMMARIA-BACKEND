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
    let panelId = req.user.childPanelId; 
    
    // Fallback: Fetch from database if middleware didn't pass childPanelId
    if (!panelId) {
      const userSnap = await getRef(`users/${req.user.id}/childPanelId`).get();
      panelId = userSnap.exists() ? userSnap.val() : null;
    }

    if (!panelId) return errorResponse(res, 'Not authorized as reseller', 403);

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
            // Reverted to 'name' and 'category' so the frontend doesn't show "undefined"
            name: svc.name,
            category: svc.category,
            // FIX: The reseller's cost price is the Main Panel's sellingPrice.
            // We completely hide svc.costPrice (the supplier price).
            costPrice: svc.sellingPrice, 
            // Reseller's custom price, or fallback to main panel selling price if not set
            sellingPrice: panelPricing[key]?.sellingPrice || svc.sellingPrice, 
            min: svc.min,
            max: svc.max,
            refill: svc.refill,
            cancel: svc.cancel,
            description: svc.description,
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
    let panelId = req.user.childPanelId; 
    
    // Fallback: Fetch from database if middleware didn't pass childPanelId
    if (!panelId) {
      const userSnap = await getRef(`users/${req.user.id}/childPanelId`).get();
      panelId = userSnap.exists() ? userSnap.val() : null;
    }

    if (!panelId) return errorResponse(res, 'Not authorized as reseller', 403);

    const { updates } = req.body; // [{ id: "svc1", sellingPrice: 1.50 }]

    if (!Array.isArray(updates)) return errorResponse(res, 'Invalid updates format', 400);

    // Fetch all main services to validate wholesale cost pricing
    const mainServSnap = await getRef('services').get();
    const mainServices = mainServSnap.exists() ? mainServSnap.val() : {};

    const updatesObj = {};
    const invalidPrices = [];
    const timestamp = new Date().toISOString();

    updates.forEach(upd => {
      if (upd.id && upd.sellingPrice !== undefined) {
        const newPrice = parseFloat(upd.sellingPrice);
        const mainService = mainServices[upd.id];

        if (mainService) {
          // FIX: Validation must check against the Main Panel's sellingPrice
          if (newPrice < mainService.sellingPrice) {
            invalidPrices.push({
              name: mainService.name,
              attemptedPrice: newPrice,
              minPrice: mainService.sellingPrice
            });
          } else {
            // Save ONLY to the child panel's isolated pricing node
            updatesObj[`childPanels/${panelId}/pricing/${upd.id}/sellingPrice`] = newPrice;
            // Calculate and store profit automatically based on main panel selling price
            updatesObj[`childPanels/${panelId}/pricing/${upd.id}/profit`] = newPrice - mainService.sellingPrice;
            // Store timestamp as required by documentation
            updatesObj[`childPanels/${panelId}/pricing/${upd.id}/updatedAt`] = timestamp;
          }
        }
      }
    });

    if (invalidPrices.length > 0) {
      return errorResponse(res, `Pricing error: Selling price cannot be lower than your wholesale cost ($${invalidPrices[0].minPrice}) for ${invalidPrices[0].name}.`, 400);
    }

    if (Object.keys(updatesObj).length > 0) {
      await getRef().update(updatesObj);
    }
    
    return successResponse(res, 'Prices updated successfully');
  } catch (error) {
    next(error);
  }
};

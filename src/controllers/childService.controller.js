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
            name: svc.name,
            category: svc.category,
            // The reseller's "Cost Price" is the Main Panel's "Selling Price"
            // We completely hide the original supplier cost (svc.costPrice)
            costPrice: svc.sellingPrice, 
            // Reseller's custom price, or fallback to main panel selling price if not set
            sellingPrice: panelPricing[key]?.sellingPrice || svc.sellingPrice, 
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
    let panelId = req.user.childPanelId; 
    
    // Fallback: Fetch from database if middleware didn't pass childPanelId
    if (!panelId) {
      const userSnap = await getRef(`users/${req.user.id}/childPanelId`).get();
      panelId = userSnap.exists() ? userSnap.val() : null;
    }

    if (!panelId) return errorResponse(res, 'Not authorized as reseller', 403);

    const { updates } = req.body; // [{ id: "svc1", sellingPrice: 1.50 }]

    if (!Array.isArray(updates)) return errorResponse(res, 'Invalid updates format', 400);

    // Fetch all main services to validate pricing
    const mainServSnap = await getRef('services').get();
    const mainServices = mainServSnap.exists() ? mainServSnap.val() : {};

    const updatesObj = {};
    const invalidPrices = [];

    updates.forEach(upd => {
      if (upd.id && upd.sellingPrice !== undefined) {
        const newPrice = parseFloat(upd.sellingPrice);
        const mainService = mainServices[upd.id];

        // Validation: Reseller selling price must be >= Main Panel selling price (their cost)
        if (mainService && newPrice < mainService.sellingPrice) {
          invalidPrices.push({
            name: mainService.name,
            attemptedPrice: newPrice,
            minPrice: mainService.sellingPrice
          });
        } else if (mainService) {
          // SAFETY CHECK: Only save if the service exists. 
          // This writes ONLY to the child panel's pricing node. The main services node is untouched.
          updatesObj[`childPanels/${panelId}/pricing/${upd.id}/sellingPrice`] = newPrice;
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

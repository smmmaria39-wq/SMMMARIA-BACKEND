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
            serviceName: svc.serviceName,
            categoryId: svc.categoryId,
            // Exposing the Main Panel's costPrice so the reseller knows their wholesale cost.
            // We intentionally DO NOT send any supplier fields (e.g., supplierId, supplierServiceId, supplierPrice).
            costPrice: svc.costPrice, 
            // Reseller's custom price, or fallback to wholesale cost if they haven't set a price yet
            sellingPrice: panelPricing[key]?.sellingPrice || svc.costPrice, 
            minimum: svc.minimum,
            maximum: svc.maximum,
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
          // Validation: Reseller selling price must be >= Main Panel wholesale cost (costPrice)
          if (newPrice < mainService.costPrice) {
            invalidPrices.push({
              serviceName: mainService.serviceName,
              attemptedPrice: newPrice
            });
          } else {
            // Save ONLY to the child panel's isolated pricing node
            updatesObj[`childPanels/${panelId}/pricing/${upd.id}/sellingPrice`] = newPrice;
            // Calculate and store profit automatically based on wholesale cost
            updatesObj[`childPanels/${panelId}/pricing/${upd.id}/profit`] = newPrice - mainService.costPrice;
            // Store timestamp as required by documentation
            updatesObj[`childPanels/${panelId}/pricing/${upd.id}/updatedAt`] = timestamp;
          }
        }
      }
    });

    if (invalidPrices.length > 0) {
      return errorResponse(res, `Pricing error: Selling price cannot be lower than your wholesale cost ($${invalidPrices[0].minPrice}) for ${invalidPrices[0].serviceName}.`, 400);
    }

    if (Object.keys(updatesObj).length > 0) {
      await getRef().update(updatesObj);
    }
    
    return successResponse(res, 'Prices updated successfully');
  } catch (error) {
    next(error);
  }
};

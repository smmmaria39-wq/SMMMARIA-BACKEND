// ===============================================
// Child Order Controller
// ===============================================

import { getRef } from '../database/firebase.js';
import { generateUUID } from '../utils/helpers.js';
import { successResponse, errorResponse } from '../utils/response.js';
import { placeSupplierOrder } from '../services/supplier.service.js';
import { logger } from '../utils/logger.js';

/**
 * @desc    Create order on Child Panel (Dual Wallet Deduction)
 * @route   POST /api/v1/child-panel/orders
 * @access  Private/ChildUser
 */
export const createChildOrder = async (req, res, next) => {
  try {
    const panelId = req.user.panelId; // Child User's panel ID from JWT
    const childUserId = req.user.id;
    const { serviceId, link, quantity } = req.body;

    // 1. Fetch Service Details
    const serviceSnap = await getRef(`services/${serviceId}`).get();
    if (!serviceSnap.exists()) return errorResponse(res, 'Service not found', 404);
    const service = serviceSnap.val();

    // 2. Fetch Panel Custom Price
    const pricingSnap = await getRef(`childPanels/${panelId}/pricing/${serviceId}`).get();
    const resellerPrice = pricingSnap.exists() ? pricingSnap.val().sellingPrice : service.sellingPrice;
    const mainCostPrice = service.costPrice; // What reseller pays SMMMARIA

    // 3. Calculate Charges
    const qty = parseInt(quantity);
    const customerCharge = parseFloat(((qty / 1000) * resellerPrice).toFixed(2));
    const resellerCharge = parseFloat(((qty / 1000) * mainCostPrice).toFixed(2));

    // 4. Check & Deduct Child User Balance
    const childUserBalRef = getRef(`childPanels/${panelId}/users/${childUserId}/balance`);
    let hasChildFunds = false;
    await childUserBalRef.transaction(curr => {
      if ((curr || 0) >= customerCharge) {
        hasChildFunds = true;
        return curr - customerCharge;
      }
      return curr;
    });

    if (!hasChildFunds) return errorResponse(res, 'Insufficient user balance', 400);

    // 5. Check & Deduct Reseller Main Wallet Balance
    const resellerIdSnap = await getRef(`childPanels/${panelId}/info/ownerId`).get();
    const resellerId = resellerIdSnap.val();
    
    const resellerBalRef = getRef(`users/${resellerId}/balance`);
    let hasResellerFunds = false;
    await resellerBalRef.transaction(curr => {
      if ((curr || 0) >= resellerCharge) {
        hasResellerFunds = true;
        return curr - resellerCharge;
      }
      return curr;
    });

    // 6. Handle Reseller Insufficient Funds (Refund Child User)
    if (!hasResellerFunds) {
      await childUserBalRef.transaction(curr => curr + customerCharge); // Refund
      return errorResponse(res, 'Panel owner out of balance. Please contact support.', 400);
    }

    // 7. Submit to Supplier
    const supplierResponse = await placeSupplierOrder(
      (await getRef(`suppliers/${service.supplierId}/apiUrl`).get()).val(),
      (await getRef(`suppliers/${service.supplierId}/apiKey`).get()).val(),
      { service: service.supplierServiceId, link, quantity: qty }
    );

    // 8. Handle Supplier Failure (Refund Both)
    if (!supplierResponse.success) {
      await childUserBalRef.transaction(curr => curr + customerCharge);
      await resellerBalRef.transaction(curr => curr + resellerCharge);
      return errorResponse(res, `Supplier Error: ${supplierResponse.error}`, 400);
    }

    // 9. Save Order to Child Panel Database
    const orderId = generateUUID();
    const orderData = {
      id: orderId,
      userId: childUserId,
      serviceId,
      supplierId: service.supplierId,
      supplierOrderId: supplierResponse.orderId.toString(),
      link,
      quantity: qty,
      charge: customerCharge, // What customer paid
      cost: resellerCharge, // What reseller paid
      profit: customerCharge - resellerCharge, // Reseller profit
      status: 'pending',
      createdAt: new Date().toISOString()
    };

    await getRef(`childPanels/${panelId}/orders/${orderId}`).set(orderData);
    
    // Update statistics
    await getRef(`childPanels/${panelId}/statistics/totalOrders`).transaction(curr => (curr || 0) + 1);

    logger.success(`Child Order ${orderId} created on panel ${panelId}`);
    return successResponse(res, 'Order placed successfully', orderData, 201);

  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get all orders for a specific Child Panel
 * @route   GET /api/v1/child-panel/orders
 * @access  Private/Reseller
 */
export const getPanelOrders = async (req, res, next) => {
  try {
    // The Reseller's JWT contains their childPanelId
    const panelId = req.user.childPanelId;
    if (!panelId) return errorResponse(res, 'Not authorized as reseller', 403);

    const snapshot = await getRef(`childPanels/${panelId}/orders`).get();
    let orders = [];
    
    if (snapshot.exists()) {
      orders = Object.values(snapshot.val()).reverse(); // Newest first
    }

    return successResponse(res, 'Orders fetched successfully', orders);
  } catch (error) {
    next(error);
  }
};

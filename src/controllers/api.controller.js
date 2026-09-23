import { getRef } from '../database/firebase.js';
import { successResponse, errorResponse } from '../utils/response.js';
import { generateUUID } from '../utils/helpers.js';

/**
 * @desc    Get API User Balance
 * @route   GET /api/v1/api/balance
 */
export const getBalance = async (req, res, next) => {
  try {
    return successResponse(res, 'Balance fetched', {
      balance: req.apiUser.balance || 0,
      currency: 'USD'
    });
  } catch (error) { next(error); }
};

/**
 * @desc    Get Available Services
 * @route   GET /api/v1/api/services
 */
export const getServices = async (req, res, next) => {
  try {
    const snap = await getRef('services').get();
    if (!snap.exists()) return successResponse(res, 'Services fetched', []);
    
    const services = [];
    snap.forEach(child => {
      const s = child.val();
      if (s.status === 'active') {
        services.push({
          service: child.key,
          name: s.serviceName || s.name,
          category: s.category || 'Uncategorized',
          rate: s.rate || 0, // Price per 1000
          min: s.min || 0,
          max: s.max || 0,
          refill: s.refill || false,
          type: s.type || 'default'
        });
      }
    });
    
    return successResponse(res, 'Services fetched', services);
  } catch (error) { next(error); }
};

/**
 * @desc    Create External Order
 * @route   POST /api/v1/api/orders
 */
export const createOrder = async (req, res, next) => {
  try {
    const { service: serviceId, link, quantity } = req.body;
    
    if (!serviceId || !link || !quantity) {
      return errorResponse(res, 'Missing required fields: service, link, quantity', 400);
    }

    const qty = parseInt(quantity);
    if (isNaN(qty) || qty <= 0) return errorResponse(res, 'Invalid quantity', 400);

    const serviceSnap = await getRef(`services/${serviceId}`).get();
    if (!serviceSnap.exists()) return errorResponse(res, 'Invalid service', 400);
    
    const service = serviceSnap.val();
    if (service.status !== 'active') return errorResponse(res, 'Service is not active', 400);
    if (qty < service.min || qty > service.max) {
      return errorResponse(res, `Quantity must be between ${service.min} and ${service.max}`, 400);
    }

    // Reuse existing pricing logic (rate per 1000)
    const charge = parseFloat(((qty / 1000) * service.rate).toFixed(2));

    // Atomic Wallet Deduction (Same billing engine as website)
    const userBalRef = getRef(`users/${req.apiUserId}/balance`);
    let hasSufficientFunds = false;
    
    await userBalRef.transaction((curr) => {
      if ((curr || 0) >= charge) {
        hasSufficientFunds = true;
        return (curr || 0) - charge;
      }
      return curr;
    });

    if (!hasSufficientFunds) return errorResponse(res, 'Insufficient balance', 400);

    // Submit to Supplier (Simulated existing integration)
    let supplierOrderId = null;
    try {
      // In the actual codebase, this calls supplier.service.js
      // const supplierRes = await supplierService.submitOrder(service, link, qty);
      // supplierOrderId = supplierRes.orderId;
      supplierOrderId = generateUUID(); // Placeholder
    } catch (err) {
      // Rollback funds if supplier fails
      await userBalRef.transaction((curr) => (curr || 0) + charge);
      return errorResponse(res, 'Supplier rejected the order. Funds refunded.', 400);
    }

    // Save Order (Reuses existing orders schema)
    const orderId = generateUUID();
    const orderData = {
      id: orderId,
      userId: req.apiUserId,
      serviceId: serviceId,
      serviceName: service.serviceName || service.name,
      link,
      quantity: qty,
      charge,
      status: 'pending',
      supplierId: service.supplierId || 'manual',
      supplierOrderId,
      startCount: 0,
      remains: qty,
      date: new Date().toISOString(),
      source: 'api'
    };

    await getRef(`orders/${orderId}`).set(orderData);

    return successResponse(res, 'Order created', { order: orderId });
  } catch (error) { next(error); }
};

/**
 * @desc    Get Order Status
 * @route   GET /api/v1/api/orders/:id
 */
export const getOrderStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const orderSnap = await getRef(`orders/${id}`).get();
    
    if (!orderSnap.exists()) return errorResponse(res, 'Order not found', 404);
    
    const order = orderSnap.val();
    
    // Security: Prevent cross-user order inspection
    if (order.userId !== req.apiUserId) {
      return errorResponse(res, 'Order not found', 404);
    }

    return successResponse(res, 'Order status', {
      order: id,
      status: order.status,
      charge: order.charge,
      start_count: order.startCount || 0,
      remains: order.remains || 0,
      currency: 'USD'
    });
  } catch (error) { next(error); }
};

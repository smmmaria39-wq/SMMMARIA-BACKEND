import { getRef } from '../database/firebase.js';
import axios from 'axios';

// Helper for standard SMM API error responses
const errorResponse = (res, message, status = 400) => {
  return res.status(status).json({ error: message });
};

// Helper to map internal statuses to standard SMM API statuses
const mapStatus = (status) => {
  const map = {
    'pending': 'Pending',
    'processing': 'In progress',
    'in_progress': 'In progress',
    'completed': 'Completed',
    'partial': 'Partial',
    'canceled': 'Canceled',
    'cancelled': 'Canceled',
    'refunded': 'Refunded'
  };
  return map[String(status || '').toLowerCase()] || 'Pending';
};

/**
 * @desc    Provider API V2 Handler
 * @route   POST /api/v2
 */
export const providerApiController = async (req, res, next) => {
  try {
    const { key, action } = req.body;

    // 1. Authenticate via API Key in body (standard SMM format)
    if (!key) return errorResponse(res, 'Missing API key', 401);
    
    const keyIndexSnap = await getRef(`apiKeys/${key}`).get();
    if (!keyIndexSnap.exists()) return errorResponse(res, 'Invalid API key', 401);
    
    const userId = keyIndexSnap.val();
    const userSnap = await getRef(`users/${userId}`).get();
    if (!userSnap.exists()) return errorResponse(res, 'Invalid API key', 401);
    
    const user = userSnap.val();
    if (user.status && user.status !== 'active') return errorResponse(res, 'Account is suspended', 403);

    // 2. Route to specific action
    if (!action) return errorResponse(res, 'Missing action');

    switch (action) {
      case 'services':
        return await getServicesAction(res);
      case 'balance':
        return res.json({ balance: String(user.balance || 0), currency: 'USD' });
      case 'add':
        return await addOrderAction(req, res, userId, user);
      case 'status':
        return await getStatusAction(req, res, userId);
      case 'cancel':
        return await cancelOrderAction(req, res, userId);
      case 'refill':
        return await refillOrderAction(req, res, userId);
      default:
        return errorResponse(res, 'Invalid action');
    }
  } catch (error) {
    console.error('[Provider API V2] Error:', error.message);
    return errorResponse(res, 'Internal server error', 500);
  }
};

// ==========================================
// ACTION: services
// ==========================================
const getServicesAction = async (res) => {
  const snap = await getRef('services').get();
  if (!snap.exists()) return res.json([]);

  const services = [];
  snap.forEach(child => {
    const s = child.val();
    if (s.status === 'active') {
      services.push({
        service: child.key,
        name: s.serviceName || s.name,
        type: s.type || 'Default',
        category: s.category || 'Uncategorized',
        rate: String(s.rate || 0), // SMM APIs expect strings
        min: String(s.min || 0),
        max: String(s.max || 0),
        refill: s.refill === true ? 1 : 0, 
        cancel: s.cancel === true ? 1 : 0
      });
    }
  });

  return res.json(services);
};

// ==========================================
// ACTION: add
// ==========================================
const addOrderAction = async (req, res, userId, user) => {
  const { service: serviceId, link, quantity } = req.body;
  
  if (!serviceId || !link || !quantity) return errorResponse(res, 'Missing required fields: service, link, quantity');
  const qty = parseInt(quantity);
  if (isNaN(qty) || qty <= 0) return errorResponse(res, 'Invalid quantity');

  const serviceSnap = await getRef(`services/${serviceId}`).get();
  if (!serviceSnap.exists()) return errorResponse(res, 'Service not found');
  
  const service = serviceSnap.val();
  if (service.status !== 'active') return errorResponse(res, 'Service is not active');
  if (qty < service.min || qty > service.max) return errorResponse(res, 'Quantity is outside the allowed range');

  // Calculate charge using existing SMMaria pricing logic
  const charge = parseFloat(((qty / 1000) * service.rate).toFixed(2));

  // 1. Atomic Wallet Deduction
  const userBalRef = getRef(`users/${userId}/balance`);
  let hasSufficientFunds = false;
  
  await userBalRef.transaction((curr) => {
    if ((curr || 0) >= charge) {
      hasSufficientFunds = true;
      return (curr || 0) - charge;
    }
    return curr;
  });

  if (!hasSufficientFunds) return errorResponse(res, 'Insufficient balance');

  // 2. Submit to REAL Supplier (Reusing existing DB structure)
  let supplierOrderId = null;
  const supplierId = service.supplierId || 'manual';

  try {
    if (supplierId !== 'manual' && service.supplierServiceId) {
      const supplierSnap = await getRef(`suppliers/${supplierId}`).get();
      if (supplierSnap.exists()) {
        const supplier = supplierSnap.val();
        
        // Call the actual upstream supplier
        const supplierRes = await axios.post(supplier.apiUrl, {
          key: supplier.apiKey,
          action: 'add',
          service: service.supplierServiceId,
          link: link,
          quantity: qty
        });
        
        if (supplierRes.data && supplierRes.data.order) {
          supplierOrderId = String(supplierRes.data.order);
        } else {
          throw new Error(supplierRes.data?.error || 'Supplier rejected order');
        }
      }
    }
  } catch (err) {
    // Refund user if supplier fails
    await userBalRef.transaction((curr) => (curr || 0) + charge);
    return errorResponse(res, `Supplier error: ${err.message}. Funds refunded.`, 400);
  }

  // 3. Save Order (Reuses existing orders node)
  // Using a 6-digit integer ID for better SMM panel compatibility
  const orderId = Math.floor(100000 + Math.random() * 900000).toString();
  
  const orderData = {
    id: orderId,
    userId: userId,
    serviceId: serviceId,
    serviceName: service.serviceName || service.name,
    link: link,
    quantity: qty,
    charge: charge,
    status: 'pending',
    supplierId: supplierId,
    supplierOrderId: supplierOrderId || 'N/A',
    startCount: 0,
    remains: qty,
    date: new Date().toISOString(),
    source: 'api_v2'
  };

  await getRef(`orders/${orderId}`).set(orderData);

  return res.json({ order: orderId });
};

// ==========================================
// ACTION: status
// ==========================================
const getStatusAction = async (req, res, userId) => {
  const { order: orderId } = req.body;
  if (!orderId) return errorResponse(res, 'Missing order ID');

  const orderSnap = await getRef(`orders/${orderId}`).get();
  if (!orderSnap.exists()) return errorResponse(res, 'Order not found');

  const order = orderSnap.val();
  
  // Security: Prevent cross-user order inspection
  if (order.userId !== userId) return errorResponse(res, 'Order not found');

  return res.json({
    charge: String(order.charge || 0),
    start_count: order.startCount || 0,
    status: mapStatus(order.status),
    remains: order.remains || 0,
    currency: 'USD'
  });
};

// ==========================================
// ACTION: cancel
// ==========================================
const cancelOrderAction = async (req, res, userId) => {
  const { order: orderId } = req.body;
  if (!orderId) return errorResponse(res, 'Missing order ID');

  const orderRef = getRef(`orders/${orderId}`);
  const orderSnap = await orderRef.get();
  if (!orderSnap.exists()) return errorResponse(res, 'Order not found');

  const order = orderSnap.val();
  if (order.userId !== userId) return errorResponse(res, 'Order not found');

  if (order.status !== 'pending' && order.status !== 'processing') {
    return errorResponse(res, 'Order cannot be cancelled');
  }

  // Call Supplier Cancel
  try {
    if (order.supplierId !== 'manual' && order.supplierOrderId && order.supplierOrderId !== 'N/A') {
      const supplierSnap = await getRef(`suppliers/${order.supplierId}`).get();
      if (supplierSnap.exists()) {
        const supplier = supplierSnap.val();
        await axios.post(supplier.apiUrl, {
          key: supplier.apiKey,
          action: 'cancel',
          order: order.supplierOrderId
        });
      }
    }
    
    // Refund user using existing balance logic
    const userBalRef = getRef(`users/${userId}/balance`);
    await userBalRef.transaction((curr) => (curr || 0) + order.charge);
    
    // Update order
    await orderRef.update({ status: 'canceled', remains: 0 });
    
    return res.json({ status: 'Canceled' });
  } catch (err) {
    return errorResponse(res, 'Failed to cancel order at supplier', 400);
  }
};

// ==========================================
// ACTION: refill
// ==========================================
const refillOrderAction = async (req, res, userId) => {
  const { order: orderId } = req.body;
  if (!orderId) return errorResponse(res, 'Missing order ID');

  const orderRef = getRef(`orders/${orderId}`);
  const orderSnap = await orderRef.get();
  if (!orderSnap.exists()) return errorResponse(res, 'Order not found');

  const order = orderSnap.val();
  if (order.userId !== userId) return errorResponse(res, 'Order not found');

  if (order.status !== 'completed') {
    return errorResponse(res, 'Order is not eligible for refill');
  }

  // Check if service supports refill
  const serviceSnap = await getRef(`services/${order.serviceId}`).get();
  if (!serviceSnap.exists() || !serviceSnap.val().refill) {
    return errorResponse(res, 'Service does not support refill');
  }

  // Call Supplier Refill
  try {
    if (order.supplierId !== 'manual' && order.supplierOrderId && order.supplierOrderId !== 'N/A') {
      const supplierSnap = await getRef(`suppliers/${order.supplierId}`).get();
      if (supplierSnap.exists()) {
        const supplier = supplierSnap.val();
        const refillRes = await axios.post(supplier.apiUrl, {
          key: supplier.apiKey,
          action: 'refill',
          order: order.supplierOrderId
        });
        
        if (refillRes.data && refillRes.data.refill) {
          await orderRef.update({ status: 'processing', refillId: String(refillRes.data.refill) });
          return res.json({ refill: String(refillRes.data.refill) });
        } else {
          throw new Error(refillRes.data?.error || 'Supplier rejected refill');
        }
      }
    }
    return errorResponse(res, 'Refill not supported for this order', 400);
  } catch (err) {
    return errorResponse(res, err.message || 'Failed to request refill', 400);
  }
};

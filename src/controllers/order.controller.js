// ===============================================
// Order Controller
// ===============================================

import { getRef } from '../database/firebase.js';
import { generateUUID } from '../utils/helpers.js';
import { successResponse, errorResponse } from '../utils/response.js';
import { logger } from '../utils/logger.js';
import { placeSupplierOrder } from '../services/supplier.service.js';

/**
 * @desc    Create a new order
 * @route   POST /api/v1/orders
 * @access  Private
 */
export const createOrder = async (req, res, next) => {
    try {
        const { serviceId, link, quantity } = req.body;
        const userId = req.user.id;

        // 1. Fetch Service Details
        const serviceSnap = await getRef(`services/${serviceId}`).get();
        if (!serviceSnap.exists()) return errorResponse(res, 'Service not found', 404);
        
        const service = serviceSnap.val();
        if (service.status !== 'active') return errorResponse(res, 'Service is currently unavailable', 400);

        // 2. Validate Quantity
        const qty = parseInt(quantity);
        if (qty < service.min || qty > service.max) {
            return errorResponse(res, `Quantity must be between ${service.min} and ${service.max}`, 400);
        }

        // 3. Calculate Charge
        const charge = parseFloat(((qty / 1000) * service.sellingPrice).toFixed(2));

        // 4. Check & Deduct Wallet Balance Atomically
        const userBalanceRef = getRef(`users/${userId}/balance`);
        let hasSufficientFunds = false;

        await userBalanceRef.transaction((currentBalance) => {
            if ((currentBalance || 0) >= charge) {
                hasSufficientFunds = true;
                return (currentBalance || 0) - charge; // Deduct
            }
            return currentBalance; // Not enough funds, return unchanged
        });

        if (!hasSufficientFunds) {
            return errorResponse(res, 'Insufficient wallet balance', 400);
        }

        // 5. Submit to Supplier
        const supplierResponse = await placeSupplierOrder(
            (await getRef(`suppliers/${service.supplierId}/apiUrl`).get()).val(),
            (await getRef(`suppliers/${service.supplierId}/apiKey`).get()).val(),
            { service: service.supplierServiceId, link, quantity: qty }
        );

        // 6. Handle Supplier Response
        if (!supplierResponse.success) {
            // REFUND LOGIC: Supplier rejected the order, refund the user immediately
            await userBalanceRef.transaction((currentBalance) => {
                return (currentBalance || 0) + charge;
            });
            
            const failedOrderId = generateUUID();
            await getRef(`orders/${failedOrderId}`).set({
                id: failedOrderId,
                userId,
                serviceId,
                link,
                quantity: qty,
                charge,
                status: 'failed',
                error: supplierResponse.error,
                createdAt: new Date().toISOString()
            });

            return errorResponse(res, `Supplier Error: ${supplierResponse.error}`, 400);
        }

        // 7. Save Successful Order to Firebase
        const orderId = generateUUID();
        const orderData = {
            id: orderId,
            userId,
            serviceId,
            supplierId: service.supplierId,
            supplierOrderId: supplierResponse.orderId.toString(),
            link,
            quantity: qty,
            charge,
            startCount: 0,
            remains: qty,
            status: 'pending',
            createdAt: new Date().toISOString()
        };

        await getRef(`orders/${orderId}`).set(orderData);

        // Update user's total spent
        await getRef(`users/${userId}/spent`).transaction((currentSpent) => (currentSpent || 0) + charge);

        // ==========================================
        // AFFILIATE COMMISSION LOGIC
        // ==========================================
        // Fetch the user object to check if they were referred by someone
        const userSnap = await getRef(`users/${userId}`).get();
        if (userSnap.exists()) {
            const userObj = userSnap.val();
            if (userObj.referredBy) {
                const commissionRate = 0.05; // 5% commission rate
                const commission = parseFloat((charge * commissionRate).toFixed(2));
                
                if (commission > 0) {
                    // 1. Add commission to the referrer's main wallet balance
                    const referrerBalanceRef = getRef(`users/${userObj.referredBy}/balance`);
                    await referrerBalanceRef.transaction((currentBalance) => {
                        return (currentBalance || 0) + commission;
                    });
                    
                    // 2. Add commission to the referrer's total referralCommission tracker
                    const referrerCommissionRef = getRef(`users/${userObj.referredBy}/referralCommission`);
                    await referrerCommissionRef.transaction((currentComm) => {
                        return (currentComm || 0) + commission;
                    });

                    logger.info(`Paid $${commission} affiliate commission to ${userObj.referredBy}`);
                }
            }
        }
        // ==========================================

        logger.success(`Order ${orderId} created for user ${userId}`);
        return successResponse(res, 'Order placed successfully', orderData, 201);

    } catch (error) {
        next(error);
    }
};

/**
 * @desc    Get orders (User gets their own, Admin gets all)
 * @route   GET /api/v1/orders
 * @access  Private
 */
export const getOrders = async (req, res, next) => {
    try {
        const snapshot = await getRef('orders').get();
        let orders = [];
        
        if (snapshot.exists()) {
            const ordersData = snapshot.val();
            for (const key in ordersData) {
                if (Object.hasOwnProperty.call(ordersData, key)) {
                    // Attach the Firebase key as 'id'
                    orders.push({ id: key, ...ordersData[key] });
                }
            }
            orders.reverse(); // Newest first
        }
        
        // If it's a standard user, only return their orders
        if (req.user.role === 'user') {
            orders = orders.filter(o => o.userId === req.user.id);
        }
        
        return successResponse(res, 'Orders fetched successfully', orders);
    } catch (error) {
        next(error);
    }
};

/**
 * @desc    Get single order by ID
 * @route   GET /api/v1/orders/:id
 * @access  Private
 */
export const getOrderById = async (req, res, next) => {
    try {
        const { id } = req.params;
        const snapshot = await getRef(`orders/${id}`).get();
        
        if (!snapshot.exists()) return errorResponse(res, 'Order not found', 404);
        
        const order = snapshot.val();

        // Ensure users can only view their own orders
        if (req.user.role === 'user' && order.userId !== req.user.id) {
            return errorResponse(res, 'Not authorized to view this order', 403);
        }

        return successResponse(res, 'Order fetched successfully', order);
    } catch (error) {
        next(error);
    }
};

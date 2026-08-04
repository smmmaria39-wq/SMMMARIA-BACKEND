// ===============================================
// Cron Jobs: Sync Orders (Main & Child) & Check Pending Payments
// ===============================================

import cron from 'node-cron';
import { getRef } from '../database/firebase.js';
import { fetchSupplierOrderStatus } from '../services/order.service.js';
import { checkPendingPayments } from '../controllers/payment.controller.js';
import { logger } from '../utils/logger.js';

// ==========================================
// JOB 1: Sync Main Panel Order Statuses (Every 5 minutes)
// ==========================================
export const startOrderSyncJob = () => {
 cron.schedule('*/5 * * * *', async () => {
  logger.info('⏳ [Cron] Running MAIN order sync job...');
  
  try {
   const ordersSnap = await getRef('orders').get();
   if (!ordersSnap.exists()) return;
   
   const allOrders = Object.values(ordersSnap.val());
   const activeOrders = allOrders.filter(o => o.status === 'pending' || o.status === 'processing' || o.status === 'in_progress');
   
   if (activeOrders.length === 0) return;
   
   const ordersBySupplier = {};
   activeOrders.forEach(order => {
    if (!ordersBySupplier[order.supplierId]) ordersBySupplier[order.supplierId] = [];
    ordersBySupplier[order.supplierId].push(order);
   });
   
   for (const supplierId in ordersBySupplier) {
    const supplierSnap = await getRef(`suppliers/${supplierId}`).get();
    if (!supplierSnap.exists()) continue;
    
    const supplier = supplierSnap.val();
    const ordersToUpdate = ordersBySupplier[supplierId];
    const supplierOrderIds = ordersToUpdate.map(o => o.supplierOrderId);
    
    const statuses = await fetchSupplierOrderStatus(supplier.apiUrl, supplier.apiKey, supplierOrderIds);
    
    for (const order of ordersToUpdate) {
     const supplierStatus = statuses[order.supplierOrderId];
     if (!supplierStatus) continue;
     
     const newStatus = supplierStatus.status.toLowerCase();
     
     if (order.status !== newStatus) {
      await getRef(`orders/${order.id}`).update({
       status: newStatus,
       startCount: parseInt(supplierStatus.start_count) || 0,
       remains: parseInt(supplierStatus.remains) || 0
      });
      
      if (newStatus === 'partial' || newStatus === 'canceled') {
       const remains = parseInt(supplierStatus.remains) || 0;
       if (remains > 0) {
        const refundAmount = parseFloat(((order.charge / order.quantity) * remains).toFixed(2));
        if (refundAmount > 0) {
         const userBalanceRef = getRef(`users/${order.userId}/balance`);
         await userBalanceRef.transaction((curr) => (curr || 0) + refundAmount);
         
         const txId = `refund_${order.id}`;
         await getRef(`transactions/${txId}`).set({
          id: txId, userId: order.userId, type: 'refund', amount: refundAmount, 
          status: 'approved', date: new Date().toISOString(), description: `Refund for order #${order.id}`
         });
         logger.success(`[Cron Main] Refunded $${refundAmount} to user ${order.userId}`);
        }
       }
      }
      logger.info(`[Cron Main] Order ${order.id} updated to ${newStatus}`);
     }
    }
   }
  } catch (error) {
    logger.error(`[Cron Main] Order sync job failed: ${error.message}`);
  }
 });
};

// ==========================================
// JOB 2: Check Pending PesaJet Payments (Every 2 minutes)
// ==========================================
export const startPaymentSyncJob = () => {
  cron.schedule('*/2 * * * *', async () => {
    logger.info('⏳ [Cron] Running pending payments check...');
    try {
      await checkPendingPayments();
    } catch (error) {
      logger.error(`[Cron] Payment sync job failed: ${error.message}`);
    }
  });
};

// ==========================================
// JOB 3: Sync Child Panel Orders (Every 10 minutes)
// ==========================================
export const startChildOrderSyncJob = () => {
  cron.schedule('*/10 * * * *', async () => {
    logger.info('⏳ [Cron] Running CHILD PANEL order sync job...');
    
    try {
      const panelsSnap = await getRef('childPanels').get();
      if (!panelsSnap.exists()) return;
      
      const panels = Object.values(panelsSnap.val());
      
      for (const panel of panels) {
        const panelId = panel.info.panelId;
        const ownerId = panel.info.ownerId;
        
        const childOrdersSnap = await getRef(`childPanels/${panelId}/orders`).get();
        if (!childOrdersSnap.exists()) continue;
        
        const childOrders = Object.values(childOrdersSnap.val());
        const activeChildOrders = childOrders.filter(o => o.status === 'pending' || o.status === 'processing' || o.status === 'in_progress');
        
        if (activeChildOrders.length === 0) continue;
        
        // Group by supplier
        const ordersBySupplier = {};
        activeChildOrders.forEach(order => {
          if (!ordersBySupplier[order.supplierId]) ordersBySupplier[order.supplierId] = [];
          ordersBySupplier[order.supplierId].push(order);
        });
        
        for (const supplierId in ordersBySupplier) {
          const supplierSnap = await getRef(`suppliers/${supplierId}`).get();
          if (!supplierSnap.exists()) continue;
          
          const supplier = supplierSnap.val();
          const ordersToUpdate = ordersBySupplier[supplierId];
          const supplierOrderIds = ordersToUpdate.map(o => o.supplierOrderId);
          
          const statuses = await fetchSupplierOrderStatus(supplier.apiUrl, supplier.apiKey, supplierOrderIds);
          
          for (const order of ordersToUpdate) {
            const supplierStatus = statuses[order.supplierOrderId];
            if (!supplierStatus) continue;
            
            const newStatus = supplierStatus.status.toLowerCase();
            
            if (order.status !== newStatus) {
              // Update child order status
              await getRef(`childPanels/${panelId}/orders/${order.id}`).update({
                status: newStatus,
                startCount: parseInt(supplierStatus.start_count) || 0,
                remains: parseInt(supplierStatus.remains) || 0
              });
              
              // Handle Dual Refunds (Child User AND Reseller)
              if (newStatus === 'partial' || newStatus === 'canceled') {
                const remains = parseInt(supplierStatus.remains) || 0;
                if (remains > 0) {
                  // 1. Calculate Proportional Refunds
                  const customerRefund = parseFloat(((order.charge / order.quantity) * remains).toFixed(2));
                  const resellerRefund = parseFloat(((order.cost / order.quantity) * remains).toFixed(2));
                  
                  // 2. Refund Child User
                  if (customerRefund > 0) {
                    const childBalRef = getRef(`childPanels/${panelId}/users/${order.userId}/balance`);
                    await childBalRef.transaction((curr) => (curr || 0) + customerRefund);
                  }
                  
                  // 3. Refund Reseller Main Wallet
                  if (resellerRefund > 0) {
                    const resellerBalRef = getRef(`users/${ownerId}/balance`);
                    await resellerBalRef.transaction((curr) => (curr || 0) + resellerRefund);
                  }
                  
                  logger.success(`[Cron Child] Refunded $${customerRefund} to child user ${order.userId} and $${resellerRefund} to reseller ${ownerId}`);
                }
              }
              logger.info(`[Cron Child] Panel ${panelId} Order ${order.id} updated to ${newStatus}`);
            }
          }
        }
      }
    } catch (error) {
      logger.error(`[Cron Child] Order sync job failed: ${error.message}`);
    }
  });
};

// ===============================================
// Cron Job: Sync Order Statuses
// Runs every 5 minutes
// ===============================================

import cron from 'node-cron';
import { getRef } from '../database/firebase.js';
import { fetchSupplierOrderStatus } from '../services/order.service.js';
import { logger } from '../utils/logger.js';

export const startOrderSyncJob = () => {
 cron.schedule('*/5 * * * *', async () => {
  logger.info('⏳ [Cron] Running order sync job...');
  
  try {
   const ordersSnap = await getRef('orders').get();
   if (!ordersSnap.exists()) return;
   
   const allOrders = Object.values(ordersSnap.val());
   
   // Filter orders that are still in progress
   const activeOrders = allOrders.filter(o =>
    o.status === 'pending' || o.status === 'processing' || o.status === 'in_progress'
   );
   
   if (activeOrders.length === 0) return;
   
   // Group orders by supplier to minimize API calls
   const ordersBySupplier = {};
   activeOrders.forEach(order => {
    if (!ordersBySupplier[order.supplierId]) {
     ordersBySupplier[order.supplierId] = [];
    }
    ordersBySupplier[order.supplierId].push(order);
   });
   
   // Process each supplier's orders
   for (const supplierId in ordersBySupplier) {
    const supplierSnap = await getRef(`suppliers/${supplierId}`).get();
    if (!supplierSnap.exists()) continue;
    
    const supplier = supplierSnap.val();
    const ordersToUpdate = ordersBySupplier[supplierId];
    const supplierOrderIds = ordersToUpdate.map(o => o.supplierOrderId);
    
    // Fetch statuses from supplier
    const statuses = await fetchSupplierOrderStatus(supplier.apiUrl, supplier.apiKey, supplierOrderIds);
    
    // Update each order in Firebase
    for (const order of ordersToUpdate) {
     const supplierStatus = statuses[order.supplierOrderId];
     if (!supplierStatus) continue;
     
     const newStatus = supplierStatus.status.toLowerCase(); // e.g., 'completed', 'partial', 'canceled'
     
     // If status changed
     if (order.status !== newStatus) {
      await getRef(`orders/${order.id}`).update({
       status: newStatus,
       startCount: parseInt(supplierStatus.start_count) || 0,
       remains: parseInt(supplierStatus.remains) || 0
      });
      
      // Handle Partial or Canceled Refunds
      if (newStatus === 'partial' || newStatus === 'canceled') {
       const remains = parseInt(supplierStatus.remains) || 0;
       if (remains > 0) {
        // Calculate proportional refund
        const refundAmount = parseFloat(((order.charge / order.quantity) * remains).toFixed(2));
        
        if (refundAmount > 0) {
         const userBalanceRef = getRef(`users/${order.userId}/balance`);
         await userBalanceRef.transaction((currentBalance) => {
          return (currentBalance || 0) + refundAmount;
         });
         
         // Log refund transaction
         const txId = `refund_${order.id}`;
         await getRef(`transactions/${txId}`).set({
          id: txId,
          userId: order.userId,
          type: 'refund',
          amount: refundAmount,
          status: 'approved',
          date: new Date().toISOString(),
          description: `Refund for order #${order.id} (Status: ${newStatus})`
         });
         
         logger.success(`[Cron] Refunded $${refundAmount} to user ${order.userId} for order ${order.id}`);
        }
       }
      }
      
      logger.info(`[Cron] Order ${order.id} updated to ${newStatus}`);
     }
    }
   }
  } catch (error) {
   logger.error(`[Cron] Order sync job failed: ${error.message}`);
  }
 });
};
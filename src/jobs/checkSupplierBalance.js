// ===============================================
// Cron Job: Check Supplier Balances
// Runs daily at 2:00 AM
// ===============================================

import cron from 'node-cron';
import { getRef } from '../database/firebase.js';
import { fetchSupplierBalance } from '../services/supplier.service.js';
import { logger } from '../utils/logger.js';

export const startSupplierBalanceJob = () => {
 cron.schedule('0 2 * * *', async () => {
  logger.info('⏳ [Cron] Running supplier balance check job...');
  
  try {
   const suppliersSnap = await getRef('suppliers').get();
   if (!suppliersSnap.exists()) return;
   
   const suppliers = Object.values(suppliersSnap.val());
   
   for (const supplier of suppliers) {
    if (supplier.status !== 'active') continue;
    
    try {
     const balance = await fetchSupplierBalance(supplier.apiUrl, supplier.apiKey);
     await getRef(`suppliers/${supplier.id}/balance`).set(balance);
     logger.info(`[Cron] Supplier ${supplier.name} balance updated: $${balance}`);
    } catch (error) {
     logger.error(`[Cron] Failed to fetch balance for supplier ${supplier.name}`);
    }
   }
  } catch (error) {
   logger.error(`[Cron] Supplier balance job failed: ${error.message}`);
  }
 });
};
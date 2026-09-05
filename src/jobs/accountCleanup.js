// ===============================================
// Account Cleanup Cron Job (Optimized)
// ===============================================

import cron from 'node-cron';
import { getRef } from '../database/firebase.js';
import { logger } from '../utils/logger.js';

// Runs every 10 minutes
export const startAccountCleanupJob = () => {
  cron.schedule('*/10 * * * *', async () => {
    logger.info('[Cron] Running account cleanup job...');
    
    try {
      // OPTIMIZATION: Only fetch accounts that are currently 'reserved'
      const snapshot = await getRef('accountInventory').orderByChild('status').equalTo('reserved').get();
      
      if (!snapshot.exists()) {
        logger.info('[Cron] Account cleanup finished. No stuck accounts found.');
        return;
      }

      const now = Date.now();
      const tenMinutes = 10 * 60 * 1000;
      let cleanedCount = 0;
      const updates = {};

      snapshot.forEach((childSnapshot) => {
        const account = childSnapshot.val();
        const accountId = childSnapshot.key;

        // If the reservation is older than 10 minutes
        if (account.reservedAt && (now - account.reservedAt > tenMinutes)) {
          updates[`accountInventory/${accountId}/status`] = 'available';
          updates[`accountInventory/${accountId}/reservedAt`] = null;
          updates[`accountInventory/${accountId}/reservedBy`] = null;
          cleanedCount++;
        }
      });

      if (cleanedCount > 0) {
        await getRef('/').update(updates);
        logger.info(`🧹 [Cron] Account Cleanup: Reverted ${cleanedCount} abandoned reserved accounts to available.`);
      } else {
        logger.info('[Cron] Account cleanup finished. No stuck accounts older than 10 minutes found.');
      }
    } catch (error) {
      logger.error(`[Cron] Account Cleanup Job Error: ${error.message}`);
    }
  });
};

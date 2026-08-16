// ===============================================
// Account Cleanup Cron Job
// ===============================================

import cron from 'node-cron';
import { getRef } from '../database/firebase.js';
import { logger } from '../utils/logger.js';

// Runs every 10 minutes
export const startAccountCleanupJob = () => {
  cron.schedule('*/10 * * * *', async () => {
    try {
      const snapshot = await getRef('accountInventory').get();
      if (!snapshot.exists()) return;

      const now = Date.now();
      const tenMinutes = 10 * 60 * 1000;
      let cleanedCount = 0;
      const updates = {};

      snapshot.forEach((childSnapshot) => {
        const account = childSnapshot.val();
        const accountId = childSnapshot.key;

        // If account is reserved and the reservation is older than 10 minutes
        if (account.status === 'reserved' && account.reservedAt) {
          if (now - account.reservedAt > tenMinutes) {
            updates[`accountInventory/${accountId}/status`] = 'available';
            updates[`accountInventory/${accountId}/reservedAt`] = null;
            updates[`accountInventory/${accountId}/reservedBy`] = null;
            cleanedCount++;
          }
        }
      });

      if (cleanedCount > 0) {
        await getRef('/').update(updates);
        logger.info(`🧹 Account Cleanup: Reverted ${cleanedCount} abandoned reserved accounts to available.`);
      }
    } catch (error) {
      logger.error(`Account Cleanup Job Error: ${error.message}`);
    }
  });
};

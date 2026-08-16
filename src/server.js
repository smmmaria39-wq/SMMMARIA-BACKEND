// ===============================================
// Server Entry Point
// ===============================================

import app from './app.js';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { startOrderSyncJob, startPaymentSyncJob, startChildOrderSyncJob } from './jobs/syncOrders.js';
import { startSupplierBalanceJob } from './jobs/checkSupplierBalance.js';
import { startAccountCleanupJob } from './jobs/accountCleanup.js'; // <-- ADDED IMPORT

const PORT = env.port;

const server = app.listen(PORT, () => {
  logger.success(`🚀 SMMMARIA API running in ${env.nodeEnv} mode on port ${PORT}`);
  logger.info(`🔗 Base URL: ${env.baseUrl}`);
  
  // Start Background Cron Jobs
  startOrderSyncJob();
  startSupplierBalanceJob();
  startPaymentSyncJob(); 
  startChildOrderSyncJob(); 
  startAccountCleanupJob(); // <-- ADDED THIS LINE
  
  logger.success('⏳ Background jobs initialized (Order Sync, Balance Checker, Payment Sync, Child Sync & Account Cleanup).');
});

// --- Graceful Shutdown Handling (Railway Compatibility) ---
process.on('SIGTERM', () => {
  logger.warn('SIGTERM received. Shutting down gracefully...');
  server.close(() => {
    logger.info('Process terminated. Closing database connections...');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.warn('SIGINT received. Shutting down gracefully...');
  server.close(() => {
    logger.info('Process terminated.');
    process.exit(0);
  });
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  logger.error(`Unhandled Rejection: ${err.message}`);
  server.close(() => process.exit(1));
});  

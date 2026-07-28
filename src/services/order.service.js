// ===============================================
// Order Service (External API Communication)
// ===============================================

import axios from 'axios';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

/**
 * Fetch the status of multiple orders from a supplier
 * @param {String} apiUrl - Supplier API URL
 * @param {String} apiKey - Supplier API Key
 * @param {Array} supplierOrderIds - Array of supplier order IDs
 * @returns {Promise<Object>} - Status response from supplier
 */
export const fetchSupplierOrderStatus = async (apiUrl, apiKey, supplierOrderIds) => {
 try {
  const response = await axios.post(apiUrl, {
   key: apiKey,
   action: 'status',
   orders: supplierOrderIds.join(',') // Supplier API expects comma-separated string
  }, { timeout: env.supplier.timeout });
  
  return response.data; // Returns object mapped by order ID
 } catch (error) {
  logger.error(`Error fetching order status: ${error.message}`);
  throw new Error('Failed to fetch order status from supplier');
 }
};
// ===============================================
// Supplier Service (External API Communication)
// ===============================================

import axios from 'axios';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

/**
 * Fetch services from an external supplier API
 * @param {String} apiUrl - Supplier API URL
 * @param {String} apiKey - Supplier API Key
 * @returns {Promise<Array>} - Array of services from supplier
 */
export const fetchSupplierServices = async (apiUrl, apiKey) => {
 try {
  const response = await axios.post(apiUrl, {
   key: apiKey,
   action: 'services'
  }, { timeout: env.supplier.timeout });
  
  return response.data;
 } catch (error) {
  logger.error(`Error fetching supplier services: ${error.message}`);
  throw new Error('Failed to fetch services from supplier API');
 }
};

/**
 * Check balance from an external supplier API
 * @param {String} apiUrl 
 * @param {String} apiKey 
 * @returns {Promise<Number>} - Supplier balance
 */
export const fetchSupplierBalance = async (apiUrl, apiKey) => {
 try {
  const response = await axios.post(apiUrl, {
   key: apiKey,
   action: 'balance'
  }, { timeout: env.supplier.timeout });
  
  return response.data.balance;
 } catch (error) {
  logger.error(`Error fetching supplier balance: ${error.message}`);
  throw new Error('Failed to fetch balance from supplier API');
 }
};

/**
 * Place an order to an external supplier API
 * @param {String} apiUrl 
 * @param {String} apiKey 
 * @param {Object} orderData - { service, link, quantity }
 * @returns {Promise<Object>} - { order: supplierOrderId }
 */
export const placeSupplierOrder = async (apiUrl, apiKey, orderData) => {
 try {
  const response = await axios.post(apiUrl, {
   key: apiKey,
   action: 'add',
   service: orderData.service,
   link: orderData.link,
   quantity: orderData.quantity
  }, { timeout: env.supplier.timeout });
  
  if (response.data.order) {
   return { success: true, orderId: response.data.order };
  } else {
   return { success: false, error: response.data.Error || 'Supplier rejected order' };
  }
 } catch (error) {
  logger.error(`Error placing supplier order: ${error.message}`);
  throw new Error('Failed to place order with supplier');
 }
};
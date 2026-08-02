// ===============================================
// Supplier Service (External API Communication)
// ===============================================

import axios from 'axios';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

// --- FILTERING CONFIGURATION & HELPERS ---

const BLOCKED_COUNTRIES = [
  'spain', 'egypt', 'china', 'russia', 'nigeria', 'canada', 'indonesia',
  'france', 'italy', 'switzerland', 'korea', 'uae', 'united arab emirates',
  'south africa', 'taiwan', 'japan', 'asia', 'asian'
];

// Helper: Parse string time like "2 Hours", "1-3 Hours", "90 Minutes" to hours
const parseAverageTimeToHours = (avgTime) => {
  if (!avgTime || typeof avgTime !== 'string') return 999; // Exclude if no time data
  const lowerStr = avgTime.toLowerCase();
  let hours = 0;
  const nums = lowerStr.match(/\d+/g);
  if (!nums) return 999;
  const maxNum = Math.max(...nums.map(Number));

  if (lowerStr.includes('minute')) {
    hours = maxNum / 60;
  } else {
    hours = maxNum; // Assume hours if not minutes
  }
  return hours;
};

// Helper: Check if service is fundamentally working/active
const isServiceValid = (service) => {
  const rate = parseFloat(service.rate);
  const min = parseInt(service.min);
  const max = parseInt(service.max);
  
  // Must have valid price and limits (Working Service)
  if (isNaN(rate) || rate <= 0) return false;
  if (isNaN(min) || isNaN(max) || min < 0 || max <= min) return false;
  
  // Average Time must be under 24 hours
  const avgHours = parseAverageTimeToHours(service.average_time);
  if (avgHours > 24) return false;

  return true;
};

// Helper: Check country restrictions
const isCountryBlocked = (service) => {
  const textToSearch = `${service.name} ${service.category}`.toLowerCase();
  
  for (const loc of BLOCKED_COUNTRIES) {
    if (textToSearch.includes(loc)) {
      // EXCEPTION: If it's highly active/working (e.g., has refill enabled), allow it
      const isHighlyActive = service.refill === '1' || service.refill === 1 || service.refill === true || service.refill === 'true';
      if (isHighlyActive) {
        return false; // Not blocked because it's high quality
      }
      return true; // Blocked
    }
  }
  return false; // Not in blocked list
};

// --- MAIN EXPORT FUNCTIONS ---

/**
 * Fetch services from an external supplier API
 * Filters: Only working, no duplicates, no blocked countries (unless highly active), < 24h avg time, limit 5000.
 * @param {String} apiUrl - Supplier API URL
 * @param {String} apiKey - Supplier API Key
 * @returns {Promise<Array>} - Array of filtered, high-quality services
 */
export const fetchSupplierServices = async (apiUrl, apiKey) => {
  try {
    const response = await axios.post(apiUrl, {
      key: apiKey,
      action: 'services'
    }, { timeout: env.supplier.timeout });
    
    const rawServices = response.data;
    if (!Array.isArray(rawServices)) return [];

    const seenServices = new Set();
    const validServices = [];

    for (const svc of rawServices) {
      // 1. Prevent Duplicates
      if (seenServices.has(svc.service)) continue;
      
      // 2. Ensure Service is Valid/Working (Price, Limits, < 24h Avg Time)
      if (!isServiceValid(svc)) continue;
      
      // 3. Apply Country Blocks (with exception for highly active services)
      if (isCountryBlocked(svc)) continue;

      // 4. If it passed all filters, add it to our valid list
      validServices.push(svc);
      seenServices.add(svc.service);

      // 5. Enforce 5000 service limit per supplier
      if (validServices.length >= 5000) break;
    }

    logger.info(`Sync Filter: Downloaded ${validServices.length} valid working services (Filtered out ${rawServices.length - validServices.length}).`);
    return validServices;

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

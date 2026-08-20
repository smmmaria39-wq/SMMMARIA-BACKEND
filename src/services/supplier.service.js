// ===============================================
// Supplier Service (External API Communication)
// ===============================================

import axios from 'axios';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

// --- FILTERING CONFIGURATION & HELPERS ---

// Added variations to ensure we catch all of them
const BLOCKED_COUNTRIES = [
  'spain', 'spanish', 'egypt', 'egyptian', 'china', 'chinese', 'russia', 'russian', 
  'nigeria', 'nigerian', 'canada', 'canadian', 'indonesia', 'indonesian', 
  'france', 'french', 'italy', 'italian', 'switzerland', 'swiss', 
  'korea', 'korean', 'uae', 'united arab emirates', 'dubai', 
  'south africa', 'south african', 'taiwan', 'taiwanese', 'japan', 'japanese', 
  'asia', 'asian', 'india', 'indian', 'pakistan', 'pakistani', 'bangladesh', 
  'philippines', 'filipino', 'vietnam', 'vietnamese', 'thailand', 'thai'
];

// Helper: Parse string time like "2 Hours", "1-3 Hours", "90 Minutes" to hours
const parseAverageTimeToHours = (avgTime) => {
  if (!avgTime) return 0; // If empty, assume instant (0 hours)
  const lowerStr = String(avgTime).toLowerCase();
  
  const nums = lowerStr.match(/\d+/g);
  if (!nums) return 0; // If no numbers, assume instant
  
  const maxNum = Math.max(...nums.map(Number));

  if (lowerStr.includes('minute')) {
    return maxNum / 60;
  } else if (lowerStr.includes('day')) {
    return maxNum * 24;
  } else {
    return maxNum; // Assume hours
  }
};

// Helper: Check if service is fundamentally working/active
const isServiceValid = (service) => {
  const rate = parseFloat(service.rate);
  let min = parseInt(service.min);
  let max = parseInt(service.max);
  
  // Must have a valid price
  if (isNaN(rate) || rate <= 0) return false;
  
  // Handle limits (0 often means unlimited in SMM APIs)
  if (isNaN(min) || min < 0) min = 0;
  if (isNaN(max) || max < 0) max = 0;
  if (max !== 0 && max < min) return false; // If max isn't unlimited, it must be higher than min
  
  // Average Time must be under 24 hours
  const avgHours = parseAverageTimeToHours(service.average_time);
  if (avgHours > 24) return false;

  return true;
};

// Helper: Check country restrictions (STRICT BLOCK - NO EXCEPTIONS)
const isCountryBlocked = (service) => {
  const textToSearch = `${service.name} ${service.category}`.toLowerCase();
  
  for (const loc of BLOCKED_COUNTRIES) {
    // Using includes() is safer for multi-word countries like "south africa"
    if (textToSearch.includes(loc)) {
      return true; // Blocked strictly
    }
  }
  return false; // Not in blocked list
};

// --- MAIN EXPORT FUNCTIONS ---

/**
 * Fetch services from an external supplier API
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
      
      // 3. Apply STRICT Country Blocks
      if (isCountryBlocked(svc)) continue;

      // 4. If it passed all filters, add it to our valid list
      validServices.push(svc);
      seenServices.add(svc.service);
      
      // NOTE: The 5000 limit has been removed. It will download all valid services.
    }

    // Log the exact numbers so you can see it working in Railway
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

/**
 * Fetch categories from an external supplier API
 * @param {String} apiUrl 
 * @param {String} apiKey 
 * @returns {Promise<Array>} - Array of unique category strings
 */
export const fetchSupplierCategories = async (apiUrl, apiKey) => {
  try {
    const response = await axios.post(apiUrl, {
      key: apiKey,
      action: 'services'
    }, { timeout: env.supplier.timeout });
    
    const rawServices = response.data;
    if (!Array.isArray(rawServices)) return [];

    const categories = new Set();
    for (const svc of rawServices) {
      if (svc.category) {
        categories.add(svc.category);
      }
    }
    
    return Array.from(categories).sort();
  } catch (error) {
    logger.error(`Error fetching supplier categories: ${error.message}`);
    throw new Error('Failed to fetch categories from supplier API');
  }
};

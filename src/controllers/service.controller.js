// ===============================================
// Service Controller
// ===============================================

import { getRef } from '../database/firebase.js';
import { successResponse } from '../utils/response.js';

/**
 * @desc    Get all active services (Public/User)
 * @route   GET /api/v1/services
 */
export const getServices = async (req, res, next) => {
 try {
  const { category, search } = req.query;
  const snapshot = await getRef('services').get();
  
  let services = snapshot.exists() ? Object.values(snapshot.val()) : [];
  
  // Filter out inactive services for users
  services = services.filter(s => s.status === 'active');
  
  // Filter by category if provided
  if (category) {
   services = services.filter(s => s.category.toLowerCase() === category.toLowerCase());
  }
  
  // Filter by search term if provided
  if (search) {
   services = services.filter(s => s.name.toLowerCase().includes(search.toLowerCase()));
  }
  
  return successResponse(res, 'Services fetched successfully', services);
 } catch (error) {
  next(error);
 }
};

/**
 * @desc    Get all categories (Public/User)
 * @route   GET /api/v1/services/categories
 */
export const getCategories = async (req, res, next) => {
 try {
  const snapshot = await getRef('services').get();
  const services = snapshot.exists() ? Object.values(snapshot.val()) : [];
  
  // Extract unique categories
  const categories = [...new Set(services.map(s => s.category))];
  
  return successResponse(res, 'Categories fetched successfully', categories);
 } catch (error) {
  next(error);
 }
};

/**
 * @desc    Admin: Update service status or price
 * @route   PUT /api/v1/services/:id
 */
export const updateService = async (req, res, next) => {
 try {
  const { id } = req.params;
  const { sellingPrice, status } = req.body;
  
  const updates = {};
  if (sellingPrice) updates.sellingPrice = parseFloat(sellingPrice);
  if (status) updates.status = status;
  
  await getRef(`services/${id}`).update(updates);
  return successResponse(res, 'Service updated successfully');
 } catch (error) {
  next(error);
 }
};
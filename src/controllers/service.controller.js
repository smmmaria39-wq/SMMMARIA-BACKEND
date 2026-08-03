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
  
  let services = [];
  if (snapshot.exists()) {
   const servicesData = snapshot.val();
   for (const key in servicesData) {
    if (Object.hasOwnProperty.call(servicesData, key)) {
     services.push({ id: key, ...servicesData[key] }); // Attach ID
    }
   }
  }
  
  // If the user is NOT an admin, filter out inactive services
  const isAdmin = req.user && (req.user.role === 'admin' || req.user.role === 'super_admin');
  if (!isAdmin) {
   services = services.filter(s => s.status === 'active');
  }
  
  // Filter by category if provided
  if (category) {
   services = services.filter(s => s.category?.toLowerCase() === category.toLowerCase());
  }
  
  // Filter by search term if provided
  if (search) {
   services = services.filter(s => s.name?.toLowerCase().includes(search.toLowerCase()));
  }
  
  return successResponse(res, 'Services fetched successfully', services);
 } catch (error) {
  next(error);
 }
};

/**
 * @desc    Get all categories with service counts (Public/User)
 * @route   GET /api/v1/services/categories
 */
export const getCategories = async (req, res, next) => {
 try {
  const snapshot = await getRef('services').get();
  let services = [];
  
  if (snapshot.exists()) {
   const servicesData = snapshot.val();
   for (const key in servicesData) {
    if (Object.hasOwnProperty.call(servicesData, key)) {
     services.push({ id: key, ...servicesData[key] });
    }
   }
  }
  
  // Group by category and count the services
  const categoriesMap = {};
  services.forEach(s => {
   const catName = s.category || 'Uncategorized';
   if (!categoriesMap[catName]) categoriesMap[catName] = 0;
   categoriesMap[catName]++;
  });
  
  // Convert to array of objects for the frontend table
  const categories = Object.keys(categoriesMap).map((name, index) => ({
   id: index + 1,
   name: name,
   serviceCount: categoriesMap[name]
  }));
  
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
  if (sellingPrice !== undefined) updates.sellingPrice = parseFloat(sellingPrice);
  if (status) updates.status = status;
  
  await getRef(`services/${id}`).update(updates);
  return successResponse(res, 'Service updated successfully');
 } catch (error) {
  next(error);
 }
};

/**
 * @desc    Admin: Delete a service completely
 * @route   DELETE /api/v1/services/:id
 */
export const deleteService = async (req, res, next) => {
  try {
    const { id } = req.params;
    // Remove the service from Firebase
    await getRef(`services/${id}`).remove();
    return successResponse(res, 'Service deleted successfully');
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Admin: Delete a category AND all services inside it
 * @route   DELETE /api/v1/services/categories/:id
 */
export const deleteCategory = async (req, res, next) => {
  try {
    // Express automatically decodes URL parameters, so we can use it directly
    const categoryName = req.params.id;
    
    const snapshot = await getRef('services').get();
    if (snapshot.exists()) {
      const updates = {};
      const servicesData = snapshot.val();
      
      // Find all services in this category and prepare to DELETE them completely
      for (const key in servicesData) {
        if (servicesData[key].category === categoryName) {
          updates[`services/${key}`] = null; // null completely deletes the node from Firebase
        }
      }
      
      // Apply all deletions in one go
      if (Object.keys(updates).length > 0) {
        await getRef().update(updates);
      }
    }
    
    return successResponse(res, `Category '${categoryName}' and all its services deleted successfully.`);
  } catch (error) {
    next(error);
  }
};
/**
 * @desc    Admin: Bulk update service prices (Fixes rate-limiting & crashes)
 * @route   PUT /api/v1/services/bulk-update
 * @access  Private/Admin
 */
export const bulkUpdateServices = async (req, res, next) => {
  try {
    const { updates } = req.body; // Expecting an array: [{ id: "123", sellingPrice: 1.50 }, ...]
    
    if (!Array.isArray(updates) || updates.length === 0) {
      return errorResponse(res, 'No updates provided', 400);
    }

    const updatesObj = {};
    updates.forEach(upd => {
      if (upd.id && upd.sellingPrice !== undefined) {
        // Prepare Firebase multi-location update
        updatesObj[`services/${upd.id}/sellingPrice`] = parseFloat(upd.sellingPrice);
      }
    });

    // Execute a single, lightning-fast batch update to Firebase
    await getRef().update(updatesObj);
    
    return successResponse(res, `${updates.length} services updated successfully`);
  } catch (error) {
    next(error);
  }
};

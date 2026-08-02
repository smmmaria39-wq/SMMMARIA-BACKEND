// ===============================================
// Supplier Controller
// ===============================================

import { getRef } from '../database/firebase.js';
import { generateUUID } from '../utils/helpers.js';
import { successResponse, errorResponse } from '../utils/response.js';
import { fetchSupplierBalance, fetchSupplierServices } from '../services/supplier.service.js';

/**
 * @desc    Get all suppliers (Admin)
 * @route   GET /api/v1/suppliers
 */
export const getSuppliers = async (req, res, next) => {
    try {
        // Fetch suppliers AND services at the same time for speed
        const [suppliersSnap, servicesSnap] = await Promise.all([
            getRef('suppliers').get(),
            getRef('services').get()
        ]);
        
        const servicesData = servicesSnap.exists() ? servicesSnap.val() : {};
        const servicesArray = Object.values(servicesData);
        
        const suppliers = [];
        
        if (suppliersSnap.exists()) {
            const suppliersData = suppliersSnap.val();
            for (const key in suppliersData) {
                if (Object.hasOwnProperty.call(suppliersData, key)) {
                    const supplier = suppliersData[key];
                    // Count how many services belong to this supplier
                    const serviceCount = servicesArray.filter(s => s.supplierId === key).length;
                    
                    suppliers.push({ 
                        id: key, 
                        ...supplier, 
                        serviceCount: serviceCount // Add the count here
                    });
                }
            }
        }
        
        return successResponse(res, 'Suppliers fetched successfully', suppliers);
    } catch (error) {
        next(error);
    }
};

/**
 * @desc    Add a new supplier (Admin)
 * @route   POST /api/v1/suppliers
 */
export const addSupplier = async (req, res, next) => {
    try {
        const { name, apiUrl, apiKey, priority, markup } = req.body;
        const id = generateUUID();

        const supplierData = {
            id, name, apiUrl, apiKey,
            priority: priority || 1,
            markup: markup || 0, // Percentage markup on cost price
            status: 'active',
            balance: 0,
            lastSync: null,
            createdAt: new Date().toISOString()
        };

        await getRef(`suppliers/${id}`).set(supplierData);
        return successResponse(res, 'Supplier added successfully', supplierData, 201);
    } catch (error) {
        next(error);
    }
};

/**
 * @desc    Check supplier live balance (Admin)
 * @route   GET /api/v1/suppliers/:id/balance
 */
export const checkSupplierBalance = async (req, res, next) => {
    try {
        const { id } = req.params;
        const snapshot = await getRef(`suppliers/${id}`).get();
        
        if (!snapshot.exists()) return errorResponse(res, 'Supplier not found', 404);
        
        const supplier = snapshot.val();
        const balance = await fetchSupplierBalance(supplier.apiUrl, supplier.apiKey);
        
        // Update Firebase with new balance
        await getRef(`suppliers/${id}/balance`).set(balance);
        
        return successResponse(res, 'Supplier balance fetched', { balance });
    } catch (error) {
        next(error);
    }
};

/**
 * @desc    Sync services from supplier into our DB (Admin)
 * Only adds NEW working services. Updates existing ones without duplicating.
 * @route   POST /api/v1/suppliers/:id/sync
 */
export const syncSupplierServices = async (req, res, next) => {
    try {
        const { id } = req.params;
        const snapshot = await getRef(`suppliers/${id}`).get();
        
        if (!snapshot.exists()) return errorResponse(res, 'Supplier not found', 404);
        
        const supplier = snapshot.val();
        
        // 1. Fetch filtered, working services from the external API
        const externalServices = await fetchSupplierServices(supplier.apiUrl, supplier.apiKey);
        
        // 2. Fetch our existing services for this supplier to prevent duplicates
        const existingServicesSnap = await getRef('services').orderByChild('supplierId').equalTo(id).get();
        const existingMap = {};
        if (existingServicesSnap.exists()) {
            existingServicesSnap.forEach(child => {
                existingMap[child.val().supplierServiceId] = child.key; // Map external ID to our internal ID
            });
        }

        let newCount = 0;
        let updatedCount = 0;
        const markupMultiplier = 1 + (supplier.markup / 100);
        const updates = {};
        const verifiedTimestamp = new Date().toISOString();

        // 3. Loop through downloaded services and prepare batch updates
        for (const extService of externalServices) {
            // Determine if this is a new service or an existing one
            const internalId = existingMap[extService.service] || `${id}_${extService.service}`;
            const isNew = !existingMap[extService.service];

            const costPrice = parseFloat(extService.rate);
            const sellingPrice = parseFloat((costPrice * markupMultiplier).toFixed(2));

            if (isNew) {
                // Construct full object for new services
                const serviceData = {
                    id: internalId,
                    supplierId: id,
                    supplierServiceId: extService.service,
                    name: extService.name,
                    category: extService.category || 'Uncategorized',
                    costPrice: costPrice,
                    sellingPrice: sellingPrice,
                    min: parseInt(extService.min),
                    max: parseInt(extService.max),
                    averageTime: extService.average_time || 'Unknown',
                    refill: extService.refill === '1' || false,
                    cancel: extService.cancel === '1' || false,
                    status: 'active',
                    type: extService.type || 'default',
                    lastVerifiedWorking: verifiedTimestamp // Performance tracking
                };
                updates[`services/${internalId}`] = serviceData;
                newCount++;
            } else {
                // Only update essential fields for existing services to keep them fresh
                updates[`services/${internalId}/costPrice`] = costPrice;
                updates[`services/${internalId}/sellingPrice`] = sellingPrice;
                updates[`services/${internalId}/min`] = parseInt(extService.min);
                updates[`services/${internalId}/max`] = parseInt(extService.max);
                updates[`services/${internalId}/averageTime`] = extService.average_time || 'Unknown';
                updates[`services/${internalId}/lastVerifiedWorking`] = verifiedTimestamp;
                updatedCount++;
            }
        }

        // 4. Execute a single, lightning-fast batch update to Firebase
        if (Object.keys(updates).length > 0) {
            await getRef().update(updates);
        }

        // 5. Update supplier's last sync time
        await getRef(`suppliers/${id}/lastSync`).set(verifiedTimestamp);
        
        return successResponse(res, `Sync complete. Added ${newCount} new working services. Updated ${updatedCount} existing services.`);
    } catch (error) {
        next(error);
    }
};

/**
 * @desc    Delete a supplier and all its services (Admin)
 * @route   DELETE /api/v1/suppliers/:id
 */
export const deleteSupplier = async (req, res, next) => {
    try {
        const { id } = req.params;
        
        // 1. Delete the supplier
        await getRef(`suppliers/${id}`).remove();
        
        // 2. Find and delete all associated services
        const servicesSnap = await getRef('services').get();
        if (servicesSnap.exists()) {
            const updates = {};
            servicesSnap.forEach(childSnap => {
                const service = childSnap.val();
                if (service.supplierId === id) {
                    // Setting a path to null in Firebase deletes the data
                    updates[`services/${childSnap.key}`] = null; 
                }
            });
            
            // Execute the batch delete if there are services to remove
            if (Object.keys(updates).length > 0) {
                await getRef().update(updates);
            }
        }
        
        return successResponse(res, 'Supplier and associated services deleted successfully');
    } catch (error) {
        next(error);
    }
};

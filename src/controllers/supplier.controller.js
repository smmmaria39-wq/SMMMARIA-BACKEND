// ===============================================
// Supplier Controller
// ===============================================

import { getRef } from '../database/firebase.js';
import { generateUUID } from '../utils/helpers.js';
import { successResponse, errorResponse } from '../utils/response.js';
import { fetchSupplierBalance, fetchSupplierServices } from '../services/supplier.service.js';

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
 * @route   POST /api/v1/suppliers/:id/sync
 */
export const syncSupplierServices = async (req, res, next) => {
    try {
        const { id } = req.params;
        const snapshot = await getRef(`suppliers/${id}`).get();
        
        if (!snapshot.exists()) return errorResponse(res, 'Supplier not found', 404);
        
        const supplier = snapshot.val();
        const externalServices = await fetchSupplierServices(supplier.apiUrl, supplier.apiKey);
        
        let importedCount = 0;
        const markupMultiplier = 1 + (supplier.markup / 100);

        for (const extService of externalServices) {
            // Use supplier ID + external service ID as our internal ID to prevent duplicates
            const internalId = `${id}_${extService.service}`;
            
            const serviceData = {
                id: internalId,
                supplierId: id,
                supplierServiceId: extService.service,
                name: extService.name,
                category: extService.category || 'Uncategorized',
                costPrice: parseFloat(extService.rate),
                sellingPrice: parseFloat((extService.rate * markupMultiplier).toFixed(2)),
                min: parseInt(extService.min),
                max: parseInt(extService.max),
                averageTime: extService.average_time || 'Unknown',
                refill: extService.refill === '1' || false,
                cancel: extService.cancel === '1' || false,
                status: 'active',
                type: extService.type || 'default'
            };

            await getRef(`services/${internalId}`).set(serviceData);
            importedCount++;
        }

        await getRef(`suppliers/${id}/lastSync`).set(new Date().toISOString());
        return successResponse(res, `Synced ${importedCount} services successfully`);
    } catch (error) {
        next(error);
    }
};
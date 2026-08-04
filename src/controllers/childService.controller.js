// ===============================================
// Child Panel Service Controller
// ===============================================

import { getRef } from '../database/firebase.js';
import { successResponse, errorResponse } from '../utils/response.js';

/**
 * ==================================================
 * Get Services For Child Panel
 * ==================================================
 *
 * Returns all active services from the main panel,
 * merged with the reseller's custom selling prices.
 *
 * The reseller NEVER sees:
 * - Supplier Cost
 * - Supplier IDs
 * - Supplier Service IDs
 *
 * The reseller ONLY sees:
 * - Service information
 * - Their wholesale price
 * - Their own selling price
 */
export const getPanelServices = async (req, res, next) => {
    try {

        let panelId = req.user.childPanelId;

        if (!panelId) {
            const panelSnap = await getRef(
                `users/${req.user.id}/childPanelId`
            ).get();

            panelId = panelSnap.exists()
                ? panelSnap.val()
                : null;
        }

        if (!panelId) {
            return errorResponse(
                res,
                "Reseller panel not found.",
                403
            );
        }

        const [servicesSnap, pricingSnap] = await Promise.all([
            getRef("services").get(),
            getRef(`childPanels/${panelId}/pricing`).get()
        ]);

        const services = servicesSnap.exists()
            ? servicesSnap.val()
            : {};

        const pricing = pricingSnap.exists()
            ? pricingSnap.val()
            : {};

        const results = [];

        Object.entries(services).forEach(([id, service]) => {

            if (service.status !== "active") return;

            results.push({

                id,

                name: service.name,

                category: service.category,

                description: service.description,

                min: service.min,

                max: service.max,

                refill: service.refill,

                cancel: service.cancel,

                status: service.status,

                // What the reseller pays SMMARIA
                wholesalePrice: service.sellingPrice,

                // What the reseller sells to customers
                sellingPrice:
                    pricing[id]?.sellingPrice ??
                    service.sellingPrice

            });

        });

        return successResponse(
            res,
            "Services loaded successfully.",
            results
        );

    } catch (err) {
        next(err);
    }
};

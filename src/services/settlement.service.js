// src/services/settlement.service.js
import { getRef } from '../database/firebase.js';
import { logger } from '../utils/logger.js';

/**
 * Centralized, Idempotent Payment Settlement
 * @param {string} paymentId - The internal UUID of the payment
 * @param {string} source - Who is settling it (e.g., 'pesajet_webhook', 'cron', 'admin')
 */
export const settlePayment = async (paymentId, source = 'unknown') => {
    if (!paymentId) throw new Error('Payment ID is required for settlement.');
    
    const paymentRef = getRef(`payments/${paymentId}`);
    const paymentSnap = await paymentRef.get();
    
    if (!paymentSnap.exists()) {
        logger.warn(`[Settlement] Payment not found: ${paymentId}`);
        return { success: false, message: 'Payment not found' };
    }
    
    let paymentData = paymentSnap.val();
    
    // 1. Idempotency Check: If already completed, do nothing.
    if (paymentData.status === 'completed') {
        logger.info(`[Settlement] DUPLICATE PREVENTED: Payment ${paymentId} is already completed.`);
        return { success: true, alreadySettled: true };
    }
    
    if (paymentData.status === 'cancelled' || paymentData.status === 'rejected') {
        logger.warn(`[Settlement] Attempt to settle cancelled/rejected payment ${paymentId}. Aborted.`);
        return { success: false, message: 'Payment is cancelled or rejected' };
    }
    
    // 2. Claim the payment (pending -> processing)
    if (paymentData.status === 'pending') {
        const claimRes = await paymentRef.transaction((p) => {
            if (p && p.status === 'pending') {
                p.status = 'processing';
                p.processingSource = source;
                p.processingStartedAt = Date.now();
                return p;
            }
            return; // Abort if not pending
        });
        
        if (!claimRes.committed) {
            return { success: false, message: 'Payment was claimed by another process' };
        }
        paymentData = claimRes.snapshot.val();
    } else if (paymentData.status === 'processing') {
        // If processing, only take over if stale (> 2 minutes)
        const age = Date.now() - (paymentData.processingStartedAt || 0);
        if (age < 120000) {
            return { success: false, message: 'Payment is currently being processed' };
        }
        logger.warn(`[Settlement] Stale processing detected for ${paymentId}. Taking over.`);
    }
    
    const { userId, totalCredit } = paymentData;
    const userRef = getRef(`users/${userId}`);
    
    // 3. ATOMIC & IDEMPOTENT WALLET CREDIT
    // We use a transaction on the user node. We check if the paymentId exists in their `credits` ledger.
    // If it does, we abort (already credited). If not, we increment balance AND write the ledger entry.
    const creditRes = await userRef.transaction((u) => {
        if (!u) return u;
        
        // Idempotency check inside the transaction
        if (u.credits && u.credits[paymentId]) {
            return; // Abort - already credited!
        }
        
        u.balance = (u.balance || 0) + totalCredit;
        u.credits = u.credits || {};
        u.credits[paymentId] = {
            amount: totalCredit,
            source: source,
            creditedAt: Date.now()
        };
        
        return u;
    });
    
    if (!creditRes.committed) {
        // Transaction aborted. Could be concurrent modification or our idempotency abort.
        const userVal = (await userRef.get()).val();
        if (!userVal.credits || !userVal.credits[paymentId]) {
            // It was a concurrent modification (e.g., user updated profile at same time).
            // Revert payment to pending so cron can retry it later.
            if (paymentData.status === 'pending') {
                await paymentRef.update({ status: 'pending', processingSource: null, processingStartedAt: null });
            }
            throw new Error('Concurrent user update during settlement. Payment reverted to pending.');
        }
        // If it was our idempotency abort, it means it was already credited. Proceed to finalize.
    }
    
    // 4. Finalize Payment Status
    await paymentRef.update({
        status: 'completed',
        completedAt: Date.now(),
        settlementSource: source
    });
    
    logger.success(`[Settlement] Payment ${paymentId} settled successfully via ${source}. Credited $${totalCredit}.`);
    return { success: true, message: 'Payment settled successfully' };
};

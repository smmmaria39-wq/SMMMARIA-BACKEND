// src/services/settlement.service.js
import { getRef } from '../database/firebase.js';
import { logger } from '../utils/logger.js';

/**
 * Centralized, Idempotent Payment Settlement
 * @param {string} paymentId - The internal UUID of the payment
 * @param {string} source - Who is settling it (e.g., 'pesajet_webhook', 'cron_recovery', 'admin')
 * @param {boolean} isAdminOverride - Bypasses the stale-processing timeout, but NEVER bypasses gateway-reference uniqueness
 */
export const settlePayment = async (paymentId, source = 'unknown', isAdminOverride = false) => {
  if (!paymentId) throw new Error('Payment ID is required for settlement.');
  
  const paymentRef = getRef(`payments/${paymentId}`);
  const paymentSnap = await paymentRef.get();
  
  if (!paymentSnap.exists()) {
    logger.warn(`[Settlement] Payment not found: ${paymentId}`);
    return { success: false, message: 'Payment not found' };
  }
  
  let paymentData = paymentSnap.val();
  
  // 1. Idempotency Check: If already completed/approved, do nothing.
  if (paymentData.status === 'completed' || paymentData.status === 'approved') {
    logger.info(`[Settlement] DUPLICATE PREVENTED: Payment ${paymentId} is already completed/approved.`);
    return { success: true, alreadySettled: true };
  }
  
  if (paymentData.status === 'cancelled' || paymentData.status === 'rejected') {
    logger.warn(`[Settlement] Attempt to settle cancelled/rejected payment ${paymentId}. Aborted.`);
    return { success: false, message: 'Payment is cancelled or rejected' };
  }
  
  // ==========================================
  // 1.5. PERMANENT ATOMIC GATEWAY REFERENCE CLAIM
  // ==========================================
  // Prevents two different payment IDs with the same gateway reference from settling.
  // Admin override CANNOT bypass this.
  if (paymentData.gatewayReference) {
    const gwClaimRef = getRef(`gatewayClaims/${paymentData.gatewayReference}`);
    const gwClaimResult = await gwClaimRef.transaction((c) => {
      if (!c) return { paymentId, claimedAt: Date.now(), status: 'claimed' };
      // If it belongs to the SAME payment ID, allow the retry/recovery to continue
      if (c.paymentId === paymentId) return c; 
      // If it belongs to a DIFFERENT payment ID, abort!
      return; 
    });

    if (!gwClaimResult.committed) {
      logger.warn(`[Settlement] Duplicate gateway reference ${paymentData.gatewayReference} detected for payment ${paymentId}. Rejecting.`);
      await paymentRef.update({ status: 'rejected', failureReason: 'Duplicate gateway transaction' });
      await getRef(`transactions/${paymentId}`).update({ status: 'rejected' });
      return { success: false, message: 'Duplicate gateway transaction prevented' };
    }
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
    
    if (!claimRes.committed) return { success: false, message: 'Payment claimed by another process' };
    paymentData = claimRes.snapshot.val();
  } else if (paymentData.status === 'processing') {
    // If processing, only take over if stale (> 2 minutes)
    const age = Date.now() - (paymentData.processingStartedAt || 0);
    
    // FIX: Admin can bypass the 2-minute wait, but ONLY for processing ownership, not gateway uniqueness
    if (age < 120000 && !isAdminOverride) {
      return { success: false, message: 'Payment is currently being processed' };
    }
    
    // Atomically take over stale processing
    const takeoverRes = await paymentRef.transaction((p) => {
      if (p && p.status === 'processing') {
        const currentAge = Date.now() - (p.processingStartedAt || 0);
        if (currentAge < 120000 && !isAdminOverride) return; // Abort if someone else just took over
        p.processingStartedAt = Date.now(); // Reset timer
        return p;
      }
      return; // Abort if no longer processing
    });
    
    if (!takeoverRes.committed) return { success: false, message: 'Payment completed by another process or no longer stale' };
    logger.warn(`[Settlement] Stale processing detected for ${paymentId}. Taking over.`);
    paymentData = takeoverRes.snapshot.val();
  }
  
  // ==========================================
  // 3. HARDEN totalCreditUSD AMOUNT
  // ==========================================
  const { userId } = paymentData;
  let totalCreditUSD = paymentData.totalCreditUSD || paymentData.totalCredit || (parseFloat(paymentData.amount) + parseFloat(paymentData.bonus || 0));
  
  // FIX: Normalize to a real JavaScript number and validate
  totalCreditUSD = Number(totalCreditUSD);
  if (!Number.isFinite(totalCreditUSD) || totalCreditUSD <= 0) {
    logger.error(`[Settlement] Invalid credit amount for ${paymentId}: ${totalCreditUSD}. Rejecting.`);
    await paymentRef.update({ status: 'rejected', failureReason: 'Invalid credit amount during settlement' });
    await getRef(`transactions/${paymentId}`).update({ status: 'rejected' });
    return { success: false, message: 'Invalid credit amount prevented settlement' };
  }
  
  const userRef = getRef(`users/${userId}`);

  // 4. ATOMIC & IDEMPOTENT WALLET CREDIT
  const creditRes = await userRef.transaction((u) => {
    if (!u) return u; // Abort if user doesn't exist
    
    // Idempotency check inside the transaction
    if (u.walletCredits && u.walletCredits[paymentId]) {
      return; // Abort - already credited!
    }
    
    // Ensure we are adding finite numbers
    u.balance = Number(u.balance || 0) + totalCreditUSD;
    u.totalDeposited = Number(u.totalDeposited || 0) + totalCreditUSD;
    
    u.walletCredits = u.walletCredits || {};
    u.walletCredits[paymentId] = {
      amount: totalCreditUSD,
      source: source,
      creditedAt: Date.now()
    };
    
    return u;
  });
  
  if (!creditRes.committed) {
    // Transaction aborted. Could be concurrent modification, user missing, or our idempotency abort.
    const userSnap = await userRef.get();
    const userVal = userSnap.exists() ? userSnap.val() : null;
    
    // FIX: Null-user handling. Do not crash if userVal is null.
    if (!userVal) {
      // FIX: Do not incorrectly mark the payment as completed if the wallet was not actually credited.
      await paymentRef.update({ status: 'pending', processingSource: null, processingStartedAt: null });
      logger.error(`[Settlement] User record missing for ${paymentId}. Reverted to pending.`);
      throw new Error('User record missing during settlement. Payment reverted to pending.');
    }
    
    if (userVal.walletCredits && userVal.walletCredits[paymentId]) {
      // If it was our idempotency abort, it means it was already credited. Proceed to finalize safely.
      logger.info(`[Settlement] Payment ${paymentId} was already credited. Finalizing status.`);
    } else {
      // FIX: It was a concurrent modification. Revert to pending so cron can retry safely.
      await paymentRef.update({ status: 'pending', processingSource: null, processingStartedAt: null });
      logger.warn(`[Settlement] Concurrent user update for ${paymentId}. Reverted to pending.`);
      throw new Error('Concurrent user update during settlement. Payment reverted to pending.');
    }
  }
  
  // 5. Write to dedicated top-level Wallet Ledger (For auditing, non-blocking)
  try {
    await getRef(`walletLedger/${paymentId}`).set({
      paymentId,
      userId,
      amount: totalCreditUSD,
      source,
      gateway: paymentData.gateway || (paymentData.method === 'card' ? 'marzpay' : 'pesajet'),
      gatewayReference: paymentData.gatewayReference,
      status: 'completed',
      completedAt: Date.now()
    });
  } catch (e) {
    // FIX: If ledger write fails, wallet idempotency remains safe and payment settlement behavior remains consistent.
    logger.error(`[Settlement] Failed to write to top-level walletLedger for ${paymentId}. Idempotency is safe, but audit log may be missing.`, e);
  }
  
  // 6. Finalize Payment Status
  await paymentRef.update({
    status: 'completed',
    completedAt: Date.now(),
    settlementSource: source
  });
  
  // FIX: UPDATE THE TRANSACTION RECORD
  await getRef(`transactions/${paymentId}`).update({
    status: 'completed',
    completedAt: new Date().toISOString()
  });

  // FIX: UPDATE IDEMPOTENCY STATUS TO COMPLETED
  if (paymentData.idempotencyKey) {
    await getRef(`paymentIdempotency/${userId}/${paymentData.idempotencyKey}`).update({ status: 'completed' });
  }

  logger.success(`[Settlement] Payment ${paymentId} settled successfully via ${source}. Credited $${totalCreditUSD}.`);
  return { success: true, message: 'Payment settled successfully' };
};

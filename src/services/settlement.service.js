// src/services/settlement.service.js
import { getRef } from '../database/firebase.js';
import { logger } from '../utils/logger.js';

/**
 * Centralized, Idempotent Payment Settlement
 * @param {string} paymentId - The internal UUID of the payment
 * @param {string} source - Who is settling it (e.g., 'pesajet_webhook', 'cron_recovery', 'admin')
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
    
    if (!claimRes.committed) return { success: false, message: 'Payment claimed by another process' };
    paymentData = claimRes.snapshot.val();
  } else if (paymentData.status === 'processing') {
    // If processing, only take over if stale (> 2 minutes)
    const age = Date.now() - (paymentData.processingStartedAt || 0);
    if (age < 120000) {
      return { success: false, message: 'Payment is currently being processed' };
    }
    
    // Atomically take over stale processing
    const takeoverRes = await paymentRef.transaction((p) => {
      if (p && p.status === 'processing') {
        const currentAge = Date.now() - (p.processingStartedAt || 0);
        if (currentAge < 120000) return; // Abort if someone else just took over
        p.processingStartedAt = Date.now(); // Reset timer
        return p;
      }
      return; // Abort if no longer processing
    });
    
    if (!takeoverRes.committed) return { success: false, message: 'Payment completed by another process or no longer stale' };
    logger.warn(`[Settlement] Stale processing detected for ${paymentId}. Taking over.`);
    paymentData = takeoverRes.snapshot.val();
  }
  
  // FIX: Use totalCreditUSD with fallbacks for old payment records
  const { userId } = paymentData;
  const totalCreditUSD = paymentData.totalCreditUSD || paymentData.totalCredit || (parseFloat(paymentData.amount) + parseFloat(paymentData.bonus || 0));
  
  if (!totalCreditUSD) throw new Error('Payment record is missing credit amount. Cannot settle.');
  
  const userRef = getRef(`users/${userId}`);

  // 3. ATOMIC & IDEMPOTENT WALLET CREDIT
  const creditRes = await userRef.transaction((u) => {
    if (!u) return u;
    
    // Idempotency check inside the transaction
    if (u.walletCredits && u.walletCredits[paymentId]) {
      return; // Abort - already credited!
    }
    
    u.balance = (u.balance || 0) + totalCreditUSD;
    u.walletCredits = u.walletCredits || {};
    u.walletCredits[paymentId] = {
      amount: totalCreditUSD,
      source: source,
      creditedAt: Date.now()
    };
    
    return u;
  });
  
  if (!creditRes.committed) {
    // Transaction aborted. Could be concurrent modification or our idempotency abort.
    const userVal = (await userRef.get()).val();
    if (!userVal.walletCredits || !userVal.walletCredits[paymentId]) {
      // FIX: It was a concurrent modification. Revert to pending so cron can retry.
      await paymentRef.update({ status: 'pending', processingSource: null, processingStartedAt: null });
      throw new Error('Concurrent user update during settlement. Payment reverted to pending.');
    }
    // If it was our idempotency abort, it means it was already credited. Proceed to finalize.
  }
  
  // 4. Write to dedicated top-level Wallet Ledger (For auditing, non-blocking)
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
    logger.error(`[Settlement] Failed to write to top-level walletLedger for ${paymentId}. Idempotency is safe, but audit log may be missing.`, e);
  }
  
  // 5. Finalize Payment Status
  await paymentRef.update({
    status: 'completed',
    completedAt: Date.now(),
    settlementSource: source
  });
  
  // FIX: UPDATE THE TRANSACTION RECORD SO FRONTEND AND ADMIN PANEL SHOW IT AS COMPLETED
  await getRef(`transactions/${paymentId}`).update({
    status: 'completed',
    completedAt: new Date().toISOString()
  });

  logger.success(`[Settlement] Payment ${paymentId} settled successfully via ${source}. Credited $${totalCreditUSD}.`);
  return { success: true, message: 'Payment settled successfully' };
};

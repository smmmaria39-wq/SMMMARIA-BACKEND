// ===============================================
// Payment Controller
// ===============================================
import { getRef } from "../database/firebase.js";
import { generateUUID } from "../utils/helpers.js";
import { successResponse, errorResponse } from "../utils/response.js";
import { logger } from "../utils/logger.js";
import { settlePayment } from "../services/settlement.service.js";
import { PesaJet, PesaJetError } from "@pesajet/sdk";

// Exchange Rate: 1 USD = 3930 UGX
const USD_TO_UGX_RATE = 3930;

// ==========================================
// TELECOM & CARRIER DETECTION (PesaJet SDK & Uganda Guidelines)
// ==========================================
/**
 * Detect carrier for a Ugandan phone number via @pesajet/sdk
 * MTN: 077, 078, 076, 079, 039
 * Airtel: 070, 075, 074
 * Cross-Network: 073 cuts across MTN & Airtel (returns null, caller must specify)
 */
let cachedUtils = null;
const getPesajetUtils = () => {
  if (!cachedUtils) {
    const apiKey = process.env.PESAJET_API_KEY || "pesajet_offline_utils";
    cachedUtils = new PesaJet({ apiKey }).utils;
  }
  return cachedUtils;
};

export const detectProvider = (phoneNumber) => {
  if (!phoneNumber) return null;
  return getPesajetUtils().detectProvider(phoneNumber);
};

export const formatPhoneNumber = (phoneNumber) => {
  if (!phoneNumber) return "";
  return getPesajetUtils().formatPhoneNumber(phoneNumber);
};

// ==========================================
// STATUS NORMALIZATION HELPERS
// ==========================================
export const isPaymentSuccessful = (status, event) => {
  const s = String(status || "")
    .toLowerCase()
    .trim();
  const e = String(event || "")
    .toLowerCase()
    .trim();
  return (
    s === "completed" ||
    s === "success" ||
    s === "successful" ||
    e === "payment.completed"
  );
};

export const isPaymentFailed = (status, event) => {
  const s = String(status || "")
    .toLowerCase()
    .trim();
  const e = String(event || "")
    .toLowerCase()
    .trim();
  return (
    s === "failed" ||
    s === "expired" ||
    s === "cancelled" ||
    s === "rejected" ||
    e === "payment.failed" ||
    e === "payment.expired"
  );
};

// ==========================================
// PESAJET CLIENT (@pesajet/sdk)
// ==========================================
export const getPesajetClient = () => {
  const apiKey = process.env.PESAJET_API_KEY;
  if (!apiKey) throw new Error("PesaJet API key is not configured.");

  return new PesaJet({
    apiKey,
    webhookSecret: process.env.PESAJET_WEBHOOK_SECRET,
  });
};

export const getPesajetConfig = () => ({
  apiKey: process.env.PESAJET_API_KEY,
});

const processPesaJetPayment = async (payload) => {
  const pesajet = getPesajetClient();
  try {
    return await pesajet.payments.create({
      type: payload.type || "COLLECTION",
      amount: payload.amount,
      currency: payload.currency || "UGX",
      phoneNumber: payload.phoneNumber,
      provider: payload.provider,
      reference: payload.reference,
      description: payload.description,
      idempotencyKey: payload.idempotencyKey,
      metadata: payload.metadata,
    });
  } catch (error) {
    if (error instanceof PesaJetError) {
      error.status = error.statusCode || error.status;
    }
    throw error;
  }
};

export const getPesajetPaymentStatus = async (transactionIdOrRef) => {
  const pesajet = getPesajetClient();
  try {
    return await pesajet.payments.get(transactionIdOrRef);
  } catch (error) {
    if (error instanceof PesaJetError) {
      error.status = error.statusCode || error.status;
    }
    throw error;
  }
};

/**
 * @desc    Create a deposit request
 * @route   POST /api/v1/payments/deposit
 * @access  Private
 */
export const createDeposit = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { amount, method, email, phoneNumber, idempotencyKey } = req.body;

    // ==========================================
    // 1. VALIDATE EVERYTHING BEFORE DB CREATION
    // ==========================================
    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      return errorResponse(
        res,
        "Amount must be a valid number greater than 0",
        400,
      );
    }

    const validMethods = ["manual", "card", "mtn", "airtel"];
    if (!validMethods.includes(method)) {
      return errorResponse(res, "Invalid payment method selected.", 400);
    }

    if (!idempotencyKey) {
      return errorResponse(res, "Idempotency key is required", 400);
    }

    if ((method === "mtn" || method === "airtel") && !phoneNumber) {
      return errorResponse(res, "Phone number is required", 400);
    }

    // Normalize and Validate Phone Number Early
    let formattedPhone = "";
    if (method === "mtn" || method === "airtel") {
      formattedPhone = formatPhoneNumber(phoneNumber);
      if (formattedPhone.length < 13) {
        return errorResponse(
          res,
          "Invalid Ugandan phone number format (e.g. 07XXXXXXXX or +2567XXXXXXXX)",
          400,
        );
      }

      const detected = detectProvider(formattedPhone);
      const isCrossNetwork = /^(?:\+?256|0)?73\d{7}$/.test(
        formattedPhone.replace(/\+/g, ""),
      );

      if (isCrossNetwork) {
        // 073 cuts across MTN and Airtel, requires explicit provider selection
        if (method !== "mtn" && method !== "airtel") {
          return errorResponse(
            res,
            "073 numbers cut across networks and require selecting either MTN or Airtel provider",
            400,
          );
        }
      } else if (detected && detected !== method) {
        return errorResponse(
          res,
          `Phone number ${phoneNumber} belongs to ${detected.toUpperCase()}, but ${method.toUpperCase()} was selected.`,
          400,
        );
      }
    }

    // ==========================================
    // 2. IDEMPOTENCY CHECK (ATOMIC & SAFE)
    // ==========================================
    const paymentId = generateUUID();
    const idempotencyRef = getRef(
      `paymentIdempotency/${userId}/${idempotencyKey}`,
    );

    const idempotencyClaim = await idempotencyRef.transaction((current) => {
      if (current && current.paymentId) return; // Abort - already exists and is claimed
      return { status: "pending", createdAt: Date.now(), paymentId: paymentId };
    });

    if (!idempotencyClaim.committed) {
      const existingSnap = await idempotencyRef.get();
      const existingData = existingSnap.val();

      if (existingData && existingData.paymentId) {
        const paymentSnap = await getRef(
          `payments/${existingData.paymentId}`,
        ).get();
        if (paymentSnap.exists()) {
          const p = paymentSnap.val();
          // Only clear if genuinely safe to retry (terminal failure states)
          if (
            p.status === "rejected" ||
            p.status === "cancelled" ||
            p.status === "expired"
          ) {
            await idempotencyRef.remove();
            return errorResponse(
              res,
              "Previous attempt failed. Please try again.",
              200,
            );
          }
          // If active or completed, return the existing payment info
          logger.info(
            `[Duplicate Prevented] Idempotency key match for active payment ${p.id}`,
          );
          if (p.method === "card" && p.redirectUrl) {
            return successResponse(
              res,
              "Card payment already initiated",
              {
                paymentId: p.id,
                reference: p.gatewayReference,
                redirect_url: p.redirectUrl,
              },
              200,
            );
          }
          return successResponse(res, "Payment already initiated", p, 200);
        }
      }
      return errorResponse(
        res,
        "A deposit request is already being processed. Please wait.",
        200,
      );
    }

    // ==========================================
    // 3. ACTIVE DEPOSIT LOCK (Check DB for active payments with staleness cleanup)
    // ==========================================
    if (method === "mtn" || method === "airtel") {
      const userPaymentsSnap = await getRef("payments")
        .orderByChild("userId")
        .equalTo(userId)
        .get();
      if (userPaymentsSnap.exists()) {
        const userPayments = Object.values(userPaymentsSnap.val());
        const activePayment = userPayments.find(
          (p) =>
            (p.method === "mtn" || p.method === "airtel") &&
            (p.status === "pending" || p.status === "processing"),
        );

        if (activePayment) {
          const paymentAge =
            Date.now() - new Date(activePayment.createdAt || 0).getTime();
          // Stale active deposit (> 10 minutes): USSD prompt has expired; safely clean up lock
          if (paymentAge > 600000) {
            logger.info(
              `[Active Deposit] Cleaning up stale deposit ${activePayment.id} (age: ${Math.round(paymentAge / 1000)}s) for user ${userId}`,
            );
            await getRef(`payments/${activePayment.id}`).update({
              status: "expired",
              failureReason: "Mobile money prompt expired",
            });
            await getRef(`transactions/${activePayment.id}`).update({
              status: "expired",
            });
            await getRef(`users/${userId}/activeDeposit`)
              .remove()
              .catch(() => {});
          } else {
            // Clear the idempotency claim we just created since we won't proceed with a new payment
            await idempotencyRef.remove();
            logger.info(
              `[Active Payment] User ${userId} already has active MTN/Airtel payment ${activePayment.id}`,
            );
            return successResponse(
              res,
              "You already have a pending Mobile Money deposit. Please complete the prompt on your phone or wait for it to expire.",
              activePayment,
              200,
            );
          }
        }
      }

      // Create the activeDeposit lock referencing the paymentId
      const lockRef = getRef(`users/${userId}/activeDeposit`);
      await lockRef.set({
        lockedAt: Date.now(),
        paymentId: paymentId,
        status: "pending",
      });
    }

    const bonus = 0.05;
    const totalCredit = parseFloat(parsedAmount) + bonus;
    const amountInUGX = Math.round(parsedAmount * USD_TO_UGX_RATE);

    const paymentData = {
      id: paymentId,
      userId,
      method,
      status: "pending",
      createdAt: new Date().toISOString(),
      amount: parsedAmount,
      bonus: bonus,
      totalCredit: totalCredit,
      amountUSD: parsedAmount,
      bonusUSD: bonus,
      totalCreditUSD: totalCredit,
      amountUGX: amountInUGX,
      exchangeRate: USD_TO_UGX_RATE,
      idempotencyKey: idempotencyKey,
    };

    // ==========================================
    // 4. ATOMIC SAVE BEFORE GATEWAY CALL
    // ==========================================
    const updates = {};
    updates[`payments/${paymentId}`] = paymentData;
    updates[`transactions/${paymentId}`] = {
      id: paymentId,
      userId,
      type: "deposit",
      amount: totalCredit,
      status: "pending",
      date: new Date().toISOString(),
      method: method,
    };
    await getRef().update(updates);

    // ==========================================
    // 5. HANDLE GATEWAY CALLS (SAFE FAILURES)
    // ==========================================

    // PATH 1: MANUAL PAYMENTS
    if (method === "manual") {
      await idempotencyRef.update({ status: "initiated" });
      return successResponse(
        res,
        "Deposit request created! Please send your receipt via WhatsApp.",
        paymentData,
        201,
      );
    }

    // PATH 2: CARD PAYMENTS (MARZPAY)
    if (method === "card") {
      try {
        const MARZPAY_API_URL =
          process.env.MARZPAY_API_URL || "https://wallet.wearemarz.com/api/v1";
        const MARZPAY_API_CREDENTIALS = process.env.MARZPAY_API_CREDENTIALS;
        const MARZPAY_CALLBACK_URL = process.env.MARZPAY_CALLBACK_URL;

        if (!MARZPAY_API_CREDENTIALS)
          throw new Error("MarzPay API credentials missing.");

        const marzpayReference = paymentId; // Deterministic reference
        const response = await fetch(`${MARZPAY_API_URL}/collect-money`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Basic ${MARZPAY_API_CREDENTIALS}`,
          },
          body: JSON.stringify({
            amount: amountInUGX,
            method: "card",
            reference: marzpayReference,
            country: "UG",
            description: "SMMMARIA Wallet Deposit",
            callback_url: MARZPAY_CALLBACK_URL,
          }),
        });
        const result = await response.json();

        if (!response.ok || !result.data || !result.data.redirect_url)
          throw new Error(
            result.message || "MarzPay did not return redirect URL.",
          );

        await getRef(`payments/${paymentId}`).update({
          gateway: "marzpay",
          gatewayReference: marzpayReference,
          redirectUrl: result.data.redirect_url,
        });

        await idempotencyRef.update({ status: "initiated" });

        return successResponse(
          res,
          "Card payment initiated",
          {
            paymentId,
            reference: marzpayReference,
            redirect_url: result.data.redirect_url,
          },
          201,
        );
      } catch (apiError) {
        logger.error(
          `[Gateway Unknown] Card payment ${paymentId} gateway call failed: ${apiError.message}. Left as pending.`,
        );
        await idempotencyRef.update({ status: "initiated" });
        return successResponse(
          res,
          "Payment initiated. Waiting for gateway confirmation...",
          { paymentId, status: "pending" },
          201,
        );
      }
    }

    // PATH 3: MTN & AIRTEL (PESAJET)
    if (method === "mtn" || method === "airtel") {
      const merchantRef = paymentId.replace(/-/g, "");
      const gatewayPayload = {
        type: "COLLECTION",
        amount: amountInUGX,
        currency: "UGX",
        phoneNumber: formattedPhone,
        provider: method,
        reference: merchantRef,
        description: "Wallet Deposit",
        idempotencyKey: idempotencyKey,
        metadata: {
          userId,
          paymentId,
          amountUSD: parsedAmount,
        },
      };

      try {
        const gatewayResponse = await processPesaJetPayment(gatewayPayload);
        const gatewayRef =
          gatewayResponse.transactionId || gatewayResponse.id || merchantRef;

        await getRef(`payments/${paymentId}`).update({
          gateway: "pesajet",
          gatewayReference: gatewayRef,
          merchantReference: merchantRef,
        });

        await idempotencyRef.update({ status: "initiated" });

        return successResponse(
          res,
          "Payment request sent to your phone. Please approve the prompt.",
          {
            ...paymentData,
            gatewayReference: gatewayRef,
          },
          201,
        );
      } catch (apiError) {
        logger.error(
          `[PesaJet Initiation Failed] Payment ${paymentId}: ${apiError.message}`,
        );

        // Immediate Client / Validation / Auth errors (HTTP 4xx): Do NOT leave user trapped in zombie pending lock
        const statusCode = apiError.statusCode || apiError.status;
        const isClientOrAuthError =
          statusCode &&
          statusCode >= 400 &&
          statusCode < 500 &&
          statusCode !== 408;

        if (isClientOrAuthError) {
          await getRef(`payments/${paymentId}`).update({
            status: "rejected",
            failureReason: apiError.message,
            rejectedAt: new Date().toISOString(),
          });
          await getRef(`transactions/${paymentId}`).update({
            status: "rejected",
          });
          await getRef(`users/${userId}/activeDeposit`)
            .remove()
            .catch(() => {});
          await idempotencyRef.remove().catch(() => {});

          return errorResponse(
            res,
            apiError.message ||
              "Payment request failed. Please check your details and try again.",
            statusCode || 400,
          );
        }

        // For ambiguous network failures (timeouts/500), keep as pending for cron recovery
        await getRef(`payments/${paymentId}`).update({
          gateway: "pesajet",
          gatewayReference: merchantRef,
          merchantReference: merchantRef,
        });
        await idempotencyRef.update({ status: "initiated" });

        return successResponse(
          res,
          "Payment request sent. Waiting for gateway confirmation...",
          { paymentId, status: "pending" },
          201,
        );
      }
    }
  } catch (error) {
    next(error);
  }
};

// ==========================================
// PESAJET WEBHOOK
// ==========================================
export const pesajetWebhook = async (req, res, next) => {
  try {
    const payload = req.body || {};
    const { transactionId, status, event, reference } = payload;

    // 1. HMAC-SHA256 Signature Verification via @pesajet/sdk (if secret configured)
    const secret = process.env.PESAJET_WEBHOOK_SECRET;
    if (secret) {
      const signature = req.headers["x-webhook-signature"] || payload.signature;
      if (signature) {
        const pesajet = getPesajetClient();
        const isValid = pesajet.webhooks.verify(req.body, signature, secret);
        if (!isValid) {
          logger.warn(`[PesaJet Webhook] Invalid signature rejected.`);
          return res.status(401).send("Invalid webhook signature");
        }
      }
    }

    const searchId = transactionId || reference;
    if (!searchId)
      return res.status(400).send("Transaction ID or reference required");

    // 2. Multi-Key Lookup: check gatewayReference, merchantReference, and paymentId
    let targetPaymentId = null;
    let paymentData = null;

    if (transactionId) {
      const snap = await getRef("payments")
        .orderByChild("gatewayReference")
        .equalTo(transactionId)
        .get();
      if (snap.exists()) {
        const val = snap.val();
        const firstKey = Object.keys(val)[0];
        paymentData = val[firstKey];
        targetPaymentId =
          paymentData?.id || firstKey.replace(/^payments\//, "");
      }
    }

    if (!targetPaymentId && reference) {
      const snap = await getRef("payments")
        .orderByChild("gatewayReference")
        .equalTo(reference)
        .get();
      if (snap.exists()) {
        const val = snap.val();
        const firstKey = Object.keys(val)[0];
        paymentData = val[firstKey];
        targetPaymentId =
          paymentData?.id || firstKey.replace(/^payments\//, "");
      }
    }

    if (!targetPaymentId && reference) {
      const snap = await getRef("payments")
        .orderByChild("merchantReference")
        .equalTo(reference)
        .get();
      if (snap.exists()) {
        const val = snap.val();
        const firstKey = Object.keys(val)[0];
        paymentData = val[firstKey];
        targetPaymentId =
          paymentData?.id || firstKey.replace(/^payments\//, "");
      }
    }

    if (!targetPaymentId && searchId) {
      const cleanSearchId = String(searchId).replace(/^payments\//, "");
      const directSnap = await getRef(`payments/${cleanSearchId}`).get();
      if (directSnap.exists()) {
        targetPaymentId = cleanSearchId;
        paymentData = directSnap.val();
      }
    }

    if (!targetPaymentId) {
      logger.warn(
        `[PesaJet Webhook] No matching payment found for transactionId=${transactionId}, reference=${reference}`,
      );
      return res.status(200).send("Payment not found, ignored");
    }

    // Ensure gatewayReference is populated with PesaJet transactionId
    if (transactionId && paymentData.gatewayReference !== transactionId) {
      await getRef(`payments/${targetPaymentId}`).update({
        gatewayReference: transactionId,
      });
    }

    // 3. Case-Insensitive Status Handling
    if (isPaymentSuccessful(status, event)) {
      logger.info(
        `[PesaJet Webhook] Settling confirmed payment ${targetPaymentId}.`,
      );
      await settlePayment(targetPaymentId, "pesajet_webhook");
      if (paymentData.userId) {
        await getRef(`users/${paymentData.userId}/activeDeposit`)
          .remove()
          .catch(() => {});
      }
    } else if (isPaymentFailed(status, event)) {
      logger.warn(
        `[PesaJet Webhook] Rejecting payment ${targetPaymentId} (${status || event}).`,
      );
      const txResult = await getRef(`payments/${targetPaymentId}`).transaction(
        (p) => {
          if (p && (p.status === "pending" || p.status === "processing")) {
            p.status = "rejected";
            p.failureReason = payload.failureReason || status || event;
            return p;
          }
          return;
        },
      );

      if (txResult.committed) {
        await getRef(`transactions/${targetPaymentId}`).update({
          status: "rejected",
        });
        if (paymentData.userId) {
          await getRef(`users/${paymentData.userId}/activeDeposit`)
            .remove()
            .catch(() => {});
        }
      }
    }

    return res.status(200).send("Webhook received");
  } catch (error) {
    next(error);
  }
};

// ==========================================
// MARZPAY WEBHOOK
// ==========================================
export const marzPayWebhook = async (req, res, next) => {
  try {
    const { event_type, collection } = req.body;
    if (!collection || !collection.reference)
      return res.status(400).send("Invalid MarzPay payload");

    const snapshot = await getRef("payments")
      .orderByChild("gatewayReference")
      .equalTo(collection.reference)
      .get();
    if (!snapshot.exists()) return res.status(200).send("Payment not found");

    const payments = snapshot.val();
    const paymentKeys = Object.keys(payments);

    if (
      event_type === "collection.completed" ||
      collection.status === "completed"
    ) {
      await settlePayment(paymentKeys[0], "marzpay_webhook");
      if (payments[paymentKeys[0]]?.userId) {
        await getRef(`users/${payments[paymentKeys[0]].userId}/activeDeposit`)
          .remove()
          .catch(() => {});
      }

      for (let i = 1; i < paymentKeys.length; i++) {
        await getRef(`payments/${paymentKeys[i]}`).transaction((p) => {
          if (p && (p.status === "pending" || p.status === "processing")) {
            p.status = "rejected";
            p.failureReason = "Duplicate gateway transaction";
            return p;
          }
          return;
        });
      }
    } else if (
      event_type === "collection.failed" ||
      collection.status === "failed"
    ) {
      for (const key of paymentKeys) {
        const txResult = await getRef(`payments/${key}`).transaction((p) => {
          if (p && (p.status === "pending" || p.status === "processing")) {
            p.status = "rejected";
            p.failureReason = collection.status;
            return p;
          }
          return;
        });

        if (txResult.committed) {
          await getRef(`transactions/${key}`).update({ status: "rejected" });
          if (payments[key].userId)
            await getRef(`users/${payments[key].userId}/activeDeposit`)
              .remove()
              .catch(() => {});
        }
      }
    }
    return res.status(200).send("Webhook received");
  } catch (error) {
    next(error);
  }
};

// ==========================================
// CRON JOB FUNCTION (Reconciliation & Recovery)
// ==========================================
export const checkPendingPayments = async () => {
  const cronLockRef = getRef("cronLocks/checkPendingPayments");

  const lockResult = await cronLockRef.transaction((current) => {
    if (!current) return { lockedAt: Date.now() };
    if (Date.now() - current.lockedAt > 120000) return { lockedAt: Date.now() };
    return;
  });

  if (!lockResult.committed) {
    logger.info("[Cron] Skipped execution: another instance is running.");
    return;
  }

  logger.info(
    "[Cron] Distributed lock acquired. Running pending payments check...",
  );

  try {
    // 1. PROTECT THE STALE `processing` RECOVERY PATH
    const processingSnap = await getRef("payments")
      .orderByChild("status")
      .equalTo("processing")
      .get();
    if (processingSnap.exists()) {
      const processingPayments = Object.values(processingSnap.val());
      for (const payment of processingPayments) {
        const age = Date.now() - (payment.processingStartedAt || 0);
        // Only recover if processing for > 5 minutes (safety buffer)
        if (age > 300000) {
          const recoveryClaimRef = getRef(`settlementClaims/${payment.id}`);
          const claimResult = await recoveryClaimRef.transaction((c) => {
            if (!c)
              return {
                source: "cron_recovery",
                claimedAt: Date.now(),
                claimId: generateUUID(),
              };
            if (Date.now() - c.claimedAt > 60000)
              return {
                source: "cron_recovery",
                claimedAt: Date.now(),
                claimId: generateUUID(),
              };
            return;
          });

          if (!claimResult.committed) {
            logger.info(
              `[Cron] Duplicate settlement prevented paymentId=${payment.id} source=cron_recovery`,
            );
            continue;
          }

          const claimData = claimResult.snapshot.val() || {};
          logger.info(
            `[Cron Recovery] Settlement attempt: paymentId=${payment.id} userId=${payment.userId} gatewayReference=${payment.gatewayReference} previousStatus=processing cronSource=cron_recovery claimId=${claimData.claimId}`,
          );

          await settlePayment(payment.id, "cron_recovery");
        }
      }
    }

    // 2. PENDING PesaJet RECONCILIATION PATH
    const pendingSnap = await getRef("payments")
      .orderByChild("status")
      .equalTo("pending")
      .get();
    if (!pendingSnap.exists()) return;

    const pendingPayments = Object.values(pendingSnap.val());
    for (const payment of pendingPayments) {
      // ONLY check PesaJet payments
      if (
        payment.gateway !== "pesajet" &&
        payment.method !== "mtn" &&
        payment.method !== "airtel"
      ) {
        continue;
      }

      const currentPaymentSnap = await getRef(`payments/${payment.id}`).get();
      const currentPayment = currentPaymentSnap.val();

      if (!currentPayment || currentPayment.status !== "pending") {
        continue;
      }

      // Check age: auto-expire pending payments older than 24 hours
      const createdAtMs = currentPayment.createdAt
        ? new Date(currentPayment.createdAt).getTime()
        : 0;
      if (createdAtMs > 0 && Date.now() - createdAtMs > 86400000) {
        logger.info(
          `[Cron] Payment ${currentPayment.id} exceeded 24h expiration limit. Expiring.`,
        );
        await getRef(`payments/${currentPayment.id}`).update({
          status: "expired",
          failureReason: "Expired after 24 hours",
        });
        await getRef(`transactions/${currentPayment.id}`).update({
          status: "expired",
        });
        if (currentPayment.userId)
          await getRef(`users/${currentPayment.userId}/activeDeposit`)
            .remove()
            .catch(() => {});
        continue;
      }

      const queryRef =
        currentPayment.gatewayReference ||
        currentPayment.merchantReference ||
        currentPayment.id;
      if (!queryRef) continue;

      // Duplicate gateway transaction check
      if (currentPayment.gatewayReference) {
        const dupSnap = await getRef("payments")
          .orderByChild("gatewayReference")
          .equalTo(currentPayment.gatewayReference)
          .get();
        let isDuplicate = false;
        if (dupSnap.exists()) {
          const dups = dupSnap.val();
          for (const key in dups) {
            if (
              key !== currentPayment.id &&
              (dups[key].status === "completed" ||
                dups[key].status === "processing")
            ) {
              isDuplicate = true;
              break;
            }
          }
        }

        if (isDuplicate) {
          logger.info(
            `[Cron] Duplicate gateway payment prevented paymentId=${currentPayment.id} gatewayReference=${currentPayment.gatewayReference}`,
          );
          await getRef(`payments/${currentPayment.id}`).update({
            status: "rejected",
            failureReason: "Duplicate gateway transaction",
          });
          await getRef(`transactions/${currentPayment.id}`).update({
            status: "rejected",
          });
          if (currentPayment.userId)
            await getRef(`users/${currentPayment.userId}/activeDeposit`)
              .remove()
              .catch(() => {});
          continue;
        }
      }

      // ATOMIC GATEWAY CLAIM FOR CRON WORKERS
      if (currentPayment.gatewayReference) {
        const gwClaimRef = getRef(
          `gatewayClaims/${currentPayment.gatewayReference}`,
        );
        const gwClaimResult = await gwClaimRef.transaction((c) => {
          if (!c)
            return { claimedAt: Date.now(), paymentId: currentPayment.id };
          if (Date.now() - c.claimedAt > 60000)
            return { claimedAt: Date.now(), paymentId: currentPayment.id };
          return;
        });

        if (!gwClaimResult.committed) {
          logger.info(
            `[Cron] Gateway reference ${currentPayment.gatewayReference} already claimed by another worker. Skipping.`,
          );
          continue;
        }
      }

      // Claim for reconciliation
      const reconClaimRef = getRef(`settlementClaims/${currentPayment.id}`);
      const claimResult = await reconClaimRef.transaction((c) => {
        if (!c)
          return {
            source: "cron_reconciliation",
            claimedAt: Date.now(),
            claimId: generateUUID(),
          };
        if (Date.now() - c.claimedAt > 60000)
          return {
            source: "cron_reconciliation",
            claimedAt: Date.now(),
            claimId: generateUUID(),
          };
        return;
      });

      if (!claimResult.committed) {
        logger.info(
          `[Cron] Duplicate settlement prevented paymentId=${currentPayment.id} source=cron_reconciliation`,
        );
        continue;
      }

      const claimData = claimResult.snapshot.val() || {};

      // Query PesaJet status
      let gatewayStatus = "UNKNOWN";
      let failureReason = null;
      try {
        const result = await getPesajetPaymentStatus(queryRef);
        gatewayStatus = result.status || result.event || "UNKNOWN";
        failureReason = result.failureReason || null;
      } catch (apiError) {
        logger.error(
          `[Cron] PesaJet API query failed for ${currentPayment.id}: ${apiError.message}`,
        );
      }

      if (isPaymentSuccessful(gatewayStatus)) {
        logger.info(
          `[Cron Reconciliation] Settlement attempt: paymentId=${currentPayment.id} userId=${currentPayment.userId} gatewayReference=${currentPayment.gatewayReference} cronSource=cron_reconciliation claimId=${claimData.claimId} gatewayStatus=${gatewayStatus}`,
        );

        const settlementResult = await settlePayment(
          currentPayment.id,
          "cron_reconciliation",
        );
        logger.info(
          `[Cron Reconciliation] Settlement result: paymentId=${currentPayment.id} result=${JSON.stringify(settlementResult)}`,
        );

        if (settlementResult.success || settlementResult.alreadySettled) {
          if (currentPayment.userId)
            await getRef(`users/${currentPayment.userId}/activeDeposit`)
              .remove()
              .catch(() => {});
        }
      } else if (isPaymentFailed(gatewayStatus)) {
        const rejectResult = await getRef(
          `payments/${currentPayment.id}`,
        ).transaction((p) => {
          if (p && p.status === "pending") {
            p.status = "rejected";
            p.failureReason = failureReason || gatewayStatus;
            return p;
          }
          return;
        });

        if (rejectResult.committed) {
          await getRef(`transactions/${currentPayment.id}`).update({
            status: "rejected",
          });
          if (currentPayment.userId)
            await getRef(`users/${currentPayment.userId}/activeDeposit`)
              .remove()
              .catch(() => {});
        }
      } else {
        logger.info(
          `[Cron Reconciliation] Payment ${currentPayment.id} still pending at gateway (${gatewayStatus}). Will retry later.`,
        );
      }
    }
  } catch (error) {
    console.error("Cron Error:", error.message);
  } finally {
    await cronLockRef.remove();
    logger.info("[Cron] Released distributed lock.");
  }
};

// ==========================================
// STATUS ENDPOINT (Real-time Status Polling)
// ==========================================
/**
 * @desc    Get real-time payment status
 * @route   GET /api/v1/payments/:id/status
 * @access  Private
 */
export const getPaymentStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;
    const userRole = req.user?.role;

    if (!id) {
      return errorResponse(res, "Payment ID is required", 400);
    }

    const paymentRef = getRef(`payments/${id}`);
    const paymentSnap = await paymentRef.get();

    if (!paymentSnap.exists()) {
      return errorResponse(res, "Payment not found", 404);
    }

    let payment = paymentSnap.val();

    // Access control: normal user can only view their own payments
    if (userRole === "user" && payment.userId !== userId) {
      return errorResponse(res, "Unauthorized to view this payment", 403);
    }

    // If still pending or processing, poll PesaJet API in real-time
    if (
      (payment.status === "pending" || payment.status === "processing") &&
      (payment.gateway === "pesajet" ||
        payment.method === "mtn" ||
        payment.method === "airtel")
    ) {
      const queryRef =
        payment.gatewayReference || payment.merchantReference || payment.id;
      if (queryRef) {
        try {
          const liveData = await getPesajetPaymentStatus(queryRef);
          const liveStatus = liveData.status || liveData.event;

          if (isPaymentSuccessful(liveStatus)) {
            logger.info(
              `[Status Poll] Payment ${id} confirmed successful via PesaJet live query. Settling now.`,
            );
            await settlePayment(id, "status_poll");
            if (payment.userId) {
              await getRef(`users/${payment.userId}/activeDeposit`)
                .remove()
                .catch(() => {});
            }
            const updatedSnap = await paymentRef.get();
            if (updatedSnap.exists()) payment = updatedSnap.val();
          } else if (isPaymentFailed(liveStatus)) {
            logger.warn(
              `[Status Poll] Payment ${id} reported failed/expired (${liveStatus}) on PesaJet.`,
            );
            await paymentRef.update({
              status: "rejected",
              failureReason: liveData.failureReason || liveStatus,
              rejectedAt: new Date().toISOString(),
            });
            await getRef(`transactions/${id}`).update({ status: "rejected" });
            if (payment.userId) {
              await getRef(`users/${payment.userId}/activeDeposit`)
                .remove()
                .catch(() => {});
            }
            const updatedSnap = await paymentRef.get();
            if (updatedSnap.exists()) payment = updatedSnap.val();
          }
        } catch (pollErr) {
          logger.warn(
            `[Status Poll] Live PesaJet check failed for ${id}: ${pollErr.message}`,
          );
        }
      }
    }

    return successResponse(res, "Payment status fetched successfully", {
      id: payment.id,
      status: payment.status,
      method: payment.method,
      amount: payment.amount,
      amountUGX: payment.amountUGX,
      totalCredit: payment.totalCredit,
      totalCreditUSD: payment.totalCreditUSD,
      gateway: payment.gateway,
      gatewayReference: payment.gatewayReference || null,
      failureReason: payment.failureReason || null,
      createdAt: payment.createdAt,
      completedAt: payment.completedAt || null,
    });
  } catch (error) {
    next(error);
  }
};

// ==========================================
// ADMIN FUNCTIONS
// ==========================================
export const approvePayment = async (req, res, next) => {
  try {
    const { id } = req.params;
    // Pass `true` for isAdminOverride so the Admin can bypass gateway locks
    const result = await settlePayment(id, "admin_manual", true);
    if (result.alreadySettled)
      return errorResponse(res, "Payment already approved", 400);
    if (!result.success)
      return errorResponse(res, "Payment could not be approved", 400);

    // Explicitly ensure activeDeposit lock is cleared for user
    const paymentSnap = await getRef(`payments/${id}`).get();
    if (paymentSnap.exists() && paymentSnap.val().userId) {
      await getRef(`users/${paymentSnap.val().userId}/activeDeposit`)
        .remove()
        .catch(() => {});
    }

    return successResponse(
      res,
      "Payment approved and wallet credited successfully",
    );
  } catch (error) {
    next(error);
  }
};

export const rejectPayment = async (req, res, next) => {
  try {
    const { id } = req.params;
    const paymentRef = getRef(`payments/${id}`);
    const paymentSnapshot = await paymentRef.get();
    if (!paymentSnapshot.exists())
      return errorResponse(res, "Payment not found", 404);

    const result = await paymentRef.transaction((p) => {
      if (p && (p.status === "pending" || p.status === "processing")) {
        p.status = "rejected";
        p.rejectedAt = new Date().toISOString();
        return p;
      }
      return;
    });

    if (!result.committed)
      return errorResponse(
        res,
        "Payment is already completed or rejected",
        400,
      );
    await getRef(`transactions/${id}`).update({ status: "rejected" });
    if (result.snapshot.val().userId)
      await getRef(`users/${result.snapshot.val().userId}/activeDeposit`)
        .remove()
        .catch(() => {});
    return successResponse(res, "Payment rejected successfully");
  } catch (error) {
    next(error);
  }
};

// ==========================================
// USER CANCEL PENDING DEPOSIT
// ==========================================
export const cancelPendingDeposit = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const snapshot = await getRef("payments")
      .orderByChild("userId")
      .equalTo(userId)
      .get();
    if (!snapshot.exists())
      return errorResponse(res, "No pending deposits found.", 404);

    let cancelledCount = 0;
    let alreadyProcessedCount = 0;
    const updates = {};

    for (const key in snapshot.val()) {
      const payment = snapshot.val()[key];
      if (payment.method === "mtn" || payment.method === "airtel") {
        const paymentRef = getRef(`payments/${key}`);
        const cancelRes = await paymentRef.transaction((p) => {
          if (!p) return;
          if (p.status === "pending") {
            p.status = "cancelled";
            p.failureReason = "Cancelled by user";
            return p;
          }
          return;
        });

        if (cancelRes.committed) {
          updates[`transactions/${key}/status`] = "cancelled";
          updates[`users/${userId}/activeDeposit`] = null; // Release lock only on successful cancel
          cancelledCount++;
        } else {
          const currentStatus = cancelRes.snapshot.val()?.status;
          if (currentStatus === "processing" || currentStatus === "completed") {
            alreadyProcessedCount++;
          } else if (currentStatus === "cancelled") {
            cancelledCount++;
          }
        }
      }
    }

    if (cancelledCount > 0) {
      await getRef().update(updates);
      return successResponse(res, "Pending deposit cancelled successfully.");
    } else if (alreadyProcessedCount > 0) {
      return successResponse(
        res,
        "Deposit is already being processed or completed.",
      );
    } else {
      return errorResponse(
        res,
        "No pending MTN/Airtel deposits found to cancel.",
        404,
      );
    }
  } catch (error) {
    next(error);
  }
};

// ==========================================
// GET PAYMENTS
// ==========================================
export const getPayments = async (req, res, next) => {
  try {
    const snapshot = await getRef("payments").get();
    let payments = snapshot.exists()
      ? Object.values(snapshot.val()).reverse()
      : [];
    const usersSnapshot = await getRef("users").get();
    const usersMap = {};
    if (usersSnapshot.exists()) {
      const usersObj = usersSnapshot.val();
      for (const key in usersObj) {
        usersMap[key] = {
          username: usersObj[key].username || usersObj[key].email || "Unknown",
          totalDeposited: usersObj[key].totalDeposited || 0,
          balance: usersObj[key].balance || 0,
        };
      }
    }
    payments = payments.map((p) => ({
      ...p,
      username: usersMap[p.userId]?.username || "Unknown",
      totalDeposited: usersMap[p.userId]?.totalDeposited || 0,
      balance: usersMap[p.userId]?.balance || 0,
    }));
    if (req.user.role === "user")
      payments = payments.filter((p) => p.userId === req.user.id);
    return successResponse(res, "Payments fetched successfully", payments);
  } catch (error) {
    next(error);
  }
};

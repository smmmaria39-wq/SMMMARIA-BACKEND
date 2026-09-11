// ===============================================
// Payment Routes
// ===============================================

import express from "express";
import { z } from "zod";
import { validate } from "../middleware/validation.js";
import { protect } from "../middleware/auth.js";
import { admin } from "../middleware/admin.js";
import {
  createDeposit,
  approvePayment,
  rejectPayment,
  getPayments,
  getPaymentStatus,
  pesajetWebhook,
  marzPayWebhook,
  cancelPendingDeposit,
} from "../controllers/payment.controller.js";

const router = express.Router();

// ==========================================
// VALIDATION SCHEMAS
// ==========================================

// Strict validation for deposit creation
const depositSchema = {
  body: z
    .object({
      // Amount must be a positive number, capped at 10000 to prevent abuse
      amount: z
        .number()
        .positive("Amount must be greater than 0")
        .max(10000, "Maximum deposit is $10,000"),

      // Method must be one of the exact supported strings
      method: z.enum(["mtn", "airtel", "card", "manual"], {
        errorMap: () => ({ message: "Invalid payment method" }),
      }),

      // FIX: Added idempotencyKey to pass .strict() validation
      idempotencyKey: z.string().min(1, "Idempotency key is required"),

      // Optional fields with strict validation
      email: z.string().email("Invalid email format").optional(),
      phoneNumber: z
        .string()
        .regex(
          /^(?:\+?256|0)(?:77|78|76|79|39|70|75|74|73)\d{7}$/,
          "Invalid Ugandan phone number format (e.g., 07XXXXXXXX or +2567XXXXXXXX)",
        )
        .optional(),
      receipt: z.string().optional(),
    })
    // Strip unknown properties to prevent injection of unexpected fields
    .strict(),
};

// ==========================================
// WEBHOOK ROUTES
// ==========================================

// PesaJet Webhook — MTN/Airtel (Server-to-Server POST)
// The controller verifies the transaction status before calling settlePayment()
router.post("/webhook", pesajetWebhook);

// MarzPay Webhook — Card payments (Server-to-Server POST)
// The controller verifies the event_type/collection status before calling settlePayment()
router.post("/marzpay-webhook", marzPayWebhook);

// MarzPay Webhook — Browser Redirect (GET request)
// CRITICAL SECURITY: This route ONLY redirects the user's browser back to the frontend.
// It NEVER credits a wallet, marks a payment as approved, or trusts the browser's return URL.
// The actual settlement is handled exclusively by the POST /marzpay-webhook route above.
router.get("/marzpay-webhook", (req, res) => {
  const frontendUrl = process.env.FRONTEND_URL || "https://smmaria.site";
  res.redirect(`${frontendUrl}/wallet.html`);
});

// ==========================================
// USER ROUTES
// ==========================================

// Create deposit request (MTN, Airtel, Card, Manual)
router.post("/deposit", protect, validate(depositSchema), createDeposit);

// Cancel a stuck pending Mobile Money deposit
router.post("/cancel", protect, cancelPendingDeposit);

// Query real-time payment status (supports both /:id/status and /status/:id)
router.get("/:id/status", protect, getPaymentStatus);
router.get("/status/:id", protect, getPaymentStatus);

// Get payment history (Controller filters out sensitive data like gateway payloads/credentials for users)
router.get("/", protect, getPayments);

// ==========================================
// ADMIN ROUTES
// ==========================================

// Admin manual approval (Controller calls settlePayment() which is idempotent)
// If the gateway already settled this, settlePayment() safely aborts the credit.
router.put("/:id/approve", protect, admin, approvePayment);

// Admin manual rejection
router.put("/:id/reject", protect, admin, rejectPayment);

export default router;

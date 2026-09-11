# Walkthrough: Fixing Stuck Pending Transactions in PesaJet Payments

We resolved all the root causes causing the user's mobile money transactions to get stuck at `pending`, added the requested real-time status query endpoints, and aligned the implementation with official PesaJet API & carrier standards.

---

## Key Root Causes Identified & Fixed

### 1. Non-Existent API Endpoint & Misconfigured Base URL

- **Before**: Defaulted to `https://api.pesajet.com/v1/transactions` (which returns HTTP 404). In the cron job, it attempted to query `${process.env.PESAJET_API_URL}/${currentPayment.gatewayReference}`, causing queries to 404.
- **Fix**: Built `getPesajetConfig()` to sanitize both `PESAJET_API_BASE_URL` and `PESAJET_API_URL`, ensuring predictable endpoints:
  - Initiate: `POST <baseUrl>/payments` (e.g. `https://api.pesajet.com/api/v1/payments`)
  - Query Status: `GET <baseUrl>/payments/:transactionId`

### 2. Status Case Sensitivity (Why Webhooks & Cron Never Settled)

- **Before**: User code strictly checked uppercase strings (`status === 'SUCCESS' || status === 'COMPLETED' || status === 'SUCCESSFUL'`). PesaJet sends lowercase statuses (`'completed'`, `'failed'`, `'expired'`) and events (`'payment.completed'`). Because `'completed' === 'COMPLETED'` is `false`, webhooks and cron jobs failed to trigger settlement and left transactions in `pending`.
- **Fix**: Added `isPaymentSuccessful()` and `isPaymentFailed()` to normalize status strings case-insensitively and handle both status codes and webhook event types.

### 3. Swallowed Gateway Errors and Zombie Pending Deposits

- **Before**: On payment initiation failure, the error was caught and swallowed, responding to the user with HTTP 201 "Payment request sent. Waiting for gateway confirmation..." while leaving an invalid pending record in Firebase without a `gatewayReference`.
- **Fix**: Distinguish between immediate validation/auth/client errors (HTTP 4xx) and network timeouts. For genuine client errors (e.g., bad phone number, carrier mismatch), the system immediately marks the payment as rejected, removes the `activeDeposit` lock, and returns the actionable error message to the client.

### 4. Uncleared `activeDeposit` Lock Trapping Users

- **Before**: `activeDeposit` lock was never removed upon settlement in `settlePayment()`, `pesajetWebhook()`, `marzPayWebhook()`, or `approvePayment()`. Furthermore, there was no expiration on active deposit locks, permanently blocking users with: _"You already have a pending Mobile Money deposit"_.
- **Fix**:
  - `settlePayment()` now automatically clears `users/${userId}/activeDeposit` on wallet credit.
  - Webhooks and admin approval now ensure `activeDeposit` is cleared.
  - `createDeposit()` now automatically cleans up stale active deposits (> 10 minutes old) so users are never permanently blocked.

### 5. Multi-Key Webhook Lookup & HMAC Security

- **Before**: Webhook lookup searched only `gatewayReference == transactionId`, missing payments identified by merchant reference. Webhook HMAC signatures were not verified.
- **Fix**: Implemented multi-key resolution (`gatewayReference == transactionId`, `gatewayReference == reference`, `merchantReference == reference`, and direct ID lookup). Added HMAC-SHA256 signature verification using `PESAJET_WEBHOOK_SECRET`.

### 6. Telecom & Carrier Detection Rules Compliance

- **Before**: Mismatched phone prefixes caused PesaJet API to reject the payment, which was then swallowed into a zombie pending state.
- **Fix**: Implemented carrier detection adhering to repository guidelines:
  - MTN Uganda: `077`, `078`, `076`, `079`, `039`
  - Airtel Uganda: `070`, `075`, `074`
  - Cross-Network: `073` requires explicit provider selection (`mtn` or `airtel`).
  - Pre-validates number against provider before calling the gateway.

### 7. New Real-Time Status Endpoint

- **Before**: No endpoint existed for frontend/user status polling.
- **Fix**: Added `getPaymentStatus` registered on both `GET /api/v1/payments/:id/status` and `GET /api/v1/payments/status/:id`. When called on a pending or processing transaction, it polls PesaJet in real-time and auto-settles if confirmed completed.

---

## Changes Summary

| File                                                                                                                        | Changes                                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [settlement.service.js](file:///Users/devcodex/projects/pesajet-core/pesajet-pay-users-code/payments/settlement.service.js) | Cleans up `users/${userId}/activeDeposit` on completion and rejection; sanitizes `paymentId`; enables `cron_recovery` processing takeover.                                |
| [payment.controller.js](file:///Users/devcodex/projects/pesajet-core/pesajet-pay-users-code/payments/payment.controller.js) | URL normalization, carrier detection, case-insensitive status handling, multi-key webhook lookup, HMAC verification, stale lock expiration, and added `getPaymentStatus`. |
| [payment.routes.js](file:///Users/devcodex/projects/pesajet-core/pesajet-pay-users-code/payments/payment.routes.js)         | Registered `GET /:id/status` and `GET /status/:id` routes; updated Zod phone regex to include `039` and all valid prefixes.                                               |

---

## Verification Results

All 8 automated test scenarios passed with zero errors:

1. **Carrier Detection & Formatting**: Validated MTN (`077`, `078`, `076`, `079`, `039`), Airtel (`070`, `075`, `074`), and cross-network `073`.
2. **Status Normalization**: Validated `'completed'`, `'COMPLETED'`, `'success'`, `'payment.completed'`, and failure states.
3. **URL Normalization**: Validated base URLs with and without trailing slashes, `/payments`, and `/v1/transactions`.
4. **Settlement & Lock Cleanup**: Verified wallet credit and atomic removal of `users/${userId}/activeDeposit`.
5. **Real-time Status Polling**: Verified `getPaymentStatus` returns clean response and status.
6. **Webhook HMAC & Multi-Key Lookup**: Verified signature authentication and resolution of lowercase `'completed'` status.
7. **Carrier Mismatch Rejection**: Verified `createDeposit` rejects incompatible provider selections before contacting gateway.
8. **Stale Lock Auto-Expiration**: Verified deposits older than 10 minutes automatically expire and unblock new deposits.

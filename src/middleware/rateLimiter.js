// ===============================================
// Rate Limiting Middleware
// ===============================================

import rateLimit from "express-rate-limit";

// General API rate limiter
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // Generous limit for normal API usage
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    const url = (req.originalUrl || req.url || req.path || "").toLowerCase();
    // Remove rate limits on webhooks, status polling, payment queries, wallet balance, and chat polling
    return (
      url.includes("/webhook") ||
      url.includes("/status") ||
      url.includes("/payments") ||
      url.includes("/wallet") ||
      url.includes("/chat")
    );
  },
  message: {
    success: false,
    message:
      "Too many requests from this IP, please try again after 15 minutes",
  },
});

// Strict rate limiter for authentication routes
export const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // Limit each IP to 10 auth requests per hour
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many authentication attempts, please try again after an hour",
  },
});

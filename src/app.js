// ===============================================
// Express App Configuration
// ===============================================

import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import { env } from './config/env.js';
import { apiLimiter } from './middleware/rateLimiter.js';
import { notFound, errorHandler } from './middleware/errorHandler.js';
import { identifyPanel } from './middleware/panelContext.js'; // <-- ADDED THIS IMPORT
import router from './routes/index.js';

// Initialize Express App
const app = express();

// 0. Trust Proxy (Required for Railway to prevent rate-limiter crashes)
app.set('trust proxy', 1);

// 1. Security Middleware
app.use(helmet()); // Sets HTTP headers for security

// 2. CORS Configuration (Crucial for GitHub Pages frontend)
// 2. CORS Configuration
const corsOptions = {
 origin: [
  'https://smmaria.netlify.app', // Your main user frontend
  'https://adminsmmq.netlify.app', // Your admin frontend
  'http://localhost:5500', // Added for local testing
  'http://127.0.0.1:5500' // Added for local testing
 ],
 methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
 allowedHeaders: ['Content-Type', 'Authorization', 'X-Panel-Domain'], // <-- ADDED 'X-Panel-Domain' HERE
 credentials: true
};
app.use(cors(corsOptions));

// 3. Logging (HTTP requests)
if (env.nodeEnv !== 'test') {
 app.use(morgan(env.isProduction ? 'combined' : 'dev'));
}

// 4. Body Parser Middleware
app.use(express.json({ limit: '10mb' })); // Parse JSON bodies
app.use(express.urlencoded({ extended: true, limit: '10mb' })); // Parse URL-encoded bodies

// 5. Rate Limiting
app.use('/api/', apiLimiter); // Apply to all API routes

// 6. Multi-Tenancy Middleware (MUST BE BEFORE ROUTES)
app.use(identifyPanel); // <-- ADDED THIS LINE

// 7. Routes
app.use('/api/v1', router); // All API endpoints will start with /api/v1

// 8. Error Handling Middleware (Must be last)
app.use(notFound); // Handle 404s
app.use(errorHandler); // Global error handler

export default app;

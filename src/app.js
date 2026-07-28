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
import router from './routes/index.js';

// Initialize Express App
const app = express();

// 1. Security Middleware
app.use(helmet()); // Sets HTTP headers for security

// 2. CORS Configuration (Crucial for GitHub Pages frontend)
const corsOptions = {
 origin: '*', // Change to your GitHub Pages URL in production (e.g., 'https://yourname.github.io')
 methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
 allowedHeaders: ['Content-Type', 'Authorization'],
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

// 6. Routes
app.use('/api/v1', router); // All API endpoints will start with /api/v1

// 7. Error Handling Middleware (Must be last)
app.use(notFound); // Handle 404s
app.use(errorHandler); // Global error handler

export default app;
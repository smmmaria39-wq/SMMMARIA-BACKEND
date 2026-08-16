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
import { identifyPanel } from './middleware/panelContext.js';
import router from './routes/index.js';

// Initialize Express App
const app = express();

// 0. Trust Proxy (Required for Railway to prevent rate-limiter crashes)
app.set('trust proxy', 1);

// 1. Security Middleware
app.use(helmet());

// 2. CORS Configuration
const corsOptions = {
 origin: [
  'https://smmaria.netlify.app', // Your main user frontend
  'https://ttmaria.netlify.app', // Your test user frontend
  'https://adminmm1.netlify.app' // Your admin frontend
 ],
 methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
 allowedHeaders: ['Content-Type', 'Authorization', 'X-Panel-Domain'],
 credentials: true
};
app.use(cors(corsOptions));

// 3. Logging (HTTP requests)
if (env.nodeEnv !== 'test') {
 app.use(morgan(env.isProduction ? 'combined' : 'dev'));
}

// 4. Body Parser Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 5. Rate Limiting
app.use('/api/', apiLimiter);

// 6. Multi-Tenancy Middleware (MUST BE BEFORE ROUTES)
app.use(identifyPanel);

// 7. Routes
app.use('/api/v1', router);

// 8. Error Handling Middleware (Must be last)
app.use(notFound);
app.use(errorHandler);

export default app;

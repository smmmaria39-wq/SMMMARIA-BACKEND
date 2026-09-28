import express from 'express';
import { providerApiController } from '../controllers/api.v2.controller.js';

const router = express.Router();

// POST /api/v2 - Single endpoint for all provider API actions
router.post('/', providerApiController);

export default router;

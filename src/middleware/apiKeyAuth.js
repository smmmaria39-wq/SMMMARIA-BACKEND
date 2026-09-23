import { getRef } from '../database/firebase.js';
import { errorResponse } from '../utils/response.js';

export const apiKeyAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return errorResponse(res, 'Missing or invalid Authorization header. Expected: Bearer YOUR_API_KEY', 401);
    }
    
    const apiKey = authHeader.split(' ')[1];
    if (!apiKey || !apiKey.startsWith('sk_')) {
      return errorResponse(res, 'Invalid API key format.', 401);
    }

    // 1. Fast reverse-lookup using the apiKeys index
    const keyIndexSnap = await getRef(`apiKeys/${apiKey}`).get();
    if (!keyIndexSnap.exists()) {
      return errorResponse(res, 'Invalid API key', 401);
    }

    const userId = keyIndexSnap.val();
    const userSnap = await getRef(`users/${userId}`).get();
    
    if (!userSnap.exists()) {
      return errorResponse(res, 'Invalid API key', 401);
    }

    const user = userSnap.val();
    
    // 2. Verify account status
    if (user.status && user.status !== 'active') {
      return errorResponse(res, 'Account is suspended or inactive', 403);
    }

    // 3. Attach to request
    req.apiUser = user;
    req.apiUserId = userId;
    
    next();
  } catch (error) {
    console.error('[ApiKeyAuth] Error:', error.message);
    return errorResponse(res, 'Authentication failed', 401);
  }
};

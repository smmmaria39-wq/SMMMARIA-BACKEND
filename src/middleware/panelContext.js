// ===============================================
// Panel Context Middleware (Multi-Tenancy)
// ===============================================

import { getRef } from '../database/firebase.js';

export const identifyPanel = async (req, res, next) => {
  try {
    const panelDomain = req.headers['x-panel-domain'];

    // If no domain header is present, it's a main panel request
    if (!panelDomain) {
      req.panelContext = null;
      return next();
    }

    // Check if it's the main domain (e.g., smmmaria.netlify.app)
    const mainDomain = process.env.MAIN_DOMAIN || 'smmmaria.netlify.app';
    if (panelDomain === mainDomain || panelDomain === 'localhost' || panelDomain === '127.0.0.1') {
      req.panelContext = null;
      return next();
    }

    // 1. Try finding by subdomain (e.g., john.smmmaria.com)
    let snapshot = await getRef('childPanels').orderByChild('info/subdomain').equalTo(panelDomain.split('.')[0]).get();
    
    // 2. Try finding by custom domain (e.g., agency.com)
    if (!snapshot.exists()) {
      snapshot = await getRef('childPanels').orderByChild('info/customDomain').equalTo(panelDomain).get();
    }

    if (snapshot.exists()) {
      // Panel found! Attach to request
      const panelData = Object.values(snapshot.val())[0];
      if (panelData.info.status === 'suspended') {
        return res.status(403).json({ success: false, message: 'This panel has been suspended.' });
      }
      req.panelContext = panelData;
    } else {
      req.panelContext = null; // Unknown domain, treat as main or invalid
    }

    next();
  } catch (error) {
    console.error('Panel Context Error:', error);
    next(); // Fail open to avoid blocking main panel, but log error
  }
};

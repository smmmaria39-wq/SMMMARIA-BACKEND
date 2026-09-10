// ===============================================
// Panel Context Middleware (Multi-Tenancy)
// ===============================================

import { getRef } from '../database/firebase.js';

export const identifyPanel = async (req, res, next) => {
  try {
    let panelDomain = req.headers['x-panel-domain'];

    // If no domain header is present, it's a main panel request
    if (!panelDomain) {
      req.panelContext = null;
      return next();
    }

    // Normalize domain: lowercase, remove www., and remove ports
    const cleanDomain = panelDomain.toLowerCase().replace(/^www\./, '').split(':')[0];
    const mainDomain = (process.env.MAIN_DOMAIN || 'smmaria.site').toLowerCase().replace(/^www\./, '').split(':')[0];

    // If it's the main domain or localhost, treat as main panel
    if (cleanDomain === mainDomain || cleanDomain === 'localhost' || cleanDomain === '127.0.0.1') {
      req.panelContext = null;
      return next();
    }

    let snapshot = null;
    let panelData = null;

    // 1. Try finding by Custom Domain (Exact Match)
    snapshot = await getRef('childPanels').orderByChild('info/customDomain').equalTo(cleanDomain).get();
    if (snapshot.exists()) {
      panelData = Object.values(snapshot.val())[0];
    } else {
      // 2. Try finding by Subdomain (Exact Match)
      // (Catches cases where the user saved 'mark.smmaria.site' as the subdomain)
      snapshot = await getRef('childPanels').orderByChild('info/subdomain').equalTo(cleanDomain).get();
      
      if (!snapshot.exists()) {
        // 3. Extract the prefix and try again
        // (Catches cases where the user saved 'mark' as the subdomain, but visited 'mark.smmaria.site')
        const subdomainPrefix = cleanDomain.split('.')[0]; 
        
        // Ensure we don't accidentally query an empty string
        if (subdomainPrefix && subdomainPrefix !== mainDomain) {
            snapshot = await getRef('childPanels').orderByChild('info/subdomain').equalTo(subdomainPrefix).get();
        }
      }

      if (snapshot.exists()) {
        panelData = Object.values(snapshot.val())[0];
      }
    }

    if (panelData) {
      if (panelData.info.status === 'suspended') {
        return res.status(403).json({ success: false, message: 'This panel has been suspended.' });
      }
      req.panelContext = panelData;
    } else {
      // Unknown domain, treat as main or invalid
      req.panelContext = null;
    }

    next();
  } catch (error) {
    console.error('Panel Context Error:', error);
    next(); // Fail open to avoid blocking main panel, but log error
  }
};

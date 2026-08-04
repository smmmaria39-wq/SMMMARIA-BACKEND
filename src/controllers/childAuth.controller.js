// ===============================================
// Child Auth Controller
// ===============================================

import { getRef } from '../database/firebase.js';
import { hashPassword, comparePassword } from '../utils/bcrypt.js';
import { generateToken } from '../utils/jwt.js';
import { generateUUID } from '../utils/helpers.js';
import { successResponse, errorResponse } from '../utils/response.js';

/**
 * @desc    Register a user on a Child Panel
 * @route   POST /api/v1/child-panel/auth/register
 * @access  Public (Requires Panel Context)
 */
export const childRegister = async (req, res, next) => {
 try {
  const panel = req.panelContext;
  if (!panel) return errorResponse(res, 'Panel context not found', 404);
  
  const { username, email, password } = req.body;
  const panelId = panel.info.panelId;
  const plan = panel.info.plan || 'Starter'; // Fallback just in case
  
  // 1. Check User Limit based on the Plan
  const usersSnap = await getRef(`childPanels/${panelId}/users`).get();
  const currentUsers = usersSnap.exists() ? Object.keys(usersSnap.val()).length : 0;
  
  let userLimit = 0;
  if (plan === 'Discount') userLimit = 50;
  else if (plan === 'Starter') userLimit = 100;
  else if (plan === 'Professional') userLimit = 1000;
  else if (plan === 'Lifetime') userLimit = 999999; // Effectively unlimited
  
  if (currentUsers >= userLimit) {
   return errorResponse(res, `User limit reached for the ${plan} plan. Please ask the panel owner to upgrade.`, 403);
  }
  
  // 2. Check if email exists in this specific panel
  if (usersSnap.exists()) {
   const usersArr = Object.values(usersSnap.val());
   if (usersArr.some(u => u.email === email)) return errorResponse(res, 'Email already registered on this panel', 400);
  }
  
  // 3. Create the user
  const userId = generateUUID();
  const hashedPassword = await hashPassword(password);
  
  const userData = {
   id: userId,
   username,
   email,
   password: hashedPassword,
   balance: 0,
   spent: 0,
   status: 'active',
   createdAt: new Date().toISOString()
  };
  
  await getRef(`childPanels/${panelId}/users/${userId}`).set(userData);
  delete userData.password;
  
  // Generate token containing panelId (Auto-login on register)
  const token = generateToken({ id: userId, role: 'child_user', panelId });
  
  return successResponse(res, 'Registration successful', { token, user: userData }, 201);
 } catch (error) {
  next(error);
 }
};

/**
 * @desc    Login a user on a Child Panel (Allows Owner or Child User)
 * @route   POST /api/v1/child-panel/auth/login
 * @access  Public (Requires Panel Context)
 */
export const childLogin = async (req, res, next) => {
 try {
  let panel = req.panelContext;
  const { email, password } = req.body; // 'email' acts as identifier (username, email, or accountId)

  // 1. Check if logging in via Main SMMMARIA Account ID (Passwordless)
  // Account IDs are numeric (e.g., 6-digit numbers)
  if (email && !isNaN(email)) {
    const ownerSnap = await getRef('users').orderByChild('accountId').equalTo(email).get();
    if (ownerSnap.exists()) {
      const owner = Object.values(ownerSnap.val())[0];
      // Verify this user owns a panel
      if (owner.role === 'reseller' && owner.childPanelId) {
        const token = generateToken({
          id: owner.id,
          role: 'reseller',
          childPanelId: owner.childPanelId
        });

        return successResponse(res, 'Login successful', {
          token,
          user: {
            id: owner.id,
            username: owner.username,
            role: 'reseller',
            balance: 0 // Fetched dynamically on dashboard
          }
        });
      }
    }
  }

  // 2. If panel context is missing (e.g. testing on main domain), try to find panel by admin username
  if (!panel) {
   const panelSnap = await getRef('childPanels').orderByChild('info/admin/username').equalTo(email).get();
   if (panelSnap.exists()) {
    panel = Object.values(panelSnap.val())[0];
   }
  }
  
  // 3. Check if logging in as the RESELLER OWNER (Using Panel Admin Username)
  if (panel && panel.info && panel.info.admin) {
   // Check if identifier matches admin username
   if (panel.info.admin.username === email) {
    const isMatch = await comparePassword(password, panel.info.admin.password);
    if (!isMatch) return errorResponse(res, 'Invalid credentials', 401);
    
    // Generate token. We use ownerId so the backend knows whose main wallet to deduct
    const token = generateToken({
     id: panel.info.ownerId,
     role: 'reseller',
     childPanelId: panel.info.panelId
    });
    
    return successResponse(res, 'Login successful', {
     token,
     user: {
      id: panel.info.ownerId,
      username: panel.info.admin.username,
      role: 'reseller',
      balance: 0 // Balance is fetched dynamically on the dashboard via getMe
     }
    });
   }
  }
  
  // 4. If not the owner, check if they are a CHILD USER on this panel
  if (!panel) return errorResponse(res, 'Panel context not found. Please access via your subdomain.', 404);
  
  const panelId = panel.info.panelId;
  const usersSnap = await getRef(`childPanels/${panelId}/users`).get();
  if (!usersSnap.exists()) return errorResponse(res, 'Invalid credentials', 401);
  
  const usersArr = Object.values(usersSnap.val());
  // Child users can login with email or username
  const user = usersArr.find(u => u.email === email || u.username === email);
  
  if (!user) return errorResponse(res, 'Invalid credentials', 401);
  if (user.status !== 'active') return errorResponse(res, 'Account suspended', 403);
  
  const isMatch = await comparePassword(password, user.password);
  if (!isMatch) return errorResponse(res, 'Invalid credentials', 401);
  
  delete user.password;
  // Generate token with child_user role and panelId
  const token = generateToken({ id: user.id, role: 'child_user', panelId });
  
  return successResponse(res, 'Login successful', { token, user });
 } catch (error) {
  next(error);
 }
};

/**
 * @desc    Get current logged in user (Reseller or Child User)
 * @route   GET /api/v1/child-panel/auth/me
 * @access  Private
 */
export const getMe = async (req, res, next) => {
 try {
  const userId = req.user.id;
  const role = req.user.role;
  
  if (role === 'reseller') {
   const childPanelId = req.user.childPanelId;
   
   // Fetch main user wallet balance
   const userSnap = await getRef(`users/${userId}`).get();
   if (!userSnap.exists()) return errorResponse(res, 'User not found', 404);
   const user = userSnap.val();
   
   // Fetch panel admin username
   const panelInfoSnap = await getRef(`childPanels/${childPanelId}/info`).get();
   const panelInfo = panelInfoSnap.exists() ? panelInfoSnap.val() : {};
   
   return successResponse(res, 'User fetched', {
    id: userId,
    username: panelInfo.admin?.username || user.username,
    email: user.email,
    role: 'reseller',
    balance: user.balance || 0, // Fetch main wallet balance
    childPanelId: childPanelId
   });
  } else if (role === 'child_user') {
   // Fetch from child panel users node
   const panelId = req.user.panelId;
   const userSnap = await getRef(`childPanels/${panelId}/users/${userId}`).get();
   if (!userSnap.exists()) return errorResponse(res, 'User not found', 404);
   const user = userSnap.val();
   delete user.password;
   return successResponse(res, 'User fetched', user);
  } else {
   return errorResponse(res, 'Not authorized', 403);
  }
 } catch (error) {
  next(error);
 }
};

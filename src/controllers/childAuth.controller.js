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

    // Check if email exists in this specific panel
    const usersSnap = await getRef(`childPanels/${panelId}/users`).get();
    if (usersSnap.exists()) {
      const usersArr = Object.values(usersSnap.val());
      if (usersArr.some(u => u.email === email)) return errorResponse(res, 'Email already registered on this panel', 400);
    }

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
    const panel = req.panelContext;
    if (!panel) return errorResponse(res, 'Panel context not found', 404);

    const { email, password } = req.body;
    const panelId = panel.info.panelId;

    // 1. First, check if the person logging in is the RESELLER OWNER
    const ownerSnap = await getRef('users').orderByChild('email').equalTo(email).get();
    
    if (ownerSnap.exists()) {
      const owner = Object.values(ownerSnap.val())[0];
      
      // If this user owns THIS specific panel
      if (owner.role === 'reseller' && owner.childPanelId === panelId) {
        const isMatch = await comparePassword(password, owner.password);
        if (!isMatch) return errorResponse(res, 'Invalid credentials', 401);
        
        delete owner.password;
        // Generate token with childPanelId so the backend knows which panel they own
        const token = generateToken({ id: owner.id, role: 'reseller', childPanelId: panelId });
        return successResponse(res, 'Login successful', { token, user: owner });
      }
    }

    // 2. If not the owner, check if they are a CHILD USER on this panel
    const usersSnap = await getRef(`childPanels/${panelId}/users`).get();
    if (!usersSnap.exists()) return errorResponse(res, 'Invalid credentials', 401);

    const usersArr = Object.values(usersSnap.val());
    const user = usersArr.find(u => u.email === email);

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

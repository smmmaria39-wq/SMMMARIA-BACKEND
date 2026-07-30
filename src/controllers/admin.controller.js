// ===============================================
// Admin Controller
// ===============================================

import { getRef } from '../database/firebase.js';
import { successResponse } from '../utils/response.js';

/**
 * @desc    Get Admin Dashboard Stats
 * @route   GET /api/v1/admin/dashboard
 * @access  Private/Admin
 */
export const getDashboardStats = async (req, res, next) => {
 try {
  // Added txSnap (transactions) to the Promise.all array
  const [usersSnap, ordersSnap, paymentsSnap, ticketsSnap, suppliersSnap, txSnap] = await Promise.all([
   getRef('users').get(),
   getRef('orders').get(),
   getRef('payments').get(),
   getRef('tickets').get(),
   getRef('suppliers').get(),
   getRef('transactions').get()
  ]);
  
  const users = usersSnap.exists() ? Object.values(usersSnap.val()) : [];
  const orders = ordersSnap.exists() ? Object.values(ordersSnap.val()) : [];
  const payments = paymentsSnap.exists() ? Object.values(paymentsSnap.val()) : [];
  const tickets = ticketsSnap.exists() ? Object.values(ticketsSnap.val()) : [];
  const suppliers = suppliersSnap.exists() ? Object.values(suppliersSnap.val()) : [];
  const transactions = txSnap.exists() ? Object.values(txSnap.val()) : [];
  
  // 1. Calculate Revenue from Approved Payments (case-insensitive)
  let totalRevenue = payments
   .filter(p => p.status?.toLowerCase() === 'approved')
   .reduce((sum, p) => sum + parseFloat(p.amount || 0), 0);
   
  // 2. If payments revenue is 0, calculate from transactions (deposits/credits)
  if (totalRevenue === 0 && transactions.length > 0) {
      totalRevenue = transactions
        .filter(t => t.type === 'deposit' || t.type === 'credit')
        .reduce((sum, t) => sum + parseFloat(t.amount || 0), 0);
  }
  
  const pendingOrders = orders.filter(o => o.status === 'pending' || o.status === 'processing').length;
  const openTickets = tickets.filter(t => t.status !== 'closed').length;
  const activeSuppliers = suppliers.filter(s => s.status === 'active').length;
  
  const stats = {
   totalUsers: users.length,
   totalOrders: orders.length,
   totalRevenue: parseFloat(totalRevenue.toFixed(2)),
   pendingOrders,
   openTickets,
   activeSuppliers,
   recentOrders: orders.slice(-5).reverse(), // Last 5 orders
   recentUsers: users.slice(-5).reverse() // Last 5 users
  };
  
  return successResponse(res, 'Admin dashboard stats fetched successfully', stats);
 } catch (error) {
  next(error);
 }
};

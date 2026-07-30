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
  // Added suppliersSnap to the Promise.all array
  const [usersSnap, ordersSnap, paymentsSnap, ticketsSnap, suppliersSnap] = await Promise.all([
   getRef('users').get(),
   getRef('orders').get(),
   getRef('payments').get(),
   getRef('tickets').get(),
   getRef('suppliers').get()
  ]);
  
  const users = usersSnap.exists() ? Object.values(usersSnap.val()) : [];
  const orders = ordersSnap.exists() ? Object.values(ordersSnap.val()) : [];
  const payments = paymentsSnap.exists() ? Object.values(paymentsSnap.val()) : [];
  const tickets = ticketsSnap.exists() ? Object.values(ticketsSnap.val()) : [];
  const suppliers = suppliersSnap.exists() ? Object.values(suppliersSnap.val()) : [];
  
  // Calculate Stats
  const totalRevenue = payments
   .filter(p => p.status === 'approved')
   .reduce((sum, p) => sum + parseFloat(p.amount || 0), 0);
  
  const pendingOrders = orders.filter(o => o.status === 'pending' || o.status === 'processing').length;
  const openTickets = tickets.filter(t => t.status !== 'closed').length;
  const activeSuppliers = suppliers.filter(s => s.status === 'active').length;
  
  const stats = {
   totalUsers: users.length,
   totalOrders: orders.length,
   totalRevenue: parseFloat(totalRevenue.toFixed(2)),
   pendingOrders,
   openTickets,
   activeSuppliers, // Added activeSuppliers to the stats object
   recentOrders: orders.slice(-5).reverse(), // Last 5 orders
   recentUsers: users.slice(-5).reverse() // Last 5 users
  };
  
  return successResponse(res, 'Admin dashboard stats fetched successfully', stats);
 } catch (error) {
  next(error);
 }
};

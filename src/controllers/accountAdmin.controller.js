// src/controllers/accountAdmin.controller.js
import { getRef } from '../database/firebase.js';

class AccountAdminController {
  // Fetch ALL accounts for the admin table (including sold/reserved)
  async getAllAccounts(req, res, next) {
    try {
      const snapshot = await getRef('accountInventory').get();
      let accounts = [];
      
      if (snapshot.exists()) {
        const allAccounts = snapshot.val();
        for (const [id, acc] of Object.entries(allAccounts)) {
          accounts.push({ id, ...acc });
        }
      }
      res.json({ success: true, data: accounts });
    } catch (error) {
      next(error);
    }
  }

  // Fetch inventory statistics for the admin dashboard cards
  async getStats(req, res, next) {
    try {
      const snapshot = await getRef('accountInventory').get();
      const stats = {
        total: 0,
        available: 0,
        reserved: 0,
        sold: 0,
        disabled: 0
      };
      
      if (snapshot.exists()) {
        const allAccounts = snapshot.val();
        for (const acc of Object.values(allAccounts)) {
          stats.total++;
          if (stats[acc.status] !== undefined) {
            stats[acc.status]++;
          }
        }
      }
      res.json({ success: true, data: stats });
    } catch (error) {
      next(error);
    }
  }

  // Create a new account
  async createAccount(req, res, next) {
    try {
      const accountData = req.body;
      const newRef = getRef('accountInventory').push();
      await newRef.set({
        ...accountData,
        status: 'available',
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
      res.status(201).json({ success: true, data: { id: newRef.key } });
    } catch (error) {
      next(error);
    }
  }

  // Update an existing account
  async updateAccount(req, res, next) {
    try {
      const { id } = req.params;
      await getRef(`accountInventory/${id}`).update({
        ...req.body,
        updatedAt: Date.now()
      });
      res.json({ success: true, message: 'Account updated' });
    } catch (error) {
      next(error);
    }
  }

  // Disable an account
  async disableAccount(req, res, next) {
    try {
      const { id } = req.params;
      await getRef(`accountInventory/${id}`).update({ 
        status: 'disabled',
        updatedAt: Date.now()
      });
      res.json({ success: true, message: 'Account disabled' });
    } catch (error) {
      next(error);
    }
  }

  // Delete an account
  async deleteAccount(req, res, next) {
    try {
      const { id } = req.params;
      const snapshot = await getRef(`accountInventory/${id}`).get();
      
      if (snapshot.exists() && snapshot.val().status === 'sold') {
        return res.status(400).json({ success: false, message: 'Cannot delete a sold account' });
      }
      
      await getRef(`accountInventory/${id}`).remove();
      res.json({ success: true, message: 'Account deleted' });
    } catch (error) {
      next(error);
    }
  }

  // Bulk import accounts via JSON
  async bulkImport(req, res, next) {
    try {
      const accounts = req.body.accounts;
      const updates = {};
      
      accounts.forEach(acc => {
        const newRef = getRef('accountInventory').push();
        updates[newRef.key] = {
          ...acc,
          status: 'available',
          createdAt: Date.now()
        };
      });
      
      await getRef('accountInventory').update(updates);
      res.status(201).json({ success: true, message: `${accounts.length} accounts imported` });
    } catch (error) {
      next(error);
    }
  }

  // Create a new category
  async createCategory(req, res, next) {
    try {
      const newRef = getRef('accountCategories').push();
      await newRef.set({
        ...req.body,
        active: true,
        createdAt: Date.now()
      });
      res.status(201).json({ success: true, data: { id: newRef.key } });
    } catch (error) {
      next(error);
    }
  }
}

export default new AccountAdminController();

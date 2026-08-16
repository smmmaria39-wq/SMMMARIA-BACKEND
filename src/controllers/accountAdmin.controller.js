const accountService = require('../services/account.service');
const admin = require('firebase-admin');
const db = admin.firestore();

class AccountAdminController {
  async createAccount(req, res, next) {
    try {
      const accountData = req.body;
      const docRef = await db.collection('accountInventory').add({
        ...accountData,
        status: 'available',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      res.status(201).json({ success: true, data: { id: docRef.id } });
    } catch (error) {
      next(error);
    }
  }

  async updateAccount(req, res, next) {
    try {
      const { id } = req.params;
      await db.collection('accountInventory').doc(id).update({
        ...req.body,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      res.json({ success: true, message: 'Account updated' });
    } catch (error) {
      next(error);
    }
  }

  async disableAccount(req, res, next) {
    try {
      const { id } = req.params;
      await db.collection('accountInventory').doc(id).update({
        status: 'disabled',
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      res.json({ success: true, message: 'Account disabled' });
    } catch (error) {
      next(error);
    }
  }

  async deleteAccount(req, res, next) {
    try {
      const { id } = req.params;
      const doc = await db.collection('accountInventory').doc(id).get();
      if (doc.exists && doc.data().status === 'sold') {
        return res.status(400).json({ success: false, message: 'Cannot delete a sold account' });
      }
      await db.collection('accountInventory').doc(id).delete();
      res.json({ success: true, message: 'Account deleted' });
    } catch (error) {
      next(error);
    }
  }

  async bulkImport(req, res, next) {
    try {
      const accounts = req.body.accounts;
      const batch = db.batch();
      accounts.forEach(acc => {
        const ref = db.collection('accountInventory').doc();
        batch.set(ref, {
          ...acc,
          status: 'available',
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
      });
      await batch.commit();
      res.status(201).json({ success: true, message: `${accounts.length} accounts imported` });
    } catch (error) {
      next(error);
    }
  }

  // Category Management
  async createCategory(req, res, next) {
    try {
      const docRef = await db.collection('accountCategories').add({
        ...req.body,
        active: true,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
      res.status(201).json({ success: true, data: { id: docRef.id } });
    } catch (error) {
      next(error);
    }
  }

  async getStats(req, res, next) {
    try {
      const snapshot = await db.collection('accountInventory').get();
      const stats = {
        total: snapshot.size,
        available: 0,
        reserved: 0,
        sold: 0,
        disabled: 0,
        platforms: {}
      };

      snapshot.forEach(doc => {
        const acc = doc.data();
        stats[acc.status] = (stats[acc.status] || 0) + 1;
        if (!stats.platforms[acc.platform]) stats.platforms[acc.platform] = { total: 0, available: 0 };
        stats.platforms[acc.platform].total++;
        if (acc.status === 'available') stats.platforms[acc.platform].available++;
      });

      res.json({ success: true, data: stats });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new AccountAdminController();

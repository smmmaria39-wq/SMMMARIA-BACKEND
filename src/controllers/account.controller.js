// src/controllers/account.controller.js
import accountService from '../services/account.service.js';

class AccountController {
  async getCategories(req, res, next) {
    try {
      const categories = await accountService.getCategories();
      res.json({ success: true, data: categories });
    } catch (error) {
      next(error);
    }
  }

  async getAccounts(req, res, next) {
    try {
      const accounts = await accountService.getAccounts(req.query);
      res.json({ success: true, data: accounts });
    } catch (error) {
      next(error);
    }
  }

  async getAccountDetails(req, res, next) {
    try {
      const account = await accountService.getAccountDetails(req.params.id);
      res.json({ success: true, data: account });
    } catch (error) {
      next(error);
    }
  }

  async purchaseAccount(req, res, next) {
    try {
      // FIX: Changed req.user.uid to req.user.id to match your auth middleware
      const result = await accountService.purchaseAccount(req.params.id, req.user.id);
      res.json({ success: true, message: 'Purchase successful', data: result });
    } catch (error) {
      next(error);
    }
  }

  async getMyPurchases(req, res, next) {
    try {
      // FIX: Changed req.user.uid to req.user.id
      const purchases = await accountService.getUserPurchases(req.user.id);
      res.json({ success: true, data: purchases });
    } catch (error) {
      next(error);
    }
  }

  async getMyPurchaseDetails(req, res, next) {
    try {
      // FIX: Changed req.user.uid to req.user.id
      const purchase = await accountService.getUserPurchaseDetails(req.params.id, req.user.id);
      res.json({ success: true, data: purchase });
    } catch (error) {
      next(error);
    }
  }
}

export default new AccountController();

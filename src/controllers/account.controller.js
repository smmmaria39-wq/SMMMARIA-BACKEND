const accountService = require('../services/account.service');

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
      // ONLY pass accountId and authenticated userId. Ignore any client-sent price.
      const result = await accountService.purchaseAccount(req.params.id, req.user.uid);
      res.json({ success: true, message: 'Purchase successful', data: result });
    } catch (error) {
      next(error);
    }
  }

  async getMyPurchases(req, res, next) {
    try {
      const purchases = await accountService.getUserPurchases(req.user.uid);
      res.json({ success: true, data: purchases });
    } catch (error) {
      next(error);
    }
  }

  async getMyPurchaseDetails(req, res, next) {
    try {
      // Returns credentials safely because service checks userId ownership
      const purchase = await accountService.getUserPurchaseDetails(req.params.id, req.user.uid);
      res.json({ success: true, data: purchase });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new AccountController();

import { getRef } from '../database/firebase.js';

// IMPORTANT: Assume notificationService is imported from existing system
// import notificationService from './notification.service.js';

// Helper to remove sensitive credentials from public responses
const sanitizeAccount = (account) => {
  if (!account) return null;
  const { email, emailPassword, accountPassword, recoveryEmail, recoveryEmailPassword, twoFactorSecret, ...safeData } = account;
  return safeData;
};

class AccountService {
  async getCategories() {
    const snapshot = await getRef('accountCategories').get();
    let categories = [];
    
    if (snapshot.exists()) {
      const allCategories = snapshot.val();
      
      // Fetch inventory to calculate live stock
      const invSnapshot = await getRef('accountInventory').get();
      const allInventory = invSnapshot.exists() ? invSnapshot.val() : {};

      for (const [catId, catData] of Object.entries(allCategories)) {
        if (!catData.active) continue;

        let availableCount = 0;
        for (const acc of Object.values(allInventory)) {
          if (acc.categoryId === catId && acc.status === 'available') {
            availableCount++;
          }
        }

        let stockStatus = 'OUT OF STOCK';
        const threshold = catData.lowStockThreshold || 10;
        if (availableCount > 0 && availableCount <= threshold) stockStatus = 'LOW STOCK';
        else if (availableCount > threshold) stockStatus = 'IN STOCK';

        categories.push({
          ...catData,
          categoryId: catId,
          availableCount,
          stockStatus
        });
      }
    }
    return categories;
  }

  async getAccounts(filters) {
    const snapshot = await getRef('accountInventory').get();
    let accounts = [];
    
    if (snapshot.exists()) {
      const allAccounts = snapshot.val();
      for (const [id, acc] of Object.entries(allAccounts)) {
        if (acc.status !== 'available') continue;
        if (filters.platform && acc.platform !== filters.platform) continue;
        if (filters.categoryId && acc.categoryId !== filters.categoryId) continue;
        
        accounts.push(sanitizeAccount({ id, ...acc }));
      }
    }
    return accounts;
  }

  async getAccountDetails(accountId) {
    const snapshot = await getRef(`accountInventory/${accountId}`).get();
    if (!snapshot.exists()) throw new Error('Account not found');
    return sanitizeAccount({ id: accountId, ...snapshot.val() });
  }

  async purchaseAccount(accountId, userId) {
    const accountRef = getRef(`accountInventory/${accountId}`);
    const userRef = getRef(`users/${userId}`);
    
    // Phase 1: Atomically reserve the account
    const reserveResult = await accountRef.transaction((currentAccount) => {
      // If account doesn't exist or isn't available, abort transaction
      if (currentAccount === null) return; // Abort
      if (currentAccount.status !== 'available') return; // Abort
      
      // Reserve it
      currentAccount.status = 'reserved';
      currentAccount.reservedAt = Date.now();
      currentAccount.reservedBy = userId;
      return currentAccount; // Commit reservation
    });

    // If reservation failed because it wasn't available
    if (!reserveResult.committed) {
      throw new Error('Account is no longer available.');
    }

    const accountData = reserveResult.snapshot.val();
    const actualPrice = accountData.price;

    try {
      // Phase 2: Atomically verify and debit wallet
      const walletResult = await userRef.transaction((currentUser) => {
        if (currentUser === null) return; // Abort
        const currentBalance = parseFloat(currentUser.balance) || 0;
        
        if (currentBalance < actualPrice) {
          return; // Abort - insufficient funds
        }
        
        currentUser.balance = currentBalance - actualPrice;
        return currentUser; // Commit wallet deduction
      });

      if (!walletResult.committed) {
        throw new Error('Insufficient wallet balance.');
      }

      const newBalance = walletResult.snapshot.val().balance;

      // Phase 3: Finalize Sale (Multi-path atomic update)
      const txId = getRef('transactions').push().key;
      const purchaseId = getRef('accountPurchases').push().key;
      const invoiceId = getRef('invoices').push().key;
      const accTxId = getRef('accountTransactions').push().key;

      const updates = {};
      
      // 1. Update Account Inventory
      updates[`accountInventory/${accountId}/status`] = 'sold';
      updates[`accountInventory/${accountId}/soldAt`] = Date.now();
      updates[`accountInventory/${accountId}/soldTo`] = userId;
      updates[`accountInventory/${accountId}/purchaseId`] = purchaseId;

      // 2. Create Wallet Transaction (Matching your wallet controller pattern)
      updates[`transactions/${txId}`] = {
        userId: userId,
        type: 'debit',
        amount: actualPrice,
        note: `Purchase of ${accountData.platform} account (${accountData.username})`,
        balanceAfter: newBalance,
        createdAt: Date.now()
      };

      // 3. Create Purchase Record
      updates[`accountPurchases/${purchaseId}`] = {
        purchaseId,
        userId,
        accountId,
        categoryId: accountData.categoryId,
        platform: accountData.platform,
        username: accountData.username,
        amount: actualPrice,
        currency: accountData.currency || 'USD',
        walletTransactionId: txId,
        invoiceId: invoiceId,
        status: 'completed',
        purchasedAt: Date.now()
      };

      // 4. Create Invoice Record
      updates[`invoices/${invoiceId}`] = {
        invoiceId,
        userId,
        purchaseId,
        accountId,
        platform: accountData.platform,
        username: accountData.username,
        accountType: accountData.accountType,
        price: actualPrice,
        currency: accountData.currency || 'USD',
        status: 'paid',
        createdAt: Date.now()
      };

      // 5. Create Account Audit Transaction
      updates[`accountTransactions/${accTxId}`] = {
        transactionId: accTxId,
        purchaseId,
        userId,
        accountId,
        type: 'account_purchase',
        amount: actualPrice,
        currency: accountData.currency || 'USD',
        status: 'completed',
        createdAt: Date.now()
      };

      // Execute all updates atomically
      await getRef('/').update(updates);

      // Phase 4: Notification (Integrate your service here)
      // await notificationService.sendNotification(userId, 'Account Purchase Successful', `Your ${accountData.platform} account has been purchased successfully.`);

      return { purchaseId, invoiceId };

    } catch (error) {
      // If wallet fails or final update fails, revert the reservation
      await accountRef.update({ 
        status: 'available', 
        reservedAt: null, 
        reservedBy: null 
      });
      throw error; // Re-throw the error to be caught by controller
    }
  }

  async getUserPurchases(userId) {
    const snapshot = await getRef('accountPurchases').get();
    let purchases = [];
    
    if (snapshot.exists()) {
      const allPurchases = snapshot.val();
      // Filter in JS (Bypasses Firebase Index requirement)
      purchases = Object.keys(allPurchases)
        .filter(key => allPurchases[key].userId === userId)
        .map(key => ({ id: key, ...allPurchases[key] }))
        .reverse(); // Newest first
    }
    return purchases;
  }

  async getUserPurchaseDetails(purchaseId, userId) {
    const snapshot = await getRef(`accountPurchases/${purchaseId}`).get();
    if (!snapshot.exists()) throw new Error('Purchase not found');
    
    const purchaseData = snapshot.val();
    
    // Security: Verify ownership
    if (purchaseData.userId !== userId) {
      throw new Error('Unauthorized: You do not own this purchase.');
    }

    // Fetch the full account details to return credentials
    const accountDoc = await getRef(`accountInventory/${purchaseData.accountId}`).get();
    if (accountDoc.exists()) {
      purchaseData.accountDetails = accountDoc.val();
    }
    return purchaseData;
  }
}

export default new AccountService();

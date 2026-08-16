// src/services/account.service.js
import { getRef } from '../database/firebase.js';

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
    // 1. Validate inputs before doing anything
    if (!accountId || accountId === 'undefined') {
      throw new Error('Invalid Account ID.');
    }
    if (!userId) {
      throw new Error('Authentication error: User ID missing.');
    }

    const accountRef = getRef(`accountInventory/${accountId}`);
    const userRef = getRef(`users/${userId}`);
    
    console.log(`[Purchase Debug] Starting reservation for account: ${accountId}, user: ${userId}`);

    // Phase 1: Atomically reserve the account
    const reserveResult = await accountRef.transaction((currentAccount) => {
      // CRITICAL FIX: If null, return null to let Firebase fetch the server value.
      // Returning undefined aborts the transaction immediately!
      if (currentAccount === null) {
        return currentAccount; 
      }
      
      // Now we have the actual server data
      if (currentAccount.status !== 'available') {
        console.log(`[Purchase Debug] Transaction aborted: Status is ${currentAccount.status}`);
        return; // Abort
      }
      
      // Reserve it
      const updatedAccount = { ...currentAccount };
      updatedAccount.status = 'reserved';
      updatedAccount.reservedAt = Date.now();
      updatedAccount.reservedBy = userId;
      
      return updatedAccount; 
    });

    // If reservation failed because it wasn't available or doesn't exist
    if (!reserveResult.committed) {
      console.error(`[Purchase Error] Failed to reserve account ${accountId}. It may be sold or reserved.`);
      throw new Error('Account is no longer available.');
    }

    const accountData = reserveResult.snapshot.val();
    
    // =========================================================
    // ENFORCE DYNAMIC PRICING: $10 per 1,000 followers
    // =========================================================
    const followersCount = parseInt(accountData.followers) || 0;
    const actualPrice = (followersCount / 1000) * 10;

    try {
      // Phase 2: Atomically verify and debit wallet
      const walletResult = await userRef.transaction((currentUser) => {
        // CRITICAL FIX: Same pattern. Return null to fetch server value.
        if (currentUser === null) {
          return currentUser; 
        }
        
        const currentBalance = parseFloat(currentUser.balance) || 0;
        
        if (currentBalance < actualPrice) {
          console.log(`[Purchase Debug] Wallet transaction aborted: Insufficient funds (${currentBalance} < ${actualPrice})`);
          return; // Abort
        }
        
        currentUser.balance = currentBalance - actualPrice;
        return currentUser; 
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
      
      updates[`accountInventory/${accountId}/status`] = 'sold';
      updates[`accountInventory/${accountId}/price`] = actualPrice; 
      updates[`accountInventory/${accountId}/soldAt`] = Date.now();
      updates[`accountInventory/${accountId}/soldTo`] = userId;
      updates[`accountInventory/${accountId}/purchaseId`] = purchaseId;

      updates[`transactions/${txId}`] = {
        userId: userId,
        type: 'debit',
        amount: actualPrice,
        note: `Purchase of ${accountData.platform} account (${accountData.username})`,
        balanceAfter: newBalance,
        createdAt: Date.now()
      };

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

      await getRef('/').update(updates);

      return { purchaseId, invoiceId };

    } catch (error) {
      // Revert reservation if wallet fails or update fails
      console.error(`[Purchase Error] Reverting reservation for account ${accountId}:`, error.message);
      await accountRef.update({ 
        status: 'available', 
        reservedAt: null, 
        reservedBy: null 
      });
      throw error; 
    }
  }

  async getUserPurchases(userId) {
    const snapshot = await getRef('accountPurchases').get();
    let purchases = [];
    
    if (snapshot.exists()) {
      const allPurchases = snapshot.val();
      purchases = Object.keys(allPurchases)
        .filter(key => allPurchases[key].userId === userId)
        .map(key => ({ id: key, ...allPurchases[key] }))
        .reverse();
    }
    return purchases;
  }

  async getUserPurchaseDetails(purchaseId, userId) {
    const snapshot = await getRef(`accountPurchases/${purchaseId}`).get();
    if (!snapshot.exists()) throw new Error('Purchase not found');
    
    const purchaseData = snapshot.val();
    
    if (purchaseData.userId !== userId) {
      throw new Error('Unauthorized: You do not own this purchase.');
    }

    const accountDoc = await getRef(`accountInventory/${purchaseData.accountId}`).get();
    if (accountDoc.exists()) {
      purchaseData.accountDetails = accountDoc.val();
    }
    return purchaseData;
  }
}

export default new AccountService();

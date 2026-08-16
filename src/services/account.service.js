const admin = require('firebase-admin');
const db = admin.firestore();

// IMPORTANT: Assume walletService and notificationService are imported from existing system
// const walletService = require('./wallet.service'); 
// const notificationService = require('./notification.service');

const sanitizeAccount = (account) => {
  if (!account) return null;
  const { email, emailPassword, accountPassword, recoveryEmail, recoveryEmailPassword, twoFactorSecret, ...safeData } = account;
  return safeData;
};

class AccountService {
  async getCategories() {
    const snapshot = await db.collection('accountCategories').where('active', '==', true).get();
    let categories = [];
    for (const doc of snapshot.docs) {
      const catData = doc.data();
      // Calculate live stock
      const invSnapshot = await db.collection('accountInventory')
        .where('categoryId', '==', doc.id)
        .where('status', '==', 'available')
        .get();
      
      const availableCount = invSnapshot.size;
      let stockStatus = 'OUT OF STOCK';
      if (availableCount > 0 && availableCount <= (catData.lowStockThreshold || 10)) stockStatus = 'LOW STOCK';
      else if (availableCount > (catData.lowStockThreshold || 10)) stockStatus = 'IN STOCK';

      categories.push({
        ...catData,
        categoryId: doc.id,
        availableCount,
        stockStatus
      });
    }
    return categories;
  }

  async getAccounts(filters) {
    let query = db.collection('accountInventory').where('status', '==', 'available');
    
    if (filters.platform) query = query.where('platform', '==', filters.platform);
    if (filters.categoryId) query = query.where('categoryId', '==', filters.categoryId);
    
    const snapshot = await query.get();
    let accounts = [];
    snapshot.forEach(doc => {
      accounts.push(sanitizeAccount({ id: doc.id, ...doc.data() }));
    });
    return accounts;
  }

  async getAccountDetails(accountId) {
    const docRef = db.collection('accountInventory').doc(accountId);
    const doc = await docRef.get();
    if (!doc.exists) throw new Error('Account not found');
    return sanitizeAccount({ id: doc.id, ...doc.data() });
  }

  async purchaseAccount(accountId, userId) {
    const accountRef = db.collection('accountInventory').doc(accountId);
    
    // Phase 1: Reserve the atomically
    await db.runTransaction(async (transaction) => {
      const accountDoc = await transaction.get(accountRef);
      if (!accountDoc.exists) throw new Error('Account does not exist');
      
      const accountData = accountDoc.data();
      if (accountData.status !== 'available') {
        throw new Error('Account is no longer available.');
      }

      transaction.update(accountRef, {
        status: 'reserved',
        reservedAt: admin.firestore.FieldValue.serverTimestamp(),
        reservedBy: userId
      });
    });

    // Phase 2: Process Wallet (Using mock logic to integrate with existing wallet)
    // NOTE: Replace this block with your actual wallet service call
    // await walletService.debitWallet(userId, actualPrice, `Purchase of ${accountData.platform} account`);
    let accountData;
    try {
      const accountDoc = await accountRef.get();
      accountData = accountDoc.data();
      const actualPrice = accountData.price;

      // MOCK WALLET DEBIT - Integrate your existing wallet here
      // If it fails, we revert the reservation
      // try { await walletService.debit(...) } catch(e) { throw e }
      
      // Phase 3: Finalize Sale
      await db.runTransaction(async (transaction) => {
        const freshDoc = await transaction.get(accountRef);
        if (freshDoc.data().status !== 'reserved' || freshDoc.data().reservedBy !== userId) {
          throw new Error('Reservation lost or overridden.');
        }

        const purchaseRef = db.collection('accountPurchases').doc();
        const transactionRef = db.collection('accountTransactions').doc();
        const invoiceRef = db.collection('invoices').doc();

        const purchaseData = {
          purchaseId: purchaseRef.id,
          userId,
          accountId,
          categoryId: accountData.categoryId,
          platform: accountData.platform,
          username: accountData.username,
          amount: actualPrice,
          currency: accountData.currency || 'USD',
          walletTransactionId: transactionRef.id, // Link to wallet transaction
          invoiceId: invoiceRef.id,
          status: 'completed',
          purchasedAt: admin.firestore.FieldValue.serverTimestamp()
        };

        transaction.set(purchaseRef, purchaseData);
        transaction.update(accountRef, {
          status: 'sold',
          soldAt: admin.firestore.FieldValue.serverTimestamp(),
          soldTo: userId,
          purchaseId: purchaseRef.id
        });

        // Create invoice record
        transaction.set(invoiceRef, {
          invoiceId: invoiceRef.id,
          userId,
          purchaseId: purchaseRef.id,
          accountId,
          platform: accountData.platform,
          username: accountData.username,
          accountType: accountData.accountType,
          price: actualPrice,
          currency: accountData.currency || 'USD',
          status: 'paid',
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // Create audit transaction record
        transaction.set(transactionRef, {
          transactionId: transactionRef.id,
          purchaseId: purchaseRef.id,
          userId,
          accountId,
          type: 'account_purchase',
          amount: actualPrice,
          currency: accountData.currency || 'USD',
          status: 'completed',
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
      });

      // Phase 4: Notification
      // await notificationService.sendNotification(userId, 'Account Purchase Successful', `Your ${accountData.platform} account has been purchased successfully.`);

      return { purchaseId: purchaseRef.id, invoiceId: invoiceRef.id };
    } catch (error) {
      // Revert reservation if wallet fails
      await accountRef.update({ status: 'available', reservedAt: admin.firestore.FieldValue.delete(), reservedBy: admin.firestore.FieldValue.delete() });
      throw error;
    }
  }

  async getUserPurchases(userId) {
    const snapshot = await db.collection('accountPurchases').where('userId', '==', userId).get();
    let purchases = [];
    snapshot.forEach(doc => purchases.push({ id: doc.id, ...doc.data() }));
    return purchases;
  }

  async getUserPurchaseDetails(purchaseId, userId) {
    const doc = await db.collection('accountPurchases').doc(purchaseId).get();
    if (!doc.exists) throw new Error('Purchase not found');
    const purchaseData = doc.data();
    
    if (purchaseData.userId !== userId) throw new Error('Unauthorized: You do not own this purchase.');

    // Fetch the actual account to return credentials
    const accountDoc = await db.collection('accountInventory').doc(purchaseData.accountId).get();
    if (accountDoc.exists) {
      purchaseData.accountDetails = accountDoc.data();
    }
    return purchaseData;
  }
}

module.exports = new AccountService();

import { getRef } from '../database/firebase.js';

const CHAT_EDIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

// Helper to get user data
async function getUserData(userId) {
  const snap = await getRef(`users/${userId}`).get();
  return snap.exists() ? snap.val() : null;
}

// --- PRIVATE CHAT ---

export async function getPrivateMessages(userId) {
  const snap = await getRef(`privateChats/${userId}/messages`).get();
  if (!snap.exists()) return [];
  
  const messages = [];
  snap.forEach(child => {
    messages.push({ id: child.key, ...child.val() });
  });
  return messages;
}

export async function sendPrivateMessage(userId, payload, isAdmin = false) {
  const userData = await getUserData(userId);
  const username = isAdmin ? 'Support' : (userData?.username || 'User');
  
  const msgRef = getRef(`privateChats/${userId}/messages`).push();
  const messageData = {
    id: msgRef.key,
    senderId: userId, // For admin messages, this is the admin's ID
    senderRole: isAdmin ? 'admin' : 'user',
    username: username,
    message: payload.message || '',
    timestamp: Date.now(),
    edited: false,
    deleted: false,
    replyToId: payload.replyToId || null,
    media: payload.media || null,
    read: isAdmin ? false : true // If admin sends, it's unread by user. If user sends, it's "read" by them.
  };
  
  await msgRef.set(messageData);
  return messageData;
}

export async function markPrivateMessagesRead(userId, isAdmin) {
  // If user reads, mark admin messages as read. If admin reads, mark user messages as read.
  const targetRole = isAdmin ? 'user' : 'admin';
  const snap = await getRef(`privateChats/${userId}/messages`).get();
  
  if (!snap.exists()) return;
  
  const updates = {};
  snap.forEach(child => {
    const msg = child.val();
    if (msg.senderRole === targetRole && !msg.read) {
      updates[`privateChats/${userId}/messages/${child.key}/read`] = true;
    }
  });
  
  if (Object.keys(updates).length > 0) {
    await getRef().update(updates);
  }
}

// --- PUBLIC CHAT ---

export async function getPublicMessages(limit = 50) {
  const snap = await getRef('publicChat').limitToLast(limit).get();
  if (!snap.exists()) return [];
  
  const messages = [];
  snap.forEach(child => {
    messages.push({ id: child.key, ...child.val() });
  });
  return messages;
}

export async function sendPublicMessage(userId, payload, isAdmin = false) {
  const userData = await getUserData(userId);
  const username = userData?.username || 'User';
  
  const msgRef = getRef('publicChat').push();
  const messageData = {
    id: msgRef.key,
    userId: userId,
    username: username,
    senderRole: isAdmin ? 'admin' : 'user',
    message: payload.message || '',
    timestamp: Date.now(),
    edited: false,
    deleted: false,
    replyToId: payload.replyToId || null,
    media: payload.media || null
  };
  
  await msgRef.set(messageData);
  return messageData;
}

// --- MESSAGE MODERATION (Edit / Delete) ---

export async function updateMessage(messageId, userId, newMessage, isAdmin = false) {
  // Try to find in Public Chat first
  let msgSnap = await getRef(`publicChat/${messageId}`).get();
  let chatType = 'public';
  
  if (!msgSnap.exists()) {
    // If not in public, check user's private chat
    msgSnap = await getRef(`privateChats/${userId}/messages/${messageId}`).get();
    chatType = 'private';
  }
  
  if (!msgSnap.exists()) {
    throw { statusCode: 404, message: 'Message not found' };
  }
  
  const msgData = msgSnap.val();
  
  // Ownership check
  if (!isAdmin && msgData.userId !== userId && msgData.senderId !== userId) {
    throw { statusCode: 403, message: 'You can only edit your own messages.' };
  }
  
  // Edit window check (Only for non-admins)
  if (!isAdmin) {
    const timeDiff = Date.now() - msgData.timestamp;
    if (timeDiff > CHAT_EDIT_WINDOW_MS) {
      throw { statusCode: 403, message: 'Edit time window has expired.' };
    }
  }
  
  const basePath = chatType === 'public' ? `publicChat/${messageId}` : `privateChats/${userId}/messages/${messageId}`;
  const updates = {
    [`${basePath}/message`]: newMessage,
    [`${basePath}/edited`]: true,
    [`${basePath}/editedAt`]: Date.now()
  };
  
  await getRef().update(updates);
  return { id: messageId, edited: true };
}

export async function deleteMessage(messageId, userId, isAdmin = false) {
  let msgSnap = await getRef(`publicChat/${messageId}`).get();
  let chatType = 'public';
  
  if (!msgSnap.exists()) {
    msgSnap = await getRef(`privateChats/${userId}/messages/${messageId}`).get();
    chatType = 'private';
  }
  
  if (!msgSnap.exists()) {
    throw { statusCode: 404, message: 'Message not found' };
  }
  
  const msgData = msgSnap.val();
  
  if (!isAdmin && msgData.userId !== userId && msgData.senderId !== userId) {
    throw { statusCode: 403, message: 'You can only delete your own messages.' };
  }
  
  const basePath = chatType === 'public' ? `publicChat/${messageId}` : `privateChats/${userId}/messages/${messageId}`;
  const updates = {
    [`${basePath}/deleted`]: true,
    [`${basePath}/deletedAt`]: Date.now(),
    [`${basePath}/message`]: null,
    [`${basePath}/media`]: null
  };
  
  await getRef().update(updates);
  return { id: messageId, deleted: true };
}

// --- ADMIN CHAT FUNCTIONS ---

export async function getPrivateChatUsers() {
  const snap = await getRef('privateChats').get();
  if (!snap.exists()) return [];
  
  const users = [];
  snap.forEach(userSnap => {
    const userId = userSnap.key;
    const messages = userSnap.val().messages || {};
    const msgArray = Object.values(messages);
    
    if (msgArray.length > 0) {
      msgArray.sort((a, b) => b.timestamp - a.timestamp);
      const lastMsg = msgArray[0];
      const unreadCount = msgArray.filter(m => m.senderRole === 'user' && !m.read).length;
      
      users.push({
        userId: userId,
        username: lastMsg.username,
        lastMessage: lastMsg.message || '[Media]',
        lastMessageAt: lastMsg.timestamp,
        unreadCount: unreadCount
      });
    }
  });
  
  // Sort users by most recent message
  users.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
  return users;
}

export async function adminDeletePublicMessage(messageId) {
  const updates = {
    [`publicChat/${messageId}/deleted`]: true,
    [`publicChat/${messageId}/deletedAt`]: Date.now(),
    [`publicChat/${messageId}/message`]: null,
    [`publicChat/${messageId}/media`]: null
  };
  await getRef().update(updates);
  return { id: messageId, deleted: true };
}

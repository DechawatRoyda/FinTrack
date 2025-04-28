import Session from '../models/Session.js';

export const cleanupExpiredSessions = async () => {
  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    await Session.deleteMany({ createdAt: { $lt: oneHourAgo } });
  } catch (err) {
    console.error('Session cleanup error:', err);
  }
};


// // Login
// await fetch('/api/auth/login', {
//   method: 'POST',
//   body: JSON.stringify({ username, password })
// });

// // Logout
// await fetch('/api/auth/logout', {
//   method: 'POST',
//   headers: {
//     'Authorization': `Bearer ${token}`
//   }
// });

// // Check Session
// await fetch('/api/auth/check-session', {
//   headers: {
//     'Authorization': `Bearer ${token}`
//   }
// });
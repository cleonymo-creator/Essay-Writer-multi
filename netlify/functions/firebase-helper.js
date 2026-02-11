const admin = require('firebase-admin');

let db = null;

function initializeFirebase() {
  if (db) return db;

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
      })
    });
  }

  db = admin.firestore();
  return db;
}

function getAuth() {
  // Ensure Firebase is initialized
  initializeFirebase();
  return admin.auth();
}

// Wrap a promise with a timeout to prevent Firestore hangs from killing Netlify functions.
// When Firestore is unreachable, calls hang indefinitely until the function times out (500).
// This lets us fail fast and fall back to Netlify Blobs instead.
function firestoreTimeout(promise, ms = 4000) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Firestore timeout')), ms)
    )
  ]);
}

module.exports = { initializeFirebase, getAuth, firestoreTimeout };
const admin = require('firebase-admin');

let db = null;

function initializeFirebase() {
  if (db) return db;
  
  // Initialize Firebase Admin SDK
  // For Netlify, credentials should be set via environment variables
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

module.exports = { initializeFirebase };
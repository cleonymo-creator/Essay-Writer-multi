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

module.exports = { initializeFirebase, getAuth };
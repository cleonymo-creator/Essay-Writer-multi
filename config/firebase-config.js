/**
 * Firebase Configuration (Optional)
 * Set FIREBASE_ENABLED to true and add your credentials to use Firebase
 * Otherwise, the app uses Netlify Blobs storage
 */

window.FIREBASE_ENABLED = false;

window.FIREBASE_CONFIG = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

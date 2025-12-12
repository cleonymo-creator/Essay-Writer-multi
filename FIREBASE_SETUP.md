# Firebase Setup Guide

This guide will help you set up Firebase for real-time updates in your essay application.

## Benefits of Firebase

- **Real-time updates**: Teacher dashboard updates instantly when students submit essays
- **Better reliability**: Data stored in Google's infrastructure
- **Cross-device sync**: Students can continue essays on different devices
- **Scalability**: Handles many concurrent users

## Setup Steps

### 1. Create a Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click "Add project" (or "Create a project")
3. Enter a project name (e.g., "essay-writing-app")
4. Disable Google Analytics (optional, not needed for this app)
5. Click "Create project"

### 2. Enable Firestore Database

1. In your Firebase project, click "Build" → "Firestore Database"
2. Click "Create database"
3. Choose "Start in test mode" (we'll secure it later)
4. Select a location close to your users (e.g., europe-west2 for UK)
5. Click "Enable"

### 3. Get Your Web App Credentials

1. In Firebase Console, click the gear icon ⚙️ → "Project settings"
2. Scroll down to "Your apps" section
3. Click the web icon `</>` to add a web app
4. Enter a nickname (e.g., "Essay App")
5. Don't enable Firebase Hosting (we're using Netlify)
6. Click "Register app"
7. You'll see your configuration - copy these values:

```javascript
const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123"
};
```

### 4. Update Your Configuration

Open `config/firebase-config.js` and replace the placeholder values:

```javascript
window.FIREBASE_CONFIG = {
  apiKey: "YOUR_ACTUAL_API_KEY",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123"
};

// Change this to true
window.FIREBASE_ENABLED = true;
```

### 5. Set Up Security Rules

In Firebase Console → Firestore Database → Rules, replace with:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Allow anyone to read/write progress (students writing essays)
    match /progress/{document} {
      allow read, write: if true;
    }
    
    // Allow anyone to read/write submissions
    match /submissions/{document} {
      allow read, write: if true;
    }
  }
}
```

Click "Publish" to save the rules.

> **Note**: These rules allow anyone to read/write. For production, you may want to add authentication.

### 6. Deploy and Test

1. Deploy your site to Netlify
2. Open the teacher dashboard
3. You should see "Real-time updates enabled" indicator
4. Have someone start an essay - they should appear in "In Progress" instantly

## Troubleshooting

### "Firebase not configured" message
- Check that `FIREBASE_ENABLED = true` in firebase-config.js
- Verify all config values are correct (no "YOUR_" placeholders)

### Data not appearing
- Check browser console for errors
- Verify Firestore is enabled in Firebase Console
- Check security rules allow read/write

### CORS errors
- Make sure you're using the correct `authDomain` value
- Add your Netlify domain to authorized domains in Firebase Console → Authentication → Settings

## Data Structure

Firebase stores data in two collections:

### `progress` collection
Stores in-progress essays (students currently writing):
```javascript
{
  studentName: "John Smith",
  studentEmail: "jsmith@bb-hs.co.uk",
  essayId: "christmas-carol",
  essayTitle: "A Christmas Carol...",
  currentParagraph: "Introduction",
  percentComplete: 42,
  updatedAt: Timestamp
}
```

### `submissions` collection
Stores completed essays:
```javascript
{
  studentName: "John Smith",
  studentEmail: "jsmith@bb-hs.co.uk",
  essayId: "christmas-carol",
  score: 78,
  grade: "B+",
  essay: "Full essay text...",
  feedback: { ... },
  submittedAt: Timestamp
}
```

## Costs

Firebase has a generous free tier:
- 50,000 reads/day
- 20,000 writes/day
- 1 GB storage

For a typical school class, you'll stay well within free limits.

## Fallback

If Firebase is not configured or fails, the app automatically falls back to Netlify Blobs storage. Students won't lose their work.

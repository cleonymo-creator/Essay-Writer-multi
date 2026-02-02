// Netlify Function to serve Firebase config from environment variables
// This allows the API key to stay in Netlify environment variables

exports.handler = async (event, context) => {
  // Only allow GET requests
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // Build config from environment variables
  const config = {
    apiKey: process.env.FIREBASE_API_KEY || process.env.ENV_FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || process.env.ENV_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.FIREBASE_PROJECT_ID || process.env.ENV_FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || process.env.ENV_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || process.env.ENV_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.FIREBASE_APP_ID || process.env.ENV_FIREBASE_APP_ID
  };

  // Check if config is complete
  if (!config.apiKey || !config.projectId) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        error: 'Firebase environment variables not configured',
        hint: 'Set FIREBASE_API_KEY, FIREBASE_PROJECT_ID, etc. in Netlify environment variables'
      })
    };
  }

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600' // Cache for 1 hour
    },
    body: JSON.stringify(config)
  };
};

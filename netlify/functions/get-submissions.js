const { getStore } = require("@netlify/blobs");

// Get store with manual configuration if env vars are set
function getBlobStore(name) {
  const siteID = process.env.NETLIFY_SITE_ID;
  const token = process.env.NETLIFY_BLOBS_TOKEN;
  
  if (siteID && token) {
    return getStore({ name, siteID, token });
  }
  return getStore(name);
}

exports.handler = async (event, context) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      },
      body: ''
    };
  }

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    // Check authentication
    const params = event.queryStringParameters || {};
    const expectedPassword = process.env.TEACHER_PASSWORD || 'teacher123';
    
    if (params.auth !== expectedPassword && params.auth !== 'teacher123') {
      return {
        statusCode: 401,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ error: 'Unauthorized - Invalid teacher password' })
      };
    }

    // Fetch all submissions from Blobs
    const store = getBlobStore("homework-submissions");
    const { blobs } = await store.list();
    
    const submissions = [];
    for (const blob of blobs) {
      try {
        const data = await store.get(blob.key);
        if (data) {
          const parsed = JSON.parse(data);
          submissions.push(parsed);
        }
      } catch (e) {
        console.error('Error fetching blob:', blob.key, e.message);
      }
    }

    // Sort by newest first
    submissions.sort((a, b) => 
      new Date(b.serverTimestamp || b.submittedAt || b.timestamp) - 
      new Date(a.serverTimestamp || a.submittedAt || a.timestamp)
    );

    console.log(`Retrieved ${submissions.length} submissions`);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ 
        success: true,
        count: submissions.length,
        submissions: submissions
      })
    };

  } catch (error) {
    console.error('Get submissions error:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ 
        error: 'Failed to retrieve submissions',
        message: error.message 
      })
    };
  }
};

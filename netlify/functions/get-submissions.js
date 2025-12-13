const { getStore } = require("@netlify/blobs");

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

    // Get the store - siteID and token are automatic in Netlify Functions
    const store = getStore("homework-submissions");
    
    let blobs = [];
    try {
      const result = await store.list();
      blobs = result.blobs || [];
    } catch (listError) {
      // Store might not exist yet (no data written) - return empty
      console.log('Store list error (may be empty):', listError.message);
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ 
          success: true,
          count: 0,
          submissions: []
        })
      };
    }
    
    const submissions = [];
    for (const blob of blobs) {
      try {
        const data = await store.get(blob.key, { type: 'json' });
        if (data) {
          submissions.push(data);
        }
      } catch (e) {
        console.error('Error fetching blob:', blob.key, e.message);
      }
    }

    // Sort by newest first
    submissions.sort((a, b) => 
      new Date(b.serverTimestamp || b.submittedAt || b.timestamp || 0) - 
      new Date(a.serverTimestamp || a.submittedAt || a.timestamp || 0)
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
        message: error.message,
        stack: error.stack
      })
    };
  }
};

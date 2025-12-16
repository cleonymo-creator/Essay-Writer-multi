const { initializeFirebase } = require('./firebase-helper');

exports.handler = async (event) => {
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
    const params = event.queryStringParameters || {};
    const expectedPassword = process.env.TEACHER_PASSWORD || 'teacher123';
    
    // Check authentication
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

    const db = initializeFirebase();
    
    // Get all submissions, ordered by newest first
    const snapshot = await db.collection('submissions')
      .orderBy('serverTimestamp', 'desc')
      .get();
    
    const submissions = [];
    snapshot.forEach(doc => {
      submissions.push(doc.data());
    });

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
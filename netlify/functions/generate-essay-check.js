// Check essay generation job status - Admin only
const { getStore, connectLambda } = require('@netlify/blobs');
const { initializeFirebase } = require('./firebase-helper');

// Verify admin session (same as start function)
async function verifyAdminSession(sessionToken) {
  if (!sessionToken) {
    return { valid: false, error: 'No session token provided' };
  }

  try {
    const db = initializeFirebase();
    if (db) {
      const sessionDoc = await db.collection('teacherSessions').doc(sessionToken).get();
      if (sessionDoc.exists) {
        const session = sessionDoc.data();
        if (new Date(session.expiresAt.toDate ? session.expiresAt.toDate() : session.expiresAt) < new Date()) {
          return { valid: false, error: 'Session expired' };
        }

        const teacherDoc = await db.collection('teachers').doc(session.email).get();
        if (!teacherDoc.exists) {
          return { valid: false, error: 'Teacher not found' };
        }

        const teacher = teacherDoc.data();
        if (teacher.role !== 'admin') {
          return { valid: false, error: 'Admin access required' };
        }

        return { valid: true, email: session.email };
      }
    }

    // Fallback to Netlify Blobs
    const teacherSessionsStore = getStore("teacher-sessions");
    const teachersStore = getStore("teachers");

    const session = await teacherSessionsStore.get(sessionToken, { type: 'json' });
    if (!session) {
      return { valid: false, error: 'Invalid session' };
    }

    const teacher = await teachersStore.get(session.email, { type: 'json' });
    if (!teacher || teacher.role !== 'admin') {
      return { valid: false, error: 'Admin access required' };
    }

    return { valid: true, email: session.email };
  } catch (error) {
    console.error('Session verification error:', error);
    return { valid: false, error: 'Session verification failed' };
  }
}

function getSessionToken(event) {
  const authHeader = event.headers.authorization || event.headers.Authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  return event.queryStringParameters?.sessionToken || null;
}

exports.handler = async (event, context) => {
  connectLambda(event);

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // Verify admin session
  const sessionToken = getSessionToken(event);
  const authResult = await verifyAdminSession(sessionToken);
  if (!authResult.valid) {
    return {
      statusCode: 403,
      headers,
      body: JSON.stringify({ success: false, error: authResult.error })
    };
  }

  const jobId = event.queryStringParameters?.jobId;
  if (!jobId) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing jobId' }) };
  }

  try {
    console.log('Checking job:', jobId);

    const store = getStore('essay-generation-jobs');
    const result = await store.get(jobId, { type: 'json' });

    if (!result) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ status: 'processing' })
      };
    }

    console.log('Job status:', result.status);

    // Return the job result (without the full input to reduce payload size)
    const response = {
      status: result.status,
      config: result.config,
      parsedEssay: result.parsedEssay || null,
      error: result.error,
      createdBy: result.createdBy,
      completedAt: result.completedAt
    };

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(response)
    };

  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message })
    };
  }
};

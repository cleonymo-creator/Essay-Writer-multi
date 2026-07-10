// Start essay generation job - Admin only
// Creates job and saves to Netlify Blobs for background processing
const { getStore, connectLambda } = require('@netlify/blobs');
const { getSessionToken, verifyAdminSession } = require('./_lib/session');

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

  if (event.httpMethod !== 'POST') {
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

  try {
    const body = JSON.parse(event.body);
    const jobId = 'essay_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);

    console.log('Creating essay generation job:', jobId);
    console.log('Created by:', authResult.email);

    const store = getStore('essay-generation-jobs');

    // Save the job data
    await store.setJSON(jobId, {
      status: 'processing',
      input: body,
      createdBy: authResult.email,
      createdByName: authResult.name,
      timestamp: Date.now()
    });

    console.log('Job saved to Blobs');

    return {
      statusCode: 202,
      headers,
      body: JSON.stringify({ success: true, jobId, status: 'processing' })
    };

  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: error.message })
    };
  }
};

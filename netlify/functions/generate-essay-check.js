// Check essay generation job status - Admin only
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

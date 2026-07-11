// Start essay generation job - Admin only
// Creates job and saves to Netlify Blobs for background processing
const { getStore, connectLambda } = require('@netlify/blobs');
const { getSessionToken, verifyAdminSession } = require('./_lib/session');
const { checkRateLimit } = require('./_lib/rate-limit');

// Delete job blobs older than this — results are consumed within minutes;
// a week covers any resume scenario while keeping the store from growing
// forever (job inputs can contain multi-MB base64 uploads).
const JOB_TTL_MS = 7 * 24 * 60 * 60 * 1000;

async function cleanupOldJobs(store) {
  try {
    const { blobs } = await store.list();
    const cutoff = Date.now() - JOB_TTL_MS;
    let deleted = 0;
    for (const blob of blobs) {
      if (deleted >= 50) break; // bounded work per invocation
      const match = blob.key.match(/^essay_(\d+)_/);
      if (match && parseInt(match[1]) < cutoff) {
        await store.delete(blob.key);
        deleted++;
      }
    }
    if (deleted > 0) console.log('Cleaned up', deleted, 'expired job blobs');
  } catch (e) {
    console.warn('Job cleanup failed (non-fatal):', e.message);
  }
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

  // Each generation is a large paid model call — cap the rate per teacher
  const rl = await checkRateLimit(authResult.email, 'generate-essay', { limit: 12, windowSeconds: 3600 });
  if (!rl.allowed) {
    return {
      statusCode: 429,
      headers,
      body: JSON.stringify({
        success: false,
        error: `Generation limit reached. Try again in about ${Math.ceil((rl.retryAfterSeconds || 3600) / 60)} minutes.`
      })
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

    // Opportunistic TTL cleanup (roughly one run in ten)
    if (Math.random() < 0.1) {
      await cleanupOldJobs(store);
    }

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

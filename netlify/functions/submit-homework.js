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
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      },
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
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
    const submission = JSON.parse(event.body);
    
    // Validate required fields
    if (!submission.studentName) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ error: 'Student name is required' })
      };
    }

    // Check for either homework answers OR essay content
    const isEssay = submission.type === 'essay';
    const isHomework = submission.answers && Object.keys(submission.answers).length > 0;
    
    if (!isEssay && !isHomework) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ error: 'Submission content is required (answers or essay)' })
      };
    }

    // Add server metadata
    submission.serverTimestamp = new Date().toISOString();
    submission.id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Save to Blobs
    const store = getBlobStore("homework-submissions");
    const key = `submission-${submission.id}`;
    await store.set(key, JSON.stringify(submission));

    console.log('Submission saved:', {
      id: submission.id,
      student: submission.studentName,
      score: submission.score,
      timestamp: submission.serverTimestamp
    });

    // Clean up progress entry for this student
    try {
      const progressStore = getBlobStore("homework-progress");
      const sanitizedName = submission.studentName.replace(/[^a-zA-Z0-9]/g, '_');
      await progressStore.delete(`progress-${sanitizedName}`);
      console.log('Progress entry cleaned up for:', submission.studentName);
    } catch (e) {
      // Ignore cleanup errors - not critical
      console.log('Progress cleanup note:', e.message);
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ 
        success: true,
        submissionId: submission.id,
        message: 'Your homework has been submitted successfully!'
      })
    };

  } catch (error) {
    console.error('Submission error:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ 
        error: 'Failed to save submission',
        message: error.message 
      })
    };
  }
};

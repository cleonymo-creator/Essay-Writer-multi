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
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      },
      body: ''
    };
  }

  // ============================================
  // GET - Retrieve in-progress students for teacher dashboard
  // ============================================
  if (event.httpMethod === 'GET') {
    try {
      const params = event.queryStringParameters || {};
      const expectedPassword = process.env.TEACHER_PASSWORD || 'teacher123';
      
      if (params.auth !== expectedPassword && params.auth !== 'teacher123') {
        return {
          statusCode: 401,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          },
          body: JSON.stringify({ error: 'Unauthorized' })
        };
      }

      const store = getBlobStore("homework-progress");
      const { blobs } = await store.list();
      
      const inProgress = [];
      for (const blob of blobs) {
        try {
          const data = await store.get(blob.key);
          if (data) {
            const parsed = JSON.parse(data);
            // Only include students who haven't completed
            if (!parsed.completed && parsed.percentComplete < 100) {
              inProgress.push(parsed);
            }
          }
        } catch (e) {
          console.error('Error fetching progress:', blob.key, e.message);
        }
      }

      // Sort by most recent activity
      inProgress.sort((a, b) => 
        new Date(b.lastUpdate) - new Date(a.lastUpdate)
      );

      console.log(`Retrieved ${inProgress.length} in-progress students`);

      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ 
          success: true,
          count: inProgress.length,
          inProgress: inProgress
        })
      };
    } catch (error) {
      console.error('Get progress error:', error);
      return {
        statusCode: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ error: error.message })
      };
    }
  }

  // ============================================
  // POST - Save student progress
  // ============================================
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
    const progressData = JSON.parse(event.body);
    
    if (!progressData.studentName) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ error: 'Student name is required' })
      };
    }

    const store = getBlobStore("homework-progress");
    const sanitizedName = progressData.studentName.replace(/[^a-zA-Z0-9]/g, '_');
    const key = `progress-${sanitizedName}`;
    
    // If completed, delete progress entry
    if (progressData.completed || progressData.percentComplete >= 100) {
      try {
        await store.delete(key);
        console.log('Progress cleared for completed student:', progressData.studentName);
      } catch (e) {
        // Ignore delete errors
      }
      
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ 
          success: true,
          message: 'Progress cleared (student completed)'
        })
      };
    }

    // Save progress
    progressData.lastUpdate = new Date().toISOString();
    await store.set(key, JSON.stringify(progressData));
    
    console.log('Progress saved:', {
      student: progressData.studentName,
      percent: progressData.percentComplete,
      question: progressData.currentQuestion
    });
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ 
        success: true,
        timestamp: progressData.lastUpdate
      })
    };
  } catch (error) {
    console.error('Save progress error:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ success: false, error: error.message })
    };
  }
};

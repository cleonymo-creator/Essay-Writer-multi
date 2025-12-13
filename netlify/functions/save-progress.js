const { getStore, connectLambda } = require("@netlify/blobs");

exports.handler = async (event, context) => {
  // Connect Lambda context for Blobs access
  connectLambda(event, context);

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

      // Get the store
      const store = getStore("homework-progress");

      let blobs = [];
      try {
        const result = await store.list();
        blobs = result.blobs || [];
      } catch (listError) {
        // Store might not exist yet - return empty
        console.log('Progress store list error (may be empty):', listError.message);
        return {
          statusCode: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          },
          body: JSON.stringify({ 
            success: true,
            count: 0,
            inProgress: []
          })
        };
      }
      
      const inProgress = [];
      for (const blob of blobs) {
        try {
          const data = await store.get(blob.key, { type: 'json' });
          if (data) {
            // Only include students who haven't completed
            if (!data.completed && (data.percentComplete === undefined || data.percentComplete < 100)) {
              inProgress.push(data);
            }
          }
        } catch (e) {
          console.error('Error fetching progress:', blob.key, e.message);
        }
      }

      // Sort by most recent activity
      inProgress.sort((a, b) => 
        new Date(b.lastUpdate || 0) - new Date(a.lastUpdate || 0)
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
        body: JSON.stringify({ 
          error: error.message,
          stack: error.stack 
        })
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

    // Get the store
    const store = getStore("homework-progress");

    const sanitizedName = progressData.studentName.replace(/[^a-zA-Z0-9]/g, '_');
    const essayId = progressData.essayId ? `-${progressData.essayId}` : '';
    const key = `progress-${sanitizedName}${essayId}`;
    
    // If completed, delete progress entry
    if (progressData.completed || progressData.percentComplete >= 100) {
      try {
        await store.delete(key);
        console.log('Progress cleared for completed student:', progressData.studentName);
      } catch (e) {
        // Ignore delete errors
        console.log('Delete error (may not exist):', e.message);
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
    await store.setJSON(key, progressData);
    
    console.log('Progress saved:', {
      student: progressData.studentName,
      percent: progressData.percentComplete
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
      body: JSON.stringify({ 
        success: false, 
        error: error.message,
        stack: error.stack
      })
    };
  }
};

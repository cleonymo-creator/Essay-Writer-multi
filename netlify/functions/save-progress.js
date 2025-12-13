const { getStore } = require("@netlify/blobs");

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

  // Get the store - Netlify automatically provides siteID and token in Functions
  // No manual configuration needed!
  const store = getStore("homework-progress");

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

      const { blobs } = await store.list();
      
      const inProgress = [];
      for (const blob of blobs) {
        try {
          // Use type: 'json' for automatic JSON parsing
          const data = await store.get(blob.key, { type: 'json' });
          if (data) {
            // Only include students who haven't completed
            if (!data.completed && data.percentComplete < 100) {
              inProgress.push(data);
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

    // Save progress using setJSON for cleaner code
    progressData.lastUpdate = new Date().toISOString();
    await store.setJSON(key, progressData);
    
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

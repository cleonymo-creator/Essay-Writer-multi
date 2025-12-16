const { initializeFirebase } = require('./firebase-helper');

exports.handler = async (event) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      },
      body: ''
    };
  }

  const db = initializeFirebase();

  // GET - Retrieve progress
  if (event.httpMethod === 'GET') {
    try {
      const params = event.queryStringParameters || {};
      const expectedPassword = process.env.TEACHER_PASSWORD || 'teacher123';
      
      // Student progress retrieval by email
      if (params.email) {
        const sanitizedEmail = params.email.toLowerCase().replace(/[^a-zA-Z0-9@._-]/g, '_');
        const essayId = params.essayId || '';
        const docId = `${sanitizedEmail}${essayId ? `-${essayId}` : ''}`;
        
        const docRef = db.collection('progress').doc(docId);
        const doc = await docRef.get();
        
        if (doc.exists && !doc.data().completed) {
          return {
            statusCode: 200,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({
              success: true,
              found: true,
              progress: doc.data()
            })
          };
        } else {
          return {
            statusCode: 200,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({
              success: true,
              found: false
            })
          };
        }
      }
      
      // Teacher dashboard - list all in-progress
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

      // Get all progress documents
      const snapshot = await db.collection('progress')
        .where('completed', '==', false)
        .orderBy('lastUpdate', 'desc')
        .get();
      
      const inProgress = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        inProgress.push({
          studentName: data.studentName,
          studentEmail: data.studentEmail,
          essayId: data.essayId,
          essayTitle: data.essayTitle,
          targetGrade: data.targetGrade,
          gradeSystem: data.gradeSystem,
          currentParagraph: data.currentParagraph,
          currentParagraphIndex: data.currentParagraphIndex,
          totalParagraphs: data.totalParagraphs,
          completedParagraphs: data.completedParagraphs,
          percentComplete: data.percentComplete,
          paragraphScores: data.paragraphScores,
          lastUpdate: data.lastUpdate
        });
      });

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
          error: error.message
        })
      };
    }
  }

  // POST - Save student progress
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
    
    if (!progressData.studentEmail) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ error: 'Student email is required' })
      };
    }

    const sanitizedEmail = progressData.studentEmail.toLowerCase().replace(/[^a-zA-Z0-9@._-]/g, '_');
    const essayId = progressData.essayId ? `-${progressData.essayId}` : '';
    const docId = `${sanitizedEmail}${essayId}`;
    
    // If completed, delete progress entry
    if (progressData.completed || progressData.percentComplete >= 100) {
      await db.collection('progress').doc(docId).delete();
      
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
    await db.collection('progress').doc(docId).set(progressData);
    
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
        error: error.message
      })
    };
  }
};
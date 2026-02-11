const { initializeFirebase, firestoreTimeout } = require('./firebase-helper');

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

  let db;
  try {
    db = initializeFirebase();
  } catch (initError) {
    console.error('Firebase initialization error:', initError);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ 
        error: 'Firebase initialization failed',
        details: initError.message
      })
    };
  }

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
        
        console.log('[save-progress] Looking up progress for:', docId);
        
        const docRef = db.collection('progress').doc(docId);
        const doc = await firestoreTimeout(docRef.get());
        
        if (doc.exists && !doc.data().completed) {
          console.log('[save-progress] Found progress for:', params.email);
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
          console.log('[save-progress] No active progress found for:', params.email);
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
      // Try session-based auth first (Firestore)
      let authorized = false;
      const authHeader = event.headers.authorization || event.headers.Authorization;
      const sessionToken = (authHeader && authHeader.startsWith('Bearer '))
        ? authHeader.substring(7)
        : params.sessionToken;

      if (sessionToken) {
        try {
          const sessionDoc = await firestoreTimeout(db.collection('teacherSessions').doc(sessionToken).get());
          if (sessionDoc.exists) {
            const session = sessionDoc.data();
            const expiresAt = session.expiresAt?.toDate ? session.expiresAt.toDate() : new Date(session.expiresAt);
            if (expiresAt >= new Date()) {
              authorized = true;
            }
          }
        } catch (e) {
          console.error('[save-progress] Session verification error:', e.message);
        }
      }

      // Fallback to legacy password auth
      if (!authorized) {
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
      }

      // Get all progress documents
      const snapshot = await firestoreTimeout(db.collection('progress')
        .orderBy('lastUpdate', 'desc')
        .get(), 6000);
      
      const inProgress = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        if (!data.completed && (data.percentComplete === undefined || data.percentComplete < 100)) {
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
        }
      });

      console.log(`[save-progress] Retrieved ${inProgress.length} in-progress students`);

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
      try {
        await firestoreTimeout(db.collection('progress').doc(docId).delete());
        console.log('[save-progress] Progress cleared for completed student:', progressData.studentEmail);
      } catch (e) {
        console.log('[save-progress] Delete error (may not exist):', e.message);
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
    await firestoreTimeout(db.collection('progress').doc(docId).set(progressData));
    
    console.log('[save-progress] Progress saved:', {
      email: progressData.studentEmail,
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
        error: error.message
      })
    };
  }
};
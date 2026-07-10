const { initializeFirebase, firestoreTimeout } = require('./firebase-helper');
const { verifyAnySession } = require('./_lib/session');

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

      // Student progress retrieval by email
      if (params.email) {
        // Require a session; a student may only read their own progress.
        const getAuth = await verifyAnySession(event);
        if (!getAuth.valid) {
          return {
            statusCode: 401,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ success: false, error: 'Authentication required' })
          };
        }
        if (getAuth.role === 'student' && getAuth.email !== params.email.toLowerCase()) {
          return {
            statusCode: 403,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ success: false, error: 'Forbidden' })
          };
        }
        const emailLower = params.email.toLowerCase();
        const sanitizedEmail = emailLower.replace(/[^a-zA-Z0-9@._-]/g, '_');
        const essayId = params.essayId || '';
        const docId = `${sanitizedEmail}${essayId ? `_${essayId}` : ''}`;
        // The client-side Firebase SDK writes progress docs with the
        // UNSANITIZED email in the doc ID, so cross-device resume must
        // try both formats.
        const altDocId = `${emailLower}${essayId ? `_${essayId}` : ''}`;

        console.log('[save-progress] Looking up progress for:', docId);

        let doc = await firestoreTimeout(db.collection('progress').doc(docId).get());

        if ((!doc.exists || doc.data().completed) && altDocId !== docId) {
          console.log('[save-progress] Trying alternate doc ID:', altDocId);
          doc = await firestoreTimeout(db.collection('progress').doc(altDocId).get());
        }

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
          // Final fallback: query by field (catches any doc ID format)
          if (essayId) {
            try {
              const snapshot = await firestoreTimeout(
                db.collection('progress')
                  .where('studentEmail', '==', emailLower)
                  .where('essayId', '==', essayId)
                  .limit(1)
                  .get()
              );
              if (!snapshot.empty && !snapshot.docs[0].data().completed) {
                console.log('[save-progress] Found progress via field query for:', params.email);
                return {
                  statusCode: 200,
                  headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
                  body: JSON.stringify({ success: true, found: true, progress: snapshot.docs[0].data() })
                };
              }
            } catch (queryErr) {
              console.log('[save-progress] Field query fallback error:', queryErr.message);
            }
          }
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

      // Require a valid teacher session (no password fallback)
      if (!authorized) {
        return {
          statusCode: 401,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          },
          body: JSON.stringify({ error: 'Unauthorized' })
        };
      }

      // Get all progress documents (no orderBy: Firestore orderBy silently
      // excludes docs that lack the ordered field or have mixed types in it)
      const snapshot = await firestoreTimeout(db.collection('progress')
        .get(), 6000);

      const inProgress = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        if (!data.completed) {
          // Normalize timestamps for consistent serialization and sorting
          const lastUpdate = data.updatedAt?.toDate
            ? data.updatedAt.toDate().toISOString()
            : (data.lastUpdate || data.updatedAt);
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
            lastUpdate: lastUpdate
          });
        }
      });

      // Sort by most recent first (was previously done by Firestore orderBy)
      inProgress.sort((a, b) => new Date(b.lastUpdate || 0) - new Date(a.lastUpdate || 0));

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

  // Require a valid session; bind the write to the student's own identity
  const postAuth = await verifyAnySession(event);
  if (!postAuth.valid) {
    return {
      statusCode: 401,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ success: false, error: 'Authentication required' })
    };
  }

  try {
    const progressData = JSON.parse(event.body);

    // A student may only save their own progress, never another student's.
    if (postAuth.role === 'student') {
      progressData.studentEmail = postAuth.email;
    }

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
    const essayId = progressData.essayId ? `_${progressData.essayId}` : '';
    const docId = `${sanitizedEmail}${essayId}`;
    
    // If explicitly marked completed (from submit-homework), delete progress entry.
    // Note: percentComplete >= 100 alone is NOT enough to delete — student may still
    // be on the compilation screen and hasn't submitted yet. Premature deletion would
    // lose their progress if they close the browser before submitting.
    if (progressData.completed) {
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
const { initializeFirebase } = require('./firebase-helper');
const { verifyAnySession } = require('./_lib/session');

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

  // Require a valid student or teacher session
  const auth = await verifyAnySession(event);
  if (!auth.valid) {
    return {
      statusCode: 401,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ success: false, error: 'Authentication required' })
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

  try {
    const submission = JSON.parse(event.body);

    // Bind the submission to the authenticated identity: a student may only
    // submit as themselves, never forge another student's email.
    if (auth.role === 'student') {
      submission.studentEmail = auth.email;
    }

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

    // Handle update to existing submission. Prefer matching on the
    // authenticated email (unique) over the display name (can collide).
    if (submission.updateOnly) {
      let query = db.collection('submissions').where('essayId', '==', submission.essayId);
      if (submission.studentEmail) {
        query = query.where('studentEmail', '==', submission.studentEmail.toLowerCase());
      } else {
        query = query.where('studentName', '==', submission.studentName);
      }
      const snapshot = await query.limit(1).get();
      
      if (!snapshot.empty) {
        const doc = snapshot.docs[0];
        const existingData = doc.data();
        const updatedSubmission = {
          ...existingData,
          ...submission,
          updateOnly: undefined,
          updatedAt: new Date().toISOString()
        };
        
        await doc.ref.update(updatedSubmission);
        
        console.log('[submit-homework] Submission updated:', {
          id: existingData.id,
          student: submission.studentName
        });
        
        return {
          statusCode: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          },
          body: JSON.stringify({ 
            success: true,
            updated: true,
            message: 'Submission updated successfully!'
          })
        };
      }
    }

    // Check for valid submission content
    const isEssay = submission.type === 'essay';
    const isHomework = submission.answers && Object.keys(submission.answers).length > 0;
    
    if (!isEssay && !isHomework) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ error: 'Submission content is required' })
      };
    }

    // Add server metadata. Guarantee BOTH timestamp fields exist — the
    // submissions listing sorts by serverTimestamp || submittedAt.
    const now = new Date().toISOString();
    submission.serverTimestamp = now;
    if (!submission.submittedAt) submission.submittedAt = now;
    submission.id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Normalize email for consistent querying
    if (submission.studentEmail) {
      submission.studentEmail = submission.studentEmail.toLowerCase();
    }

    // Save to Firestore
    await db.collection('submissions').doc(submission.id).set(submission);

    console.log('[submit-homework] Submission saved:', {
      id: submission.id,
      student: submission.studentName,
      score: submission.score
    });

    // Clean up progress entry. The client-side SDK writes progress docs
    // with the UNSANITIZED email in the doc ID, so try both formats or
    // the essay keeps showing as "in progress" after submission.
    if (submission.studentEmail) {
      const emailLower = submission.studentEmail.toLowerCase();
      const sanitizedEmail = emailLower.replace(/[^a-zA-Z0-9@._-]/g, '_');
      const essayId = submission.essayId ? `_${submission.essayId}` : '';
      const progressDocId = `${sanitizedEmail}${essayId}`;
      const altProgressDocId = `${emailLower}${essayId}`;

      try {
        await db.collection('progress').doc(progressDocId).delete();
        if (altProgressDocId !== progressDocId) {
          await db.collection('progress').doc(altProgressDocId).delete();
        }
        console.log('[submit-homework] Progress entry cleaned up');
      } catch (e) {
        // Ignore cleanup errors
      }
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
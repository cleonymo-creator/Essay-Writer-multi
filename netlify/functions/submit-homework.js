const { initializeFirebase } = require('./firebase-helper');

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

    // Handle update to existing submission
    if (submission.updateOnly) {
      const snapshot = await db.collection('submissions')
        .where('studentName', '==', submission.studentName)
        .where('essayId', '==', submission.essayId)
        .limit(1)
        .get();
      
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

    // Add server metadata
    submission.serverTimestamp = new Date().toISOString();
    submission.id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Save to Firestore
    await db.collection('submissions').doc(submission.id).set(submission);

    console.log('[submit-homework] Submission saved:', {
      id: submission.id,
      student: submission.studentName,
      score: submission.score
    });

    // Clean up progress entry
    if (submission.studentEmail) {
      const sanitizedEmail = submission.studentEmail.toLowerCase().replace(/[^a-zA-Z0-9@._-]/g, '_');
      const essayId = submission.essayId ? `-${submission.essayId}` : '';
      const progressDocId = `${sanitizedEmail}${essayId}`;
      
      try {
        await db.collection('progress').doc(progressDocId).delete();
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
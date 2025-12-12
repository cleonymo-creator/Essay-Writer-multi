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

    const store = getBlobStore("homework-submissions");
    
    // Handle update to existing submission (e.g., adding official grading)
    if (submission.updateOnly) {
      // Find existing submission for this student and essay
      const { blobs } = await store.list();
      let existingKey = null;
      let existingSubmission = null;
      
      for (const blob of blobs) {
        try {
          const data = JSON.parse(await store.get(blob.key));
          if (data.studentName === submission.studentName && 
              data.essayId === submission.essayId) {
            existingKey = blob.key;
            existingSubmission = data;
            break;
          }
        } catch (e) {
          // Skip invalid entries
        }
      }
      
      if (existingSubmission && existingKey) {
        // Merge the new data with existing submission
        const updatedSubmission = {
          ...existingSubmission,
          ...submission,
          updateOnly: undefined, // Remove the flag
          updatedAt: new Date().toISOString()
        };
        
        await store.set(existingKey, JSON.stringify(updatedSubmission));
        
        console.log('Submission updated:', {
          id: existingSubmission.id,
          student: submission.studentName,
          addedOfficialGrading: !!submission.officialGrading
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
      } else {
        console.log('No existing submission found to update for:', submission.studentName);
        // Fall through to create new if not found
      }
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
      const essayId = submission.essayId || '';
      await progressStore.delete(`progress-${sanitizedName}-${essayId}`);
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

// Essay Management Function
// Handles CRUD for essays - Admin only
// Essays are stored in Firebase 'essays' collection with Netlify Blobs fallback

const { initializeFirebase } = require('./firebase-helper');
const { getStore, connectLambda } = require("@netlify/blobs");

// Helper to verify teacher session and check admin status
async function verifyAdminSession(sessionToken) {
  if (!sessionToken) {
    return { valid: false, error: 'No session token provided' };
  }

  try {
    // Try Firebase first
    const db = initializeFirebase();
    if (db) {
      const sessionDoc = await db.collection('teacherSessions').doc(sessionToken).get();
      if (sessionDoc.exists) {
        const session = sessionDoc.data();
        if (new Date(session.expiresAt.toDate ? session.expiresAt.toDate() : session.expiresAt) < new Date()) {
          await db.collection('teacherSessions').doc(sessionToken).delete();
          return { valid: false, error: 'Session expired' };
        }

        const teacherDoc = await db.collection('teachers').doc(session.email).get();
        if (!teacherDoc.exists) {
          return { valid: false, error: 'Teacher not found' };
        }

        const teacher = teacherDoc.data();
        if (teacher.role !== 'admin') {
          return { valid: false, error: 'Admin access required' };
        }

        return {
          valid: true,
          email: session.email,
          name: teacher.name,
          isAdmin: true
        };
      }
    }

    // Fallback to Netlify Blobs
    const teacherSessionsStore = getStore("teacher-sessions");
    const teachersStore = getStore("teachers");

    const session = await teacherSessionsStore.get(sessionToken, { type: 'json' });
    if (!session) {
      return { valid: false, error: 'Invalid session' };
    }

    if (new Date(session.expiresAt) < new Date()) {
      await teacherSessionsStore.delete(sessionToken);
      return { valid: false, error: 'Session expired' };
    }

    const teacher = await teachersStore.get(session.email, { type: 'json' });
    if (!teacher) {
      return { valid: false, error: 'Teacher not found' };
    }

    if (teacher.role !== 'admin') {
      return { valid: false, error: 'Admin access required' };
    }

    return {
      valid: true,
      email: session.email,
      name: teacher.name,
      isAdmin: true
    };
  } catch (error) {
    console.error('Session verification error:', error);
    return { valid: false, error: 'Session verification failed' };
  }
}

// Extract session token from request
function getSessionToken(event) {
  const authHeader = event.headers.authorization || event.headers.Authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  return event.queryStringParameters?.sessionToken || null;
}

// Validate essay structure
function validateEssay(essay) {
  const errors = [];

  if (!essay.id || typeof essay.id !== 'string') {
    errors.push('Essay must have a valid id (string)');
  }
  if (!essay.title || typeof essay.title !== 'string') {
    errors.push('Essay must have a title');
  }
  if (!essay.essayTitle || typeof essay.essayTitle !== 'string') {
    errors.push('Essay must have an essayTitle (the question)');
  }
  if (!essay.paragraphs || !Array.isArray(essay.paragraphs) || essay.paragraphs.length === 0) {
    errors.push('Essay must have at least one paragraph');
  } else {
    essay.paragraphs.forEach((p, i) => {
      if (!p.id) errors.push(`Paragraph ${i + 1} must have an id`);
      if (!p.title) errors.push(`Paragraph ${i + 1} must have a title`);
      if (!p.type) errors.push(`Paragraph ${i + 1} must have a type (introduction/body/conclusion)`);
    });
  }

  return errors;
}

exports.handler = async (event, context) => {
  // Initialize Netlify Blobs connection
  connectLambda(event);

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers };
  }

  try {
    // Verify admin session for all operations
    const sessionToken = getSessionToken(event);
    const sessionCheck = await verifyAdminSession(sessionToken);

    if (!sessionCheck.valid) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({
          success: false,
          error: sessionCheck.error || 'Admin access required'
        })
      };
    }

    const db = initializeFirebase();
    const essaysStore = getStore("custom-essays");

    // GET - List all custom essays
    if (event.httpMethod === 'GET') {
      let essays = [];

      // Try Firebase first
      if (db) {
        try {
          const essaysSnapshot = await db.collection('essays').orderBy('createdAt', 'desc').get();
          essays = essaysSnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            createdAt: doc.data().createdAt?.toDate?.()?.toISOString() || doc.data().createdAt
          }));
        } catch (fbError) {
          console.warn('Firebase read failed, trying Netlify Blobs:', fbError.message);
        }
      }

      // Fallback to or merge with Netlify Blobs
      try {
        const blobList = await essaysStore.list();
        for (const item of blobList.blobs) {
          const blobEssay = await essaysStore.get(item.key, { type: 'json' });
          if (blobEssay && !essays.find(e => e.id === blobEssay.id)) {
            essays.push(blobEssay);
          }
        }
      } catch (blobError) {
        console.warn('Netlify Blobs read failed:', blobError.message);
      }

      // Sort by createdAt descending
      essays.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          essays: essays
        })
      };
    }

    // POST - Create/Import a new essay
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body);
      const { action, essay, essayId } = body;

      if (action === 'delete' && essayId) {
        // Delete essay from both stores
        let deleted = false;
        if (db) {
          try {
            await db.collection('essays').doc(essayId).delete();
            deleted = true;
          } catch (e) {
            console.warn('Firebase delete failed:', e.message);
          }
        }
        try {
          await essaysStore.delete(essayId);
          deleted = true;
        } catch (e) {
          console.warn('Blob delete failed:', e.message);
        }

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: deleted,
            message: deleted ? 'Essay deleted' : 'Essay not found'
          })
        };
      }

      if (!essay) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            success: false,
            error: 'No essay data provided'
          })
        };
      }

      // Validate essay structure
      const validationErrors = validateEssay(essay);
      if (validationErrors.length > 0) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            success: false,
            error: 'Invalid essay structure',
            validationErrors: validationErrors
          })
        };
      }

      // Generate ID if not provided or sanitize existing one
      const essayIdClean = essay.id
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');

      // Check if essay with this ID already exists (in either store)
      let existingEssay = null;
      if (db) {
        try {
          const existingDoc = await db.collection('essays').doc(essayIdClean).get();
          if (existingDoc.exists) {
            existingEssay = existingDoc.data();
          }
        } catch (e) {
          console.warn('Firebase check failed:', e.message);
        }
      }
      if (!existingEssay) {
        try {
          existingEssay = await essaysStore.get(essayIdClean, { type: 'json' });
        } catch (e) {
          // Not found in blobs either, that's fine
        }
      }

      if (existingEssay && action !== 'update') {
        return {
          statusCode: 409,
          headers,
          body: JSON.stringify({
            success: false,
            error: `Essay with ID "${essayIdClean}" already exists. Use action: "update" to overwrite.`
          })
        };
      }

      // Prepare essay data
      const essayData = {
        ...essay,
        id: essayIdClean,
        createdBy: sessionCheck.email,
        createdByName: sessionCheck.name,
        createdAt: existingEssay?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isCustom: true // Flag to distinguish from static essays
      };

      // Save to both Firebase and Netlify Blobs for redundancy
      let savedToFirebase = false;
      let savedToBlobs = false;

      if (db) {
        try {
          await db.collection('essays').doc(essayIdClean).set(essayData);
          savedToFirebase = true;
        } catch (fbError) {
          console.warn('Firebase save failed:', fbError.message);
        }
      }

      try {
        await essaysStore.setJSON(essayIdClean, essayData);
        savedToBlobs = true;
      } catch (blobError) {
        console.warn('Netlify Blobs save failed:', blobError.message);
      }

      if (!savedToFirebase && !savedToBlobs) {
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({
            success: false,
            error: 'Failed to save essay to any storage backend'
          })
        };
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: action === 'update' ? 'Essay updated' : 'Essay imported',
          essayId: essayIdClean,
          storage: savedToFirebase && savedToBlobs ? 'both' : (savedToFirebase ? 'firebase' : 'blobs')
        })
      };
    }

    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Method not allowed'
      })
    };

  } catch (error) {
    console.error('Essay management error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Internal server error',
        details: error.message
      })
    };
  }
};

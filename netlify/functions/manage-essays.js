// Essay Management Function
// Handles CRUD for essays - Admin only
// Essays are stored in Firebase 'essays' collection

const { initializeFirebase } = require('./firebase-helper');
const { getStore } = require("@netlify/blobs");

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

    if (!db) {
      return {
        statusCode: 503,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Database not available'
        })
      };
    }

    // GET - List all custom essays
    if (event.httpMethod === 'GET') {
      const essaysSnapshot = await db.collection('essays').orderBy('createdAt', 'desc').get();
      const essays = essaysSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        createdAt: doc.data().createdAt?.toDate?.()?.toISOString() || doc.data().createdAt
      }));

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
        // Delete essay
        await db.collection('essays').doc(essayId).delete();
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            message: 'Essay deleted'
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

      // Check if essay with this ID already exists
      const existingDoc = await db.collection('essays').doc(essayIdClean).get();
      if (existingDoc.exists && action !== 'update') {
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
        createdAt: existingDoc.exists ? existingDoc.data().createdAt : new Date(),
        updatedAt: new Date(),
        isCustom: true // Flag to distinguish from static essays
      };

      // Save to Firebase
      await db.collection('essays').doc(essayIdClean).set(essayData);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: action === 'update' ? 'Essay updated' : 'Essay imported',
          essayId: essayIdClean
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

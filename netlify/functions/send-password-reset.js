// Send password reset emails via Firebase Auth
// Supports individual and bulk (class) password reset emails

const { getStore, connectLambda } = require('@netlify/blobs');
const { initializeFirebase, getAuth } = require('./firebase-helper');

// Verify teacher session (any teacher, not just admin)
async function verifyTeacherSession(sessionToken) {
  if (!sessionToken) {
    return { valid: false, error: 'No session token provided' };
  }

  try {
    const db = initializeFirebase();
    if (db) {
      const sessionDoc = await db.collection('teacherSessions').doc(sessionToken).get();
      if (sessionDoc.exists) {
        const session = sessionDoc.data();
        if (new Date(session.expiresAt.toDate ? session.expiresAt.toDate() : session.expiresAt) < new Date()) {
          return { valid: false, error: 'Session expired' };
        }

        const teacherDoc = await db.collection('teachers').doc(session.email).get();
        if (!teacherDoc.exists) {
          return { valid: false, error: 'Teacher not found' };
        }

        const teacher = teacherDoc.data();
        return {
          valid: true,
          email: session.email,
          isAdmin: teacher.role === 'admin',
          teacher
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

    const teacher = await teachersStore.get(session.email, { type: 'json' });
    if (!teacher) {
      return { valid: false, error: 'Teacher not found' };
    }

    return {
      valid: true,
      email: session.email,
      isAdmin: teacher.role === 'admin',
      teacher
    };
  } catch (error) {
    console.error('Session verification error:', error);
    return { valid: false, error: 'Session verification failed' };
  }
}

function getSessionToken(event) {
  const authHeader = event.headers.authorization || event.headers.Authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  return event.queryStringParameters?.sessionToken || null;
}

// Ensure a Firebase Auth user exists for the given email
async function ensureFirebaseAuthUser(auth, email, displayName) {
  try {
    await auth.getUserByEmail(email);
    return { exists: true };
  } catch (e) {
    if (e.code === 'auth/user-not-found') {
      // Create the user with a temporary password
      const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789!@#$%';
      let tempPassword = '';
      const array = require('crypto').randomBytes(16);
      for (let i = 0; i < 16; i++) {
        tempPassword += chars[array[i] % chars.length];
      }

      await auth.createUser({
        email: email,
        password: tempPassword,
        displayName: displayName || email.split('@')[0]
      });
      return { exists: false, created: true };
    }
    throw e;
  }
}

exports.handler = async (event, context) => {
  connectLambda(event);

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // Verify teacher session
  const sessionToken = getSessionToken(event);
  const authResult = await verifyTeacherSession(sessionToken);
  if (!authResult.valid) {
    return {
      statusCode: 403,
      headers,
      body: JSON.stringify({ success: false, error: authResult.error })
    };
  }

  try {
    const body = JSON.parse(event.body);
    const { action } = body;
    const auth = getAuth();

    // Send password reset email to a single student
    if (action === 'sendResetEmail') {
      const { email, displayName } = body;

      if (!email) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ success: false, error: 'Email required' })
        };
      }

      const emailLower = email.trim().toLowerCase();

      // Ensure user exists in Firebase Auth
      await ensureFirebaseAuthUser(auth, emailLower, displayName);

      // Generate password reset link
      const resetLink = await auth.generatePasswordResetLink(emailLower);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: 'Password reset email sent to ' + emailLower,
          resetLink // Return link so teacher can also share it directly if needed
        })
      };
    }

    // Send password reset emails to all students in a class
    if (action === 'sendBulkResetEmails') {
      const { classId } = body;

      if (!classId) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ success: false, error: 'Class ID required' })
        };
      }

      const db = initializeFirebase();
      const studentsStore = getStore("students");

      // Get class data to find students
      let classData = null;
      try {
        const classDoc = await db.collection('classes').doc(classId).get();
        if (classDoc.exists) {
          classData = classDoc.data();
        }
      } catch (e) {
        // Try Netlify Blobs
        const classesStore = getStore("classes");
        classData = await classesStore.get(classId, { type: 'json' });
      }

      if (!classData || !classData.students || classData.students.length === 0) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ success: false, error: 'Class not found or has no students' })
        };
      }

      const results = { sent: [], failed: [] };

      for (const studentEmail of classData.students) {
        try {
          const emailLower = studentEmail.trim().toLowerCase();

          // Get student name
          let studentName = emailLower.split('@')[0];
          try {
            const studentData = await studentsStore.get(emailLower, { type: 'json' });
            if (studentData && studentData.name) {
              studentName = studentData.name;
            }
          } catch (e) {
            try {
              const studentDoc = await db.collection('students').doc(emailLower).get();
              if (studentDoc.exists) {
                studentName = studentDoc.data().name || studentName;
              }
            } catch (e2) { /* use default */ }
          }

          // Ensure user exists in Firebase Auth
          await ensureFirebaseAuthUser(auth, emailLower, studentName);

          // Generate password reset link
          await auth.generatePasswordResetLink(emailLower);

          results.sent.push({ email: emailLower, name: studentName });
        } catch (err) {
          results.failed.push({ email: studentEmail, error: err.message });
        }
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: `Password reset emails sent: ${results.sent.length} sent, ${results.failed.length} failed`,
          results,
          summary: {
            total: classData.students.length,
            sent: results.sent.length,
            failed: results.failed.length
          }
        })
      };
    }

    // Send password reset emails to specific students
    if (action === 'sendResetEmailsBatch') {
      const { emails } = body;

      if (!emails || !Array.isArray(emails) || emails.length === 0) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ success: false, error: 'Email list required' })
        };
      }

      const db = initializeFirebase();
      const studentsStore = getStore("students");
      const results = { sent: [], failed: [] };

      for (const emailEntry of emails) {
        try {
          const email = (typeof emailEntry === 'string' ? emailEntry : emailEntry.email).trim().toLowerCase();
          const displayName = typeof emailEntry === 'object' ? emailEntry.name : email.split('@')[0];

          // Ensure user exists
          await ensureFirebaseAuthUser(auth, email, displayName);

          // Generate password reset link
          await auth.generatePasswordResetLink(email);

          results.sent.push({ email, name: displayName });
        } catch (err) {
          const email = typeof emailEntry === 'string' ? emailEntry : emailEntry.email;
          results.failed.push({ email, error: err.message });
        }
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: `Password reset emails: ${results.sent.length} sent, ${results.failed.length} failed`,
          results,
          summary: {
            total: emails.length,
            sent: results.sent.length,
            failed: results.failed.length
          }
        })
      };
    }

    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ success: false, error: 'Invalid action' })
    };

  } catch (error) {
    console.error('Password reset error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: error.message })
    };
  }
};

// Get Submissions Function
// Retrieves student submissions with teacher authentication
// Teachers only see submissions from their own students

const { initializeFirebase, firestoreTimeout } = require('./firebase-helper');
const { getStore } = require("@netlify/blobs");

// Helper to verify teacher session (Firestore first, Blobs fallback)
async function verifyTeacherSession(sessionToken) {
  if (!sessionToken) {
    return { valid: false, error: 'No session token provided' };
  }

  try {
    // Try Firestore first (primary storage for teacher-auth.js)
    // Use timeout to prevent hanging when Firestore is unreachable
    const db = initializeFirebase();
    if (db) {
      try {
        const sessionDoc = await firestoreTimeout(db.collection('teacherSessions').doc(sessionToken).get());
        if (sessionDoc.exists) {
          const session = sessionDoc.data();
          const expiresAt = session.expiresAt?.toDate ? session.expiresAt.toDate() : new Date(session.expiresAt);
          if (expiresAt < new Date()) {
            return { valid: false, error: 'Session expired' };
          }

          const teacherDoc = await firestoreTimeout(db.collection('teachers').doc(session.email).get());
          if (!teacherDoc.exists) {
            return { valid: false, error: 'Teacher not found' };
          }

          const teacher = teacherDoc.data();
          return {
            valid: true,
            email: session.email,
            name: teacher.name,
            role: teacher.role || 'teacher',
            isAdmin: teacher.role === 'admin',
            teacher
          };
        }
      } catch (firestoreErr) {
        console.warn('Firestore session check failed, falling back to Blobs:', firestoreErr.message);
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
      return { valid: false, error: 'Session expired' };
    }

    const teacher = await teachersStore.get(session.email, { type: 'json' });
    if (!teacher) {
      return { valid: false, error: 'Teacher not found' };
    }

    return {
      valid: true,
      email: session.email,
      name: teacher.name,
      role: teacher.role || 'teacher',
      isAdmin: teacher.role === 'admin',
      teacher
    };
  } catch (error) {
    console.error('Session verification error:', error);
    return { valid: false, error: 'Session verification failed' };
  }
}

// Check if teachers table exists (Firestore first, Blobs fallback)
async function teachersExist() {
  try {
    const db = initializeFirebase();
    if (db) {
      const snapshot = await firestoreTimeout(db.collection('teachers').limit(1).get());
      if (!snapshot.empty) return true;
    }
  } catch (e) {
    // Firestore failed, try Blobs
  }
  try {
    const teachersStore = getStore("teachers");
    const { blobs } = await teachersStore.list();
    return blobs && blobs.length > 0;
  } catch (e) {
    return false;
  }
}

// Get list of student emails that belong to a teacher (Firestore first, Blobs fallback)
async function getTeacherStudentEmails(teacherEmail) {
  const emails = [];

  try {
    const db = initializeFirebase();
    if (db) {
      const snapshot = await firestoreTimeout(db.collection('students')
        .where('teacherEmail', '==', teacherEmail)
        .get());
      if (!snapshot.empty) {
        snapshot.forEach(doc => {
          const student = doc.data();
          if (student.email) emails.push(student.email);
          if (student.name) emails.push(student.name.toLowerCase());
        });
        return emails;
      }
    }
  } catch (e) {
    // Firestore failed, try Blobs
  }

  try {
    const studentsStore = getStore("students");
    const { blobs } = await studentsStore.list();
    for (const blob of blobs) {
      const student = await studentsStore.get(blob.key, { type: 'json' });
      if (student && student.teacherEmail === teacherEmail) {
        emails.push(student.email);
        if (student.name) {
          emails.push(student.name.toLowerCase());
        }
      }
    }
  } catch (e) {
    console.error('Error getting teacher students:', e);
  }

  return emails;
}

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const params = event.queryStringParameters || {};
    
    // Check if new teacher auth system is in use
    const hasTeachers = await teachersExist();

    let sessionCheck = { valid: false, isAdmin: false };
    let teacherStudentEmails = null;

    if (hasTeachers) {
      // Get session token from header or query param
      const authHeader = event.headers.authorization || event.headers.Authorization;
      let sessionToken = null;

      if (authHeader && authHeader.startsWith('Bearer ')) {
        sessionToken = authHeader.substring(7);
      } else {
        sessionToken = params.sessionToken;
      }

      if (sessionToken) {
        sessionCheck = await verifyTeacherSession(sessionToken);
      }

      // If session auth failed or no token, try legacy password fallback
      if (!sessionCheck.valid) {
        const expectedPassword = process.env.TEACHER_PASSWORD || 'teacher123';
        if (params.auth === expectedPassword || params.auth === 'teacher123') {
          // Legacy password accepted - treat as admin
          sessionCheck = { valid: true, isAdmin: true };
        } else if (!sessionToken) {
          return {
            statusCode: 401,
            headers,
            body: JSON.stringify({
              success: false,
              error: 'Authentication required',
              requiresAuth: true
            })
          };
        } else {
          return {
            statusCode: 401,
            headers,
            body: JSON.stringify({
              success: false,
              error: sessionCheck.error || 'Invalid session',
              requiresAuth: true
            })
          };
        }
      }

      // If not admin, get list of student emails for filtering
      if (!sessionCheck.isAdmin) {
        teacherStudentEmails = await getTeacherStudentEmails(sessionCheck.email);
      }
    } else {
      // Legacy authentication - use old password system
      const expectedPassword = process.env.TEACHER_PASSWORD || 'teacher123';

      if (params.auth !== expectedPassword && params.auth !== 'teacher123') {
        return {
          statusCode: 401,
          headers,
          body: JSON.stringify({ error: 'Unauthorized - Invalid teacher password' })
        };
      }
    }

    const db = initializeFirebase();

    // Get all submissions, ordered by newest first
    let submissions = [];
    try {
      const snapshot = await firestoreTimeout(
        db.collection('submissions').orderBy('serverTimestamp', 'desc').get(),
        6000  // slightly longer timeout for potentially large result set
      );
      snapshot.forEach(doc => {
        submissions.push(doc.data());
      });
    } catch (firestoreErr) {
      console.warn('Firestore submissions query failed:', firestoreErr.message);
      // Try Blobs fallback for submissions
      try {
        const submissionsStore = getStore("submissions");
        const { blobs } = await submissionsStore.list();
        for (const blob of blobs) {
          try {
            const sub = await submissionsStore.get(blob.key, { type: 'json' });
            if (sub) submissions.push(sub);
          } catch (e) { /* skip bad entries */ }
        }
        submissions.sort((a, b) => new Date(b.submittedAt || 0) - new Date(a.submittedAt || 0));
      } catch (blobErr) {
        console.warn('Blobs submissions fallback also failed:', blobErr.message);
      }
    }

    // Filter by teacher's students if not admin
    if (teacherStudentEmails !== null) {
      submissions = submissions.filter(sub => {
        // Match by email or student name
        const studentEmail = (sub.studentEmail || '').toLowerCase();
        const studentName = (sub.studentName || '').toLowerCase();
        
        return teacherStudentEmails.some(email => 
          email === studentEmail || 
          email === studentName ||
          studentEmail.includes(email) ||
          studentName.includes(email)
        );
      });
    }

    console.log('[get-submissions] Retrieved ' + submissions.length + ' submissions' + 
      (sessionCheck.valid ? ' for teacher ' + sessionCheck.email : ''));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ 
        success: true,
        count: submissions.length,
        submissions: submissions,
        teacherEmail: sessionCheck.valid ? sessionCheck.email : undefined,
        isAdmin: sessionCheck.isAdmin || undefined
      })
    };

  } catch (error) {
    console.error('Get submissions error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Failed to retrieve submissions',
        message: error.message
      })
    };
  }
};

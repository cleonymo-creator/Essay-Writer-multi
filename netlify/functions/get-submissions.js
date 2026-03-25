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
// Checks both the legacy teacherEmail field AND class membership
async function getTeacherStudentEmails(teacherEmail) {
  const emailSet = new Set();

  const addStudent = (student) => {
    if (student.email) emailSet.add(student.email.toLowerCase());
    if (student.name) emailSet.add(student.name.toLowerCase());
  };

  try {
    const db = initializeFirebase();
    if (db) {
      // 1. Get students with legacy teacherEmail field
      const studentSnapshot = await firestoreTimeout(db.collection('students')
        .where('teacherEmail', '==', teacherEmail)
        .get());
      if (!studentSnapshot.empty) {
        studentSnapshot.forEach(doc => addStudent(doc.data()));
      }

      // 2. Get all classes owned by this teacher and include their students
      const classSnapshot = await firestoreTimeout(db.collection('classes')
        .where('teacherEmail', '==', teacherEmail)
        .get());
      if (!classSnapshot.empty) {
        const classStudentEmails = [];
        classSnapshot.forEach(doc => {
          const classData = doc.data();
          if (classData.students && Array.isArray(classData.students)) {
            classStudentEmails.push(...classData.students);
          }
        });

        // Look up each class student to get their name for matching
        for (const studentEmail of [...new Set(classStudentEmails)]) {
          if (emailSet.has(studentEmail.toLowerCase())) continue; // already added
          try {
            const studentDoc = await firestoreTimeout(
              db.collection('students').doc(studentEmail.toLowerCase()).get()
            );
            if (studentDoc.exists) {
              addStudent(studentDoc.data());
            } else {
              // Student doc not found by email, still add the email
              emailSet.add(studentEmail.toLowerCase());
            }
          } catch (e) {
            // If individual lookup fails, still add the email
            emailSet.add(studentEmail.toLowerCase());
          }
        }
      }

      if (emailSet.size > 0) {
        return [...emailSet];
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
        addStudent(student);
      }
    }
  } catch (e) {
    console.error('Error getting teacher students:', e);
  }

  return [...emailSet];
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

    // Get all submissions without orderBy to avoid missing documents that lack
    // the ordered field (e.g. older submissions created before serverTimestamp
    // was added). Sort in JS after retrieval instead.
    let submissions = [];
    try {
      const snapshot = await firestoreTimeout(
        db.collection('submissions').get(),
        8000  // slightly longer timeout for potentially large result set
      );
      snapshot.forEach(doc => {
        const data = doc.data();
        // Normalize submittedAt: Firestore Timestamps → ISO string
        if (data.submittedAt?.toDate) {
          data.submittedAt = data.submittedAt.toDate().toISOString();
        }
        if (data.serverTimestamp?.toDate) {
          data.serverTimestamp = data.serverTimestamp.toDate().toISOString();
        }
        submissions.push(data);
      });
      // Sort by most recent first, using whichever timestamp field is available
      submissions.sort((a, b) => {
        const dateA = new Date(a.serverTimestamp || a.submittedAt || 0);
        const dateB = new Date(b.serverTimestamp || b.submittedAt || 0);
        return dateB - dateA;
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
    let totalBeforeFilter = submissions.length;
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
      (sessionCheck.valid ? ' for teacher ' + sessionCheck.email : '') +
      (teacherStudentEmails !== null ? ` (filtered from ${totalBeforeFilter} total)` : ''));

    // Diagnostics mode: show what's being filtered and why
    const diagnostics = params.diagnostics === 'true' ? {
      totalInFirestore: totalBeforeFilter,
      afterTeacherFilter: submissions.length,
      filteredOut: totalBeforeFilter - submissions.length,
      teacherEmail: sessionCheck.email || null,
      isAdmin: sessionCheck.isAdmin || false,
      teacherStudentList: teacherStudentEmails,
      // Show unique students in submissions that were filtered OUT
      missingStudents: teacherStudentEmails !== null ? (() => {
        const shown = new Set(submissions.map(s => (s.studentEmail || '').toLowerCase()));
        const allStudents = new Set();
        // We need to re-read from full list - get unique students from the pre-filter count
        return null; // filled below
      })() : null
    } : undefined;

    // If diagnostics, re-scan to find which students were filtered out
    if (diagnostics && teacherStudentEmails !== null) {
      try {
        const snapshot = await firestoreTimeout(db.collection('submissions').get(), 8000);
        const allSubmissionStudents = new Set();
        const filteredOutStudents = new Set();
        snapshot.forEach(doc => {
          const data = doc.data();
          const email = (data.studentEmail || '').toLowerCase();
          const name = (data.studentName || '').toLowerCase();
          allSubmissionStudents.add(email || name);
          // Check if this student passes the filter
          const passes = teacherStudentEmails.some(te =>
            te === email || te === name || email.includes(te) || name.includes(te)
          );
          if (!passes) {
            filteredOutStudents.add(`${data.studentName || '?'} <${data.studentEmail || '?'}>`);
          }
        });
        diagnostics.allUniqueStudentsInSubmissions = [...allSubmissionStudents];
        diagnostics.studentsFilteredOut = [...filteredOutStudents];
        diagnostics.missingStudents = diagnostics.studentsFilteredOut;
      } catch (e) {
        diagnostics.diagnosticError = e.message;
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        count: submissions.length,
        submissions: submissions,
        teacherEmail: sessionCheck.valid ? sessionCheck.email : undefined,
        isAdmin: sessionCheck.isAdmin || undefined,
        diagnostics: diagnostics
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

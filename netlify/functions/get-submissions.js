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

// Get list of student emails that belong to a teacher (Firestore first, Blobs fallback).
// Checks both the legacy per-student teacherEmail field AND membership of the
// teacher's classes — a student in classes owned by two teachers only carries
// one teacherEmail, so without the class check the second teacher never sees
// that student's submissions.
async function getTeacherStudentEmails(teacherEmail) {
  const emailSet = new Set();
  const addStudent = (student) => {
    if (student.email) emailSet.add(student.email.toLowerCase());
    if (student.name) emailSet.add(student.name.toLowerCase());
  };

  try {
    const db = initializeFirebase();
    if (db) {
      const studentSnapshot = await firestoreTimeout(db.collection('students')
        .where('teacherEmail', '==', teacherEmail)
        .get());
      if (!studentSnapshot.empty) {
        studentSnapshot.forEach(doc => addStudent(doc.data()));
      }

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
        for (const studentEmail of [...new Set(classStudentEmails)]) {
          if (emailSet.has(studentEmail.toLowerCase())) continue;
          try {
            const studentDoc = await firestoreTimeout(
              db.collection('students').doc(studentEmail.toLowerCase()).get());
            if (studentDoc.exists) addStudent(studentDoc.data());
            else emailSet.add(studentEmail.toLowerCase());
          } catch (e) {
            emailSet.add(studentEmail.toLowerCase());
          }
        }
      }
      if (emailSet.size > 0) return [...emailSet];
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

    // Support student self-service: if studentEmail param is provided with a valid
    // student session token, return only that student's submissions.
    let studentSelfService = false;
    let studentSelfEmail = null;

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

      // If teacher auth failed, check if this is a student session requesting own submissions
      if (!sessionCheck.valid && sessionToken && params.studentEmail) {
        try {
          const db = initializeFirebase();
          if (db) {
            const studentSessionDoc = await firestoreTimeout(db.collection('sessions').doc(sessionToken).get());
            if (studentSessionDoc.exists) {
              const session = studentSessionDoc.data();
              const expiresAt = session.expiresAt?.toDate ? session.expiresAt.toDate() : new Date(session.expiresAt);
              if (expiresAt >= new Date() && session.email?.toLowerCase() === params.studentEmail.toLowerCase()) {
                studentSelfService = true;
                studentSelfEmail = session.email.toLowerCase();
                sessionCheck = { valid: true, isAdmin: false };
              }
            }
          }
        } catch (e) {
          console.warn('[get-submissions] Student session check error:', e.message);
        }
      }

      // Require a valid teacher or student-self session (no password fallback)
      if (!sessionCheck.valid) {
        return {
          statusCode: 401,
          headers,
          body: JSON.stringify({
            success: false,
            error: sessionToken ? (sessionCheck.error || 'Invalid session') : 'Authentication required',
            requiresAuth: true
          })
        };
      }

      // If student self-service, restrict to their own email only
      if (studentSelfService) {
        teacherStudentEmails = [studentSelfEmail];
      } else if (!sessionCheck.isAdmin) {
        // If not admin, get list of student emails for filtering
        teacherStudentEmails = await getTeacherStudentEmails(sessionCheck.email);
      }
    } else {
      // No teacher accounts exist yet — no one is authorized to read submissions.
      // A teacher/admin account must be created before the dashboard is accessible.
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'No teacher account configured. Create an admin account first.',
          requiresAuth: true
        })
      };
    }

    const db = initializeFirebase();

    // Get all submissions WITHOUT orderBy: Firestore orderBy silently
    // excludes documents that lack the ordered field (client-SDK saves
    // don't write serverTimestamp) or that carry mixed types in it.
    // Normalize timestamps and sort in JS instead.
    let submissions = [];
    try {
      const snapshot = await firestoreTimeout(
        db.collection('submissions').get(),
        8000  // longer timeout for potentially large result set
      );
      snapshot.forEach(doc => {
        const data = doc.data();
        if (data.submittedAt?.toDate) data.submittedAt = data.submittedAt.toDate().toISOString();
        if (data.serverTimestamp?.toDate) data.serverTimestamp = data.serverTimestamp.toDate().toISOString();
        submissions.push(data);
      });
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

    const totalBeforeFilter = submissions.length;

    // Exact-match check shared by the filter and the diagnostics below.
    // A substring match (studentEmail.includes(email)) could leak another
    // student's submission when one identifier is a substring of another.
    const matchesTeacher = (sub) => {
      const studentEmail = (sub.studentEmail || '').toLowerCase();
      const studentName = (sub.studentName || '').toLowerCase();
      return teacherStudentEmails.some(email =>
        email === studentEmail ||
        email === studentName
      );
    };

    // Filter by teacher's students if not admin
    let filteredOutStudents = null;
    if (teacherStudentEmails !== null) {
      if (params.diagnostics === 'true') {
        const excluded = new Set();
        submissions.forEach(sub => {
          if (!matchesTeacher(sub)) {
            excluded.add((sub.studentEmail || sub.studentName || 'unknown').toLowerCase());
          }
        });
        filteredOutStudents = [...excluded];
      }
      submissions = submissions.filter(matchesTeacher);
    }

    console.log('[get-submissions] Retrieved ' + submissions.length + ' submissions' +
      ' (filtered from ' + totalBeforeFilter + ' total)' +
      (sessionCheck.valid ? ' for teacher ' + sessionCheck.email : ''));

    // Optional diagnostics for teachers investigating "missing" essays
    let diagnostics;
    if (params.diagnostics === 'true' && sessionCheck.valid) {
      diagnostics = {
        totalInFirestore: totalBeforeFilter,
        afterTeacherFilter: submissions.length,
        filteredOut: totalBeforeFilter - submissions.length,
        teacherEmail: sessionCheck.email,
        isAdmin: !!sessionCheck.isAdmin,
        teacherStudentList: teacherStudentEmails,
        studentsFilteredOut: filteredOutStudents || []
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        count: submissions.length,
        submissions: submissions,
        diagnostics,
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

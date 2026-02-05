// Migration function: Create Firebase Auth users from existing students/teachers
// This allows sendPasswordResetEmail to work for all users
// Run once by an admin to migrate existing users

const { getStore, connectLambda } = require('@netlify/blobs');
const { initializeFirebase, getAuth } = require('./firebase-helper');

// Verify admin session
async function verifyAdminSession(sessionToken) {
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
        if (teacher.role !== 'admin') {
          return { valid: false, error: 'Admin access required' };
        }

        return { valid: true, email: session.email };
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
    if (!teacher || teacher.role !== 'admin') {
      return { valid: false, error: 'Admin access required' };
    }

    return { valid: true, email: session.email };
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

// Generate a temporary password for users who don't have importable hashes
function generateTempPassword(length = 16) {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789!@#$%';
  let password = '';
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  for (let i = 0; i < length; i++) {
    password += chars[array[i] % chars.length];
  }
  return password;
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

  // Verify admin session
  const sessionToken = getSessionToken(event);
  const authResult = await verifyAdminSession(sessionToken);
  if (!authResult.valid) {
    return {
      statusCode: 403,
      headers,
      body: JSON.stringify({ success: false, error: authResult.error })
    };
  }

  try {
    const auth = getAuth();
    const db = initializeFirebase();
    const studentsStore = getStore("students");
    const classesStore = getStore("classes");

    const results = {
      students: { created: 0, skipped: 0, errors: [], found: 0, fromClasses: 0 },
      teachers: { created: 0, skipped: 0, errors: [], found: 0 }
    };

    // Collect all unique student emails from multiple sources
    const allStudentEmails = new Map(); // email -> { name, source }

    // Source 1: Netlify Blobs students store
    try {
      const listResult = await studentsStore.list();
      const blobs = listResult.blobs || [];
      console.log('Found', blobs.length, 'students in Netlify Blobs');

      for (const blob of blobs) {
        try {
          const student = await studentsStore.get(blob.key, { type: 'json' });
          if (!student || !student.email) continue;
          const email = student.email.trim().toLowerCase();
          if (!allStudentEmails.has(email)) {
            allStudentEmails.set(email, { name: student.name, source: 'blobs' });
          }
        } catch (err) {
          console.error('Error reading student blob:', blob.key, err);
        }
      }
    } catch (e) {
      console.error('Error listing students from Blobs:', e);
    }

    // Source 2: Firestore students collection
    try {
      const studentsSnapshot = await db.collection('students').get();
      console.log('Found', studentsSnapshot.docs.length, 'students in Firestore');

      for (const doc of studentsSnapshot.docs) {
        const student = doc.data();
        const email = (student.email || doc.id).trim().toLowerCase();
        if (!allStudentEmails.has(email)) {
          allStudentEmails.set(email, { name: student.name, source: 'firestore' });
        }
      }
    } catch (e) {
      console.error('Error reading students from Firestore:', e);
    }

    // Source 3: Netlify Blobs classes - get student emails from class rosters
    try {
      const classListResult = await classesStore.list();
      const classBlobs = classListResult.blobs || [];
      console.log('Found', classBlobs.length, 'classes in Netlify Blobs');

      for (const blob of classBlobs) {
        try {
          const classData = await classesStore.get(blob.key, { type: 'json' });
          if (classData && classData.students && Array.isArray(classData.students)) {
            for (const studentEmail of classData.students) {
              const email = studentEmail.trim().toLowerCase();
              if (!allStudentEmails.has(email)) {
                allStudentEmails.set(email, { name: null, source: 'class-roster' });
                results.students.fromClasses++;
              }
            }
          }
        } catch (err) {
          console.error('Error reading class blob:', blob.key, err);
        }
      }
    } catch (e) {
      console.error('Error listing classes from Blobs:', e);
    }

    // Source 4: Firestore classes - get student emails from class rosters
    try {
      const classesSnapshot = await db.collection('classes').get();
      console.log('Found', classesSnapshot.docs.length, 'classes in Firestore');

      for (const doc of classesSnapshot.docs) {
        const classData = doc.data();
        if (classData && classData.students && Array.isArray(classData.students)) {
          for (const studentEmail of classData.students) {
            const email = studentEmail.trim().toLowerCase();
            if (!allStudentEmails.has(email)) {
              allStudentEmails.set(email, { name: null, source: 'class-roster-firestore' });
              results.students.fromClasses++;
            }
          }
        }
      }
    } catch (e) {
      console.error('Error reading classes from Firestore:', e);
    }

    results.students.found = allStudentEmails.size;
    console.log('Total unique student emails found:', allStudentEmails.size);

    // Now create Firebase Auth users for all collected emails
    for (const [email, info] of allStudentEmails) {
      try {
        // Check if Firebase Auth user already exists
        try {
          await auth.getUserByEmail(email);
          results.students.skipped++;
          continue;
        } catch (e) {
          if (e.code !== 'auth/user-not-found') {
            results.students.errors.push({ email, error: e.message });
            continue;
          }
        }

        // Create Firebase Auth user with a temporary password
        const tempPassword = generateTempPassword();
        await auth.createUser({
          email: email,
          password: tempPassword,
          displayName: info.name || email.split('@')[0]
        });

        results.students.created++;
      } catch (err) {
        results.students.errors.push({ email, error: err.message });
      }
    }

    // Migrate teachers from Firestore
    try {
      const teachersSnapshot = await db.collection('teachers').get();
      results.teachers.found = teachersSnapshot.docs.length;
      console.log('Found', teachersSnapshot.docs.length, 'teachers in Firestore');

      for (const doc of teachersSnapshot.docs) {
        try {
          const teacher = doc.data();
          const email = (teacher.email || doc.id).trim().toLowerCase();

          // Check if Firebase Auth user already exists
          try {
            await auth.getUserByEmail(email);
            results.teachers.skipped++;
            continue;
          } catch (e) {
            if (e.code !== 'auth/user-not-found') {
              results.teachers.errors.push({ email, error: e.message });
              continue;
            }
          }

          // Create Firebase Auth user with temporary password
          const tempPassword = generateTempPassword();
          await auth.createUser({
            email: email,
            password: tempPassword,
            displayName: teacher.name || email.split('@')[0]
          });

          // Mark as migrated
          await db.collection('teachers').doc(doc.id).update({
            firebaseAuthMigrated: true,
            firebaseAuthMigratedAt: new Date().toISOString()
          });

          results.teachers.created++;
        } catch (err) {
          results.teachers.errors.push({ email: doc.id, error: err.message });
        }
      }
    } catch (e) {
      console.error('Error migrating teachers:', e);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Migration completed',
        results,
        summary: {
          studentsFound: results.students.found,
          studentsFromClassRosters: results.students.fromClasses,
          studentsCreated: results.students.created,
          studentsSkipped: results.students.skipped,
          studentErrors: results.students.errors.length,
          teachersFound: results.teachers.found,
          teachersCreated: results.teachers.created,
          teachersSkipped: results.teachers.skipped,
          teacherErrors: results.teachers.errors.length
        },
        // Include error details for debugging
        errors: {
          students: results.students.errors.slice(0, 10), // First 10 errors
          teachers: results.teachers.errors.slice(0, 10)
        },
        note: 'All migrated users have temporary passwords. Use "Send Password Reset Email" to let them set their own passwords.'
      })
    };

  } catch (error) {
    console.error('Migration error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: error.message })
    };
  }
};

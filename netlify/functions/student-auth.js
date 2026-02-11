// Student Authentication Function
// Handles login, password verification, and session management
// Uses Firestore as the sole data store

const nodeCrypto = require('crypto');
const { getAuth, initializeFirebase, firestoreTimeout } = require('./firebase-helper');

// Password hashing with Node.js native PBKDF2 (reliable across all runtimes)
function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = nodeCrypto.randomBytes(16);
    const saltHex = salt.toString('hex');
    nodeCrypto.pbkdf2(password, salt, 100000, 32, 'sha256', (err, derivedKey) => {
      if (err) return reject(err);
      resolve(saltHex + ':' + derivedKey.toString('hex'));
    });
  });
}

// Verify password against stored hash (supports both PBKDF2 and legacy SHA-256)
function verifyPassword(password, storedHash) {
  return new Promise((resolve) => {
    if (!storedHash) return resolve(false);

    // PBKDF2 format: saltHex:hashHex
    if (storedHash.includes(':')) {
      const [saltHex, hashHex] = storedHash.split(':');
      if (!saltHex || !hashHex) return resolve(false);
      const salt = Buffer.from(saltHex, 'hex');
      nodeCrypto.pbkdf2(password, salt, 100000, 32, 'sha256', (err, derivedKey) => {
        if (err) return resolve(false);
        resolve(derivedKey.toString('hex') === hashHex);
      });
      return;
    }

    // Legacy SHA-256 fallback (no colon separator)
    const hash = nodeCrypto.createHash('sha256').update(password).digest('hex');
    resolve(hash === storedHash);
  });
}

// Generate a simple session token
function generateSessionToken() {
  return nodeCrypto.randomBytes(32).toString('hex');
}

// Get class assignments for a student (supports both classIds array and legacy classId)
async function getClassAssignments(studentData, db) {
  let classAssignments = [];
  const classIds = studentData.classIds || (studentData.classId ? [studentData.classId] : []);

  for (const classId of classIds) {
    try {
      const classDoc = await firestoreTimeout(db.collection('classes').doc(classId).get());
      if (classDoc.exists) {
        classAssignments.push(...(classDoc.data().assignedEssays || []));
      }
    } catch (err) {
      console.warn('Class lookup failed for', classId, ':', err.message);
    }
  }
  return classAssignments;
}

// Build student response with assignments
async function buildStudentResponse(studentData, db) {
  const classAssignments = await getClassAssignments(studentData, db);
  const allAssignments = [
    ...new Set([
      ...classAssignments,
      ...(studentData.individualAssignments || [])
    ])
  ];
  const { passwordHash, ...safeStudentData } = studentData;
  return { ...safeStudentData, assignedEssays: allAssignments };
}

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ success: false, error: 'Method not allowed' })
    };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { action, email, password, sessionToken, currentPassword, newPassword } = body;

    const db = initializeFirebase();

    // FIREBASE LOGIN - Verify Firebase ID token and create custom session
    if (action === 'firebaseLogin') {
      const { idToken } = body;
      if (!idToken) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ success: false, error: 'Firebase ID token required' })
        };
      }

      try {
        const auth = getAuth();
        const decodedToken = await auth.verifyIdToken(idToken);
        const emailLower = decodedToken.email.trim().toLowerCase();

        const studentDoc = await firestoreTimeout(db.collection('students').doc(emailLower).get());
        if (!studentDoc.exists) {
          return {
            statusCode: 401,
            headers,
            body: JSON.stringify({
              success: false,
              error: 'Account not found. Please contact your teacher if you believe this is an error.'
            })
          };
        }

        const studentData = studentDoc.data();

        // Create session in Firestore
        const token = generateSessionToken();
        const sessionExpiry = Date.now() + (7 * 24 * 60 * 60 * 1000);
        await firestoreTimeout(db.collection('sessions').doc(token).set({
          email: emailLower,
          createdAt: new Date().toISOString(),
          expiresAt: new Date(sessionExpiry).toISOString(),
          authMethod: 'firebase'
        }));

        // Update last login
        await firestoreTimeout(db.collection('students').doc(emailLower).update({
          lastLogin: new Date().toISOString()
        }));

        const student = await buildStudentResponse(studentData, db);

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, sessionToken: token, student })
        };
      } catch (firebaseError) {
        console.error('Firebase auth error:', firebaseError);
        return {
          statusCode: 401,
          headers,
          body: JSON.stringify({ success: false, error: 'Invalid Firebase token' })
        };
      }
    }

    // VERIFY SESSION - Check if session token is valid
    if (action === 'verify') {
      if (!sessionToken) {
        return {
          statusCode: 401,
          headers,
          body: JSON.stringify({ success: false, error: 'No session token' })
        };
      }

      // Check if this is a Firebase ID token (JWT format: xxx.xxx.xxx)
      if (sessionToken.includes('.')) {
        try {
          const auth = getAuth();
          const decodedToken = await auth.verifyIdToken(sessionToken);
          const emailLower = decodedToken.email.trim().toLowerCase();

          const studentDoc = await firestoreTimeout(db.collection('students').doc(emailLower).get());
          if (!studentDoc.exists) {
            return {
              statusCode: 401,
              headers,
              body: JSON.stringify({ success: false, error: 'Student not found' })
            };
          }

          const student = await buildStudentResponse(studentDoc.data(), db);

          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ success: true, student })
          };
        } catch (firebaseErr) {
          return {
            statusCode: 401,
            headers,
            body: JSON.stringify({ success: false, error: 'Invalid or expired session' })
          };
        }
      }

      // Standard Firestore session check
      const sessionDoc = await firestoreTimeout(db.collection('sessions').doc(sessionToken).get());
      if (!sessionDoc.exists) {
        return {
          statusCode: 401,
          headers,
          body: JSON.stringify({ success: false, error: 'Invalid session' })
        };
      }

      const session = sessionDoc.data();

      // Check expiry
      const expiresAt = session.expiresAt?.toDate ? session.expiresAt.toDate() : new Date(session.expiresAt);
      if (expiresAt < new Date()) {
        await firestoreTimeout(db.collection('sessions').doc(sessionToken).delete());
        return {
          statusCode: 401,
          headers,
          body: JSON.stringify({ success: false, error: 'Session expired' })
        };
      }

      // Get student data
      const studentDoc = await firestoreTimeout(db.collection('students').doc(session.email).get());
      if (!studentDoc.exists) {
        return {
          statusCode: 401,
          headers,
          body: JSON.stringify({ success: false, error: 'Student not found' })
        };
      }

      const student = await buildStudentResponse(studentDoc.data(), db);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, student })
      };
    }

    // LOGIN - Verify email and password
    if (action === 'login') {
      if (!email || !password) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ success: false, error: 'Email and password required' })
        };
      }

      const emailLower = email.trim().toLowerCase();

      const studentDoc = await firestoreTimeout(db.collection('students').doc(emailLower).get());
      if (!studentDoc.exists) {
        return {
          statusCode: 401,
          headers,
          body: JSON.stringify({
            success: false,
            error: 'Account not found. Please contact your teacher if you believe this is an error.'
          })
        };
      }

      const studentData = studentDoc.data();

      // Verify password
      const passwordValid = await verifyPassword(password, studentData.passwordHash);
      if (!passwordValid) {
        return {
          statusCode: 401,
          headers,
          body: JSON.stringify({ success: false, error: 'Incorrect password' })
        };
      }

      // Upgrade legacy SHA-256 hash to PBKDF2 on successful login
      if (!studentData.passwordHash.includes(':')) {
        const upgradedHash = await hashPassword(password);
        await firestoreTimeout(db.collection('students').doc(emailLower).update({ passwordHash: upgradedHash }));
      }

      // Generate session token
      const token = generateSessionToken();
      const sessionExpiry = Date.now() + (7 * 24 * 60 * 60 * 1000); // 7 days

      await firestoreTimeout(db.collection('sessions').doc(token).set({
        email: emailLower,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(sessionExpiry).toISOString()
      }));

      // Update last login
      await firestoreTimeout(db.collection('students').doc(emailLower).update({
        lastLogin: new Date().toISOString()
      }));

      const student = await buildStudentResponse(studentData, db);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, sessionToken: token, student })
      };
    }

    // LOGOUT - Invalidate session
    if (action === 'logout') {
      if (sessionToken) {
        try {
          await firestoreTimeout(db.collection('sessions').doc(sessionToken).delete());
        } catch (e) {
          // Ignore deletion errors
        }
      }
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true })
      };
    }

    // CHANGE PASSWORD
    if (action === 'changePassword') {
      if (!sessionToken || !currentPassword || !newPassword) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ success: false, error: 'Missing required fields' })
        };
      }

      if (newPassword.length < 6) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ success: false, error: 'Password must be at least 6 characters' })
        };
      }

      // Verify session
      const sessionDoc = await firestoreTimeout(db.collection('sessions').doc(sessionToken).get());
      if (!sessionDoc.exists) {
        return {
          statusCode: 401,
          headers,
          body: JSON.stringify({ success: false, error: 'Invalid session' })
        };
      }

      const session = sessionDoc.data();
      const expiresAt = session.expiresAt?.toDate ? session.expiresAt.toDate() : new Date(session.expiresAt);
      if (expiresAt < new Date()) {
        return {
          statusCode: 401,
          headers,
          body: JSON.stringify({ success: false, error: 'Session expired' })
        };
      }

      // Get student and verify current password
      const studentDoc = await firestoreTimeout(db.collection('students').doc(session.email).get());
      if (!studentDoc.exists) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ success: false, error: 'Student not found' })
        };
      }

      const studentData = studentDoc.data();
      const currentValid = await verifyPassword(currentPassword, studentData.passwordHash);
      if (!currentValid) {
        return {
          statusCode: 401,
          headers,
          body: JSON.stringify({ success: false, error: 'Current password is incorrect' })
        };
      }

      // Update password
      const newHash = await hashPassword(newPassword);
      await firestoreTimeout(db.collection('students').doc(session.email).update({
        passwordHash: newHash,
        passwordChangedAt: new Date().toISOString()
      }));

      // Also update Firebase Auth password
      try {
        const auth = getAuth();
        const fbUser = await auth.getUserByEmail(session.email);
        await auth.updateUser(fbUser.uid, { password: newPassword });
      } catch (fbErr) {
        console.error('Failed to update Firebase Auth password:', fbErr.message);
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, message: 'Password updated successfully' })
      };
    }

    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ success: false, error: 'Invalid action' })
    };

  } catch (error) {
    console.error('Auth error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: 'Server error: ' + error.message })
    };
  }
};

// Student Authentication Function
// Handles login, password verification, and session management
// Supports both custom auth and Firebase Auth

const { getStore } = require("@netlify/blobs");
const { getAuth, initializeFirebase } = require('./firebase-helper');

// Password hashing with PBKDF2 (matches manage-students.js)
async function hashPassword(password) {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    256
  );

  const hashArray = Array.from(new Uint8Array(derivedBits));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

  return saltHex + ':' + hashHex;
}

// Legacy SHA-256 hash for backward compatibility with old accounts
async function hashPasswordLegacy(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Verify password against stored hash (supports both PBKDF2 and legacy SHA-256)
async function verifyPassword(password, storedHash) {
  if (!storedHash) return false;

  // PBKDF2 hashes contain a colon separator: saltHex:hashHex
  if (storedHash.includes(':')) {
    const [saltHex, hashHex] = storedHash.split(':');
    const encoder = new TextEncoder();
    const salt = new Uint8Array(saltHex.match(/.{2}/g).map(byte => parseInt(byte, 16)));

    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(password),
      'PBKDF2',
      false,
      ['deriveBits']
    );

    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: 100000,
        hash: 'SHA-256'
      },
      keyMaterial,
      256
    );

    const derivedHashHex = Array.from(new Uint8Array(derivedBits))
      .map(b => b.toString(16).padStart(2, '0')).join('');

    return derivedHashHex === hashHex;
  }

  // Legacy SHA-256 hash (no colon separator)
  const inputHash = await hashPasswordLegacy(password);
  return inputHash === storedHash;
}

// Generate a simple session token
function generateSessionToken() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Try to initialize Blob stores - returns null values if Blobs not configured
function getStores() {
  try {
    return {
      studentsStore: getStore("students"),
      sessionsStore: getStore("sessions"),
      classesStore: getStore("classes")
    };
  } catch (err) {
    console.warn('Blobs not available:', err.message);
    return { studentsStore: null, sessionsStore: null, classesStore: null };
  }
}

// Get student data from Firestore
async function getStudentFromFirestore(emailLower) {
  try {
    const db = initializeFirebase();
    if (!db) return null;
    const studentDoc = await db.collection('students').doc(emailLower).get();
    if (studentDoc.exists) {
      return studentDoc.data();
    }
  } catch (err) {
    console.error('Firestore lookup error:', err.message);
  }
  return null;
}

// Get class assignments for a student (supports both classIds array and legacy classId)
async function getClassAssignments(studentData, classesStore) {
  let classAssignments = [];
  const classIds = studentData.classIds || (studentData.classId ? [studentData.classId] : []);

  for (const classId of classIds) {
    let found = false;
    // Try Blobs first
    if (classesStore) {
      try {
        const classData = await classesStore.get(classId, { type: 'json' });
        if (classData) {
          classAssignments.push(...(classData.assignedEssays || []));
          found = true;
        }
      } catch (err) {
        console.warn('Blobs class lookup failed for', classId, ':', err.message);
      }
    }
    // Fallback to Firestore if Blobs didn't return data
    if (!found) {
      try {
        const db = initializeFirebase();
        if (db) {
          const classDoc = await db.collection('classes').doc(classId).get();
          if (classDoc.exists) {
            classAssignments.push(...(classDoc.data().assignedEssays || []));
          }
        }
      } catch (err) {
        console.warn('Firestore class lookup failed for', classId, ':', err.message);
      }
    }
  }
  return classAssignments;
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

    // Initialize stores lazily - may not be available in all environments
    const { studentsStore, sessionsStore, classesStore } = getStores();

    // FIREBASE LOGIN - Verify Firebase ID token and create custom session
    // This path works even without Blobs by falling back to Firestore
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

        // Look up student - try Blobs first, then Firestore
        let studentData = null;
        if (studentsStore) {
          try {
            studentData = await studentsStore.get(emailLower, { type: 'json' });
          } catch (blobErr) {
            console.warn('Blobs student lookup failed:', blobErr.message);
          }
        }
        if (!studentData) {
          studentData = await getStudentFromFirestore(emailLower);
        }

        if (!studentData) {
          return {
            statusCode: 401,
            headers,
            body: JSON.stringify({
              success: false,
              error: 'Account not found. Please contact your teacher if you believe this is an error.'
            })
          };
        }

        // Generate session token and try to store in Blobs
        let token;
        if (sessionsStore) {
          try {
            token = generateSessionToken();
            const sessionExpiry = Date.now() + (7 * 24 * 60 * 60 * 1000);
            await sessionsStore.setJSON(token, {
              email: emailLower,
              createdAt: new Date().toISOString(),
              expiresAt: new Date(sessionExpiry).toISOString(),
              authMethod: 'firebase'
            });
          } catch (sessionErr) {
            console.warn('Blobs session store failed:', sessionErr.message);
            token = null;
          }
        }
        // If Blobs session failed, use Firebase ID token as session token
        if (!token) {
          token = idToken;
        }

        // Update last login in Blobs if available
        if (studentsStore) {
          try {
            await studentsStore.setJSON(emailLower, {
              ...studentData,
              lastLogin: new Date().toISOString()
            });
          } catch (err) {
            console.warn('Blobs last login update failed:', err.message);
          }
        }

        // Get class assignments
        const classAssignments = await getClassAssignments(studentData, classesStore);

        const allAssignments = [
          ...new Set([
            ...classAssignments,
            ...(studentData.individualAssignments || [])
          ])
        ];

        const { passwordHash, ...safeStudentData } = studentData;

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            sessionToken: token,
            student: {
              ...safeStudentData,
              assignedEssays: allAssignments
            }
          })
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

          // Get student data from Blobs or Firestore
          let studentData = null;
          if (studentsStore) {
            try {
              studentData = await studentsStore.get(emailLower, { type: 'json' });
            } catch (err) {
              console.warn('Blobs lookup failed in verify:', err.message);
            }
          }
          if (!studentData) {
            studentData = await getStudentFromFirestore(emailLower);
          }

          if (!studentData) {
            return {
              statusCode: 401,
              headers,
              body: JSON.stringify({ success: false, error: 'Student not found' })
            };
          }

          const classAssignments = await getClassAssignments(studentData, classesStore);
          const allAssignments = [
            ...new Set([
              ...classAssignments,
              ...(studentData.individualAssignments || [])
            ])
          ];

          const { passwordHash, ...safeStudentData } = studentData;

          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
              success: true,
              student: {
                ...safeStudentData,
                assignedEssays: allAssignments
              }
            })
          };
        } catch (firebaseErr) {
          return {
            statusCode: 401,
            headers,
            body: JSON.stringify({ success: false, error: 'Invalid or expired session' })
          };
        }
      }

      // Standard Blobs session check
      if (!sessionsStore) {
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ success: false, error: 'Session storage unavailable' })
        };
      }

      const session = await sessionsStore.get(sessionToken, { type: 'json' });

      if (!session) {
        return {
          statusCode: 401,
          headers,
          body: JSON.stringify({ success: false, error: 'Invalid session' })
        };
      }

      // Check expiry
      if (new Date(session.expiresAt) < new Date()) {
        await sessionsStore.delete(sessionToken);
        return {
          statusCode: 401,
          headers,
          body: JSON.stringify({ success: false, error: 'Session expired' })
        };
      }

      // Get student data
      const studentData = await studentsStore.get(session.email, { type: 'json' });

      if (!studentData) {
        return {
          statusCode: 401,
          headers,
          body: JSON.stringify({ success: false, error: 'Student not found' })
        };
      }

      // Get class assignments (supports multiple classes)
      const classAssignments = await getClassAssignments(studentData, classesStore);

      const allAssignments = [
        ...new Set([
          ...classAssignments,
          ...(studentData.individualAssignments || [])
        ])
      ];

      const { passwordHash, ...safeStudentData } = studentData;

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          student: {
            ...safeStudentData,
            assignedEssays: allAssignments
          }
        })
      };
    }

    // --- Actions below require Blobs ---
    if (!studentsStore || !sessionsStore) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ success: false, error: 'Storage service unavailable' })
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

      // Look up student
      const studentData = await studentsStore.get(emailLower, { type: 'json' });

      if (!studentData) {
        return {
          statusCode: 401,
          headers,
          body: JSON.stringify({
            success: false,
            error: 'Account not found. Please contact your teacher if you believe this is an error.'
          })
        };
      }

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
      let updatedHash = studentData.passwordHash;
      if (!studentData.passwordHash.includes(':')) {
        updatedHash = await hashPassword(password);
      }

      // Generate session token
      const token = generateSessionToken();
      const sessionExpiry = Date.now() + (7 * 24 * 60 * 60 * 1000); // 7 days

      await sessionsStore.setJSON(token, {
        email: emailLower,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(sessionExpiry).toISOString()
      });

      // Update last login (and upgrade hash if needed)
      await studentsStore.setJSON(emailLower, {
        ...studentData,
        passwordHash: updatedHash,
        lastLogin: new Date().toISOString()
      });

      // Get class info for assignments (supports multiple classes)
      const classAssignments = await getClassAssignments(studentData, classesStore);

      // Combine class and individual assignments
      const allAssignments = [
        ...new Set([
          ...classAssignments,
          ...(studentData.individualAssignments || [])
        ])
      ];

      // Return student data (without password hash)
      const { passwordHash, ...safeStudentData } = studentData;

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          sessionToken: token,
          student: {
            ...safeStudentData,
            assignedEssays: allAssignments
          }
        })
      };
    }

    // LOGOUT - Invalidate session
    if (action === 'logout') {
      if (sessionToken) {
        try {
          await sessionsStore.delete(sessionToken);
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
      const session = await sessionsStore.get(sessionToken, { type: 'json' });
      if (!session || new Date(session.expiresAt) < new Date()) {
        return {
          statusCode: 401,
          headers,
          body: JSON.stringify({ success: false, error: 'Invalid session' })
        };
      }

      // Get student and verify current password
      const studentData = await studentsStore.get(session.email, { type: 'json' });
      if (!studentData) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ success: false, error: 'Student not found' })
        };
      }

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
      await studentsStore.setJSON(session.email, {
        ...studentData,
        passwordHash: newHash,
        passwordChangedAt: new Date().toISOString()
      });

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

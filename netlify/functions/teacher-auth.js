// Teacher Authentication Function (Firebase Version)
// Handles login, registration, session management for teachers
// First teacher to register becomes admin

const nodeCrypto = require('crypto');
const { initializeFirebase, getAuth } = require('./firebase-helper');

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

// Verify password via Firebase Auth REST API (fallback when local hash is stale)
async function verifyPasswordViaFirebaseAuth(email, password) {
  const apiKey = process.env.FIREBASE_API_KEY || process.env.ENV_FIREBASE_API_KEY;
  if (!apiKey) return false;
  try {
    const response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, returnSecureToken: false })
      }
    );
    return response.ok;
  } catch {
    return false;
  }
}

// Generate secure session token
function generateSessionToken() {
  return nodeCrypto.randomBytes(32).toString('hex');
}

// Generate random password for resets
function generatePassword(length = 12) {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let password = '';
  const array = nodeCrypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    password += chars[array[i] % chars.length];
  }
  return password;
}

// Rate limiting storage (in-memory, resets on function cold start)
const failedAttempts = {};
const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_DURATION = 15 * 60 * 1000; // 15 minutes

function checkRateLimit(email) {
  const attempts = failedAttempts[email];
  if (!attempts) return { allowed: true };
  
  if (attempts.count >= LOCKOUT_THRESHOLD) {
    const timeSinceLock = Date.now() - attempts.lastAttempt;
    if (timeSinceLock < LOCKOUT_DURATION) {
      return { 
        allowed: false, 
        remainingMinutes: Math.ceil((LOCKOUT_DURATION - timeSinceLock) / 60000)
      };
    }
    delete failedAttempts[email];
  }
  return { allowed: true };
}

function recordFailedAttempt(email) {
  if (!failedAttempts[email]) {
    failedAttempts[email] = { count: 0, lastAttempt: 0 };
  }
  failedAttempts[email].count++;
  failedAttempts[email].lastAttempt = Date.now();
}

function clearFailedAttempts(email) {
  delete failedAttempts[email];
}

// Helper to verify teacher session
async function verifyTeacherSession(sessionToken, db) {
  if (!sessionToken) {
    return { valid: false, error: 'No session token provided' };
  }
  
  try {
    const sessionDoc = await db.collection('teacherSessions').doc(sessionToken).get();
    
    if (!sessionDoc.exists) {
      return { valid: false, error: 'Invalid session' };
    }
    
    const session = sessionDoc.data();
    
    if (new Date(session.expiresAt) < new Date()) {
      await db.collection('teacherSessions').doc(sessionToken).delete();
      return { valid: false, error: 'Session expired' };
    }
    
    // Get teacher data
    const teacherDoc = await db.collection('teachers').doc(session.email).get();
    if (!teacherDoc.exists) {
      return { valid: false, error: 'Teacher not found' };
    }
    
    const teacher = teacherDoc.data();
    
    return { 
      valid: true, 
      email: session.email, 
      role: teacher.role || 'teacher',
      isAdmin: teacher.role === 'admin',
      teacher: teacher
    };
  } catch (error) {
    console.error('Session verification error:', error);
    return { valid: false, error: 'Session verification failed' };
  }
}

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers };
  }

  if (event.httpMethod !== 'POST' && event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ success: false, error: 'Method not allowed' })
    };
  }

  try {
    const db = initializeFirebase();

    // GET - List teachers (admin only)
    if (event.httpMethod === 'GET') {
      const params = event.queryStringParameters || {};
      const sessionToken = params.sessionToken || event.headers.authorization?.replace('Bearer ', '');
      
      const sessionCheck = await verifyTeacherSession(sessionToken, db);
      
      if (!sessionCheck.valid) {
        return {
          statusCode: 401,
          headers,
          body: JSON.stringify({ success: false, error: sessionCheck.error })
        };
      }
      
      if (!sessionCheck.isAdmin) {
        return {
          statusCode: 403,
          headers,
          body: JSON.stringify({ success: false, error: 'Admin access required' })
        };
      }
      
      // List all teachers
      const teachersSnapshot = await db.collection('teachers').get();
      const teachers = [];
      
      teachersSnapshot.forEach(doc => {
        const teacher = doc.data();
        const { passwordHash, ...safeTeacher } = teacher;
        teachers.push({ ...safeTeacher, email: doc.id });
      });
      
      teachers.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, teachers })
      };
    }

    // POST actions
    const body = JSON.parse(event.body || '{}');
    const { action } = body;

    // ========================================
    // FIREBASE LOGIN (verify Firebase ID token, create custom session)
    // ========================================
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

        // Look up teacher in Firestore
        const teacherDoc = await db.collection('teachers').doc(emailLower).get();

        if (!teacherDoc.exists) {
          return {
            statusCode: 401,
            headers,
            body: JSON.stringify({ success: false, error: 'Teacher account not found' })
          };
        }

        const teacher = teacherDoc.data();

        // Create session
        const sessionToken = generateSessionToken();
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

        await db.collection('teacherSessions').doc(sessionToken).set({
          email: emailLower,
          createdAt: new Date().toISOString(),
          expiresAt,
          authMethod: 'firebase'
        });

        // Update last login
        await db.collection('teachers').doc(emailLower).update({
          lastLogin: new Date().toISOString()
        });

        const { passwordHash, ...safeTeacher } = teacher;

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            sessionToken,
            teacher: { ...safeTeacher, email: emailLower },
            isAdmin: teacher.role === 'admin'
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

    // ========================================
    // CHECK SETUP (public - checks if any teachers exist)
    // ========================================
    if (action === 'checkSetup') {
      const teachersSnapshot = await db.collection('teachers').limit(1).get();
      const teachersExist = !teachersSnapshot.empty;
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ 
          success: true, 
          teachersExist,
          needsSetup: !teachersExist
        })
      };
    }

    // ========================================
    // LOGIN
    // ========================================
    if (action === 'login') {
      const { email, password } = body;
      
      if (!email || !password) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ success: false, error: 'Email and password required' })
        };
      }

      const emailLower = email.trim().toLowerCase();
      
      // Check rate limiting
      const rateCheck = checkRateLimit(emailLower);
      if (!rateCheck.allowed) {
        return {
          statusCode: 429,
          headers,
          body: JSON.stringify({ 
            success: false, 
            error: 'Too many failed attempts. Please try again in ' + rateCheck.remainingMinutes + ' minutes.'
          })
        };
      }
      
      const teacherDoc = await db.collection('teachers').doc(emailLower).get();

      if (!teacherDoc.exists) {
        console.log('Login failed: no teacher document for', emailLower);
        recordFailedAttempt(emailLower);
        return {
          statusCode: 401,
          headers,
          body: JSON.stringify({ success: false, error: 'No account found for this email. Please check your email or contact an administrator.' })
        };
      }

      const teacher = teacherDoc.data();
      let passwordValid = await verifyPassword(password, teacher.passwordHash);

      // If local hash fails, try Firebase Auth as fallback (handles password resets, hash migration)
      if (!passwordValid) {
        console.log('Local hash mismatch for', emailLower, '- trying Firebase Auth fallback');
        passwordValid = await verifyPasswordViaFirebaseAuth(emailLower, password);
        if (passwordValid) {
          // Password correct via Firebase Auth — update the local hash so it works next time
          const newHash = await hashPassword(password);
          await db.collection('teachers').doc(emailLower).update({ passwordHash: newHash });
          console.log('Updated stale password hash for', emailLower);
        }
      }

      if (!passwordValid) {
        console.log('Login failed: password mismatch for', emailLower);
        recordFailedAttempt(emailLower);
        return {
          statusCode: 401,
          headers,
          body: JSON.stringify({ success: false, error: 'Incorrect password' })
        };
      }

      clearFailedAttempts(emailLower);
      
      // Create session
      const sessionToken = generateSessionToken();
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours
      
      await db.collection('teacherSessions').doc(sessionToken).set({
        email: emailLower,
        createdAt: new Date().toISOString(),
        expiresAt
      });
      
      // Update last login
      await db.collection('teachers').doc(emailLower).update({
        lastLogin: new Date().toISOString()
      });
      
      const { passwordHash, ...safeTeacher } = teacher;
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          sessionToken,
          teacher: { ...safeTeacher, email: emailLower },
          isAdmin: teacher.role === 'admin'
        })
      };
    }

    // ========================================
    // REGISTER (First teacher becomes admin)
    // ========================================
    if (action === 'register') {
      const { email, password, name, sessionToken, role } = body;
      
      if (!email || !password || !name) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ success: false, error: 'Email, password, and name required' })
        };
      }

      if (password.length < 8) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ success: false, error: 'Password must be at least 8 characters' })
        };
      }

      const emailLower = email.trim().toLowerCase();
      
      // Check if any teachers exist
      const teachersSnapshot = await db.collection('teachers').limit(1).get();
      const isFirstTeacher = teachersSnapshot.empty;
      
      // If teachers exist, require admin authentication
      if (!isFirstTeacher) {
        if (!sessionToken) {
          return {
            statusCode: 401,
            headers,
            body: JSON.stringify({ success: false, error: 'Admin authentication required to create new teachers' })
          };
        }
        
        const sessionCheck = await verifyTeacherSession(sessionToken, db);
        
        if (!sessionCheck.valid) {
          return {
            statusCode: 401,
            headers,
            body: JSON.stringify({ success: false, error: sessionCheck.error })
          };
        }
        
        if (!sessionCheck.isAdmin) {
          return {
            statusCode: 403,
            headers,
            body: JSON.stringify({ success: false, error: 'Only administrators can create new teacher accounts' })
          };
        }
      }
      
      // Check if email already exists
      const existingDoc = await db.collection('teachers').doc(emailLower).get();
      if (existingDoc.exists) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ success: false, error: 'A teacher with this email already exists' })
        };
      }
      
      // Hash password and create teacher
      const passwordHash = await hashPassword(password);
      
      const newTeacher = {
        name: name.trim(),
        email: emailLower,
        role: isFirstTeacher ? 'admin' : (role || 'teacher'),
        passwordHash,
        createdAt: new Date().toISOString(),
        createdBy: isFirstTeacher ? 'self' : (sessionToken ? 'admin' : 'unknown')
      };
      
      await db.collection('teachers').doc(emailLower).set(newTeacher);

      // Also create Firebase Auth user (non-blocking)
      try {
        const auth = getAuth();
        try {
          await auth.getUserByEmail(emailLower);
          // User already exists, update password
          const fbUser = await auth.getUserByEmail(emailLower);
          await auth.updateUser(fbUser.uid, { password, displayName: name.trim() });
        } catch (e) {
          if (e.code === 'auth/user-not-found') {
            await auth.createUser({
              email: emailLower,
              password: password,
              displayName: name.trim()
            });
          }
        }
      } catch (fbErr) {
        console.error('Failed to create Firebase Auth user for teacher:', fbErr.message);
      }

      const { passwordHash: _, ...safeTeacher } = newTeacher;

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          teacher: safeTeacher,
          isFirstTeacher,
          message: isFirstTeacher
            ? 'Admin account created successfully. You can now log in.'
            : 'Teacher account created successfully.'
        })
      };
    }

    // ========================================
    // VERIFY SESSION
    // ========================================
    if (action === 'verify') {
      const { sessionToken } = body;
      
      const sessionCheck = await verifyTeacherSession(sessionToken, db);
      
      if (!sessionCheck.valid) {
        return {
          statusCode: 401,
          headers,
          body: JSON.stringify({ success: false, error: sessionCheck.error })
        };
      }
      
      const { passwordHash, ...safeTeacher } = sessionCheck.teacher;
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          teacher: { ...safeTeacher, email: sessionCheck.email },
          isAdmin: sessionCheck.isAdmin
        })
      };
    }

    // ========================================
    // LOGOUT
    // ========================================
    if (action === 'logout') {
      const { sessionToken } = body;
      
      if (sessionToken) {
        try {
          await db.collection('teacherSessions').doc(sessionToken).delete();
        } catch (e) {
          // Ignore deletion errors
        }
      }
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, message: 'Logged out successfully' })
      };
    }

    // ========================================
    // RESET PASSWORD (admin only)
    // ========================================
    if (action === 'resetPassword') {
      const { sessionToken, teacherEmail } = body;
      
      const sessionCheck = await verifyTeacherSession(sessionToken, db);
      
      if (!sessionCheck.valid) {
        return {
          statusCode: 401,
          headers,
          body: JSON.stringify({ success: false, error: sessionCheck.error })
        };
      }
      
      if (!sessionCheck.isAdmin) {
        return {
          statusCode: 403,
          headers,
          body: JSON.stringify({ success: false, error: 'Only administrators can reset passwords' })
        };
      }

      if (!teacherEmail) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ success: false, error: 'Teacher email required' })
        };
      }

      const emailLower = teacherEmail.trim().toLowerCase();
      const teacherDoc = await db.collection('teachers').doc(emailLower).get();
      
      if (!teacherDoc.exists) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ success: false, error: 'Teacher not found' })
        };
      }

      const newPassword = generatePassword();
      const passwordHash = await hashPassword(newPassword);

      await db.collection('teachers').doc(emailLower).update({
        passwordHash,
        passwordResetAt: new Date().toISOString(),
        passwordResetBy: sessionCheck.email
      });

      // Also update Firebase Auth password
      try {
        const auth = getAuth();
        const fbUser = await auth.getUserByEmail(emailLower);
        await auth.updateUser(fbUser.uid, { password: newPassword });
      } catch (fbErr) {
        console.error('Failed to update Firebase Auth password for teacher:', fbErr.message);
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          newPassword,
          message: 'Password reset successfully'
        })
      };
    }

    // ========================================
    // CHANGE OWN PASSWORD
    // ========================================
    if (action === 'changePassword') {
      const { sessionToken, currentPassword, newPassword } = body;
      
      const sessionCheck = await verifyTeacherSession(sessionToken, db);
      
      if (!sessionCheck.valid) {
        return {
          statusCode: 401,
          headers,
          body: JSON.stringify({ success: false, error: sessionCheck.error })
        };
      }

      if (!currentPassword || !newPassword) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ success: false, error: 'Current and new password required' })
        };
      }

      if (newPassword.length < 8) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ success: false, error: 'New password must be at least 8 characters' })
        };
      }

      const teacher = sessionCheck.teacher;
      const currentValid = await verifyPassword(currentPassword, teacher.passwordHash);
      
      if (!currentValid) {
        return {
          statusCode: 401,
          headers,
          body: JSON.stringify({ success: false, error: 'Current password is incorrect' })
        };
      }

      const passwordHash = await hashPassword(newPassword);

      await db.collection('teachers').doc(sessionCheck.email).update({
        passwordHash,
        passwordChangedAt: new Date().toISOString()
      });

      // Also update Firebase Auth password
      try {
        const auth = getAuth();
        const fbUser = await auth.getUserByEmail(sessionCheck.email);
        await auth.updateUser(fbUser.uid, { password: newPassword });
      } catch (fbErr) {
        console.error('Failed to update Firebase Auth password:', fbErr.message);
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, message: 'Password changed successfully' })
      };
    }

    // ========================================
    // DELETE TEACHER (admin only)
    // ========================================
    if (action === 'deleteTeacher') {
      const { sessionToken, teacherEmail } = body;
      
      const sessionCheck = await verifyTeacherSession(sessionToken, db);
      
      if (!sessionCheck.valid) {
        return {
          statusCode: 401,
          headers,
          body: JSON.stringify({ success: false, error: sessionCheck.error })
        };
      }
      
      if (!sessionCheck.isAdmin) {
        return {
          statusCode: 403,
          headers,
          body: JSON.stringify({ success: false, error: 'Only administrators can delete teacher accounts' })
        };
      }

      if (!teacherEmail) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ success: false, error: 'Teacher email required' })
        };
      }

      const emailLower = teacherEmail.trim().toLowerCase();
      
      // Prevent deleting yourself
      if (emailLower === sessionCheck.email) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ success: false, error: 'You cannot delete your own account' })
        };
      }

      const teacherDoc = await db.collection('teachers').doc(emailLower).get();
      
      if (!teacherDoc.exists) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ success: false, error: 'Teacher not found' })
        };
      }

      // Delete the teacher
      await db.collection('teachers').doc(emailLower).delete();

      // Also delete Firebase Auth user
      try {
        const auth = getAuth();
        const fbUser = await auth.getUserByEmail(emailLower);
        await auth.deleteUser(fbUser.uid);
      } catch (fbErr) {
        console.error('Failed to delete Firebase Auth user:', fbErr.message);
      }

      // Clear teacherEmail on their classes
      const classesSnapshot = await db.collection('classes').where('teacherEmail', '==', emailLower).get();
      const batch = db.batch();
      
      classesSnapshot.forEach(doc => {
        batch.update(doc.ref, {
          teacher: null,
          teacherEmail: null,
          updatedAt: new Date().toISOString()
        });
      });
      
      await batch.commit();

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, message: 'Teacher account deleted' })
      };
    }

    // ========================================
    // UPDATE TEACHER ROLE (admin only)
    // ========================================
    if (action === 'updateRole') {
      const { sessionToken, teacherEmail, newRole } = body;
      
      const sessionCheck = await verifyTeacherSession(sessionToken, db);
      
      if (!sessionCheck.valid) {
        return {
          statusCode: 401,
          headers,
          body: JSON.stringify({ success: false, error: sessionCheck.error })
        };
      }
      
      if (!sessionCheck.isAdmin) {
        return {
          statusCode: 403,
          headers,
          body: JSON.stringify({ success: false, error: 'Only administrators can change roles' })
        };
      }

      if (!teacherEmail || !newRole) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ success: false, error: 'Teacher email and new role required' })
        };
      }

      if (!['admin', 'teacher'].includes(newRole)) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ success: false, error: 'Invalid role. Must be "admin" or "teacher"' })
        };
      }

      const emailLower = teacherEmail.trim().toLowerCase();
      
      // Prevent demoting yourself
      if (emailLower === sessionCheck.email && newRole !== 'admin') {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ success: false, error: 'You cannot demote yourself' })
        };
      }

      const teacherDoc = await db.collection('teachers').doc(emailLower).get();
      
      if (!teacherDoc.exists) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ success: false, error: 'Teacher not found' })
        };
      }

      await db.collection('teachers').doc(emailLower).update({
        role: newRole,
        roleUpdatedAt: new Date().toISOString(),
        roleUpdatedBy: sessionCheck.email
      });

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, message: 'Role updated successfully' })
      };
    }

    // ========================================
    // ASSIGN CLASSES TO TEACHER (admin only)
    // ========================================
    if (action === 'assignClasses') {
      const { sessionToken, teacherEmail, classIds } = body;
      
      const sessionCheck = await verifyTeacherSession(sessionToken, db);
      
      if (!sessionCheck.valid) {
        return {
          statusCode: 401,
          headers,
          body: JSON.stringify({ success: false, error: sessionCheck.error })
        };
      }
      
      if (!sessionCheck.isAdmin) {
        return {
          statusCode: 403,
          headers,
          body: JSON.stringify({ success: false, error: 'Only administrators can assign classes' })
        };
      }

      if (!teacherEmail || !Array.isArray(classIds)) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ success: false, error: 'Teacher email and class IDs required' })
        };
      }

      const emailLower = teacherEmail.trim().toLowerCase();
      const teacherDoc = await db.collection('teachers').doc(emailLower).get();
      
      if (!teacherDoc.exists) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ success: false, error: 'Teacher not found' })
        };
      }

      const teacher = teacherDoc.data();
      const results = { assigned: [], notFound: [], errors: [] };

      for (const classId of classIds) {
        try {
          const classDoc = await db.collection('classes').doc(classId).get();
          if (!classDoc.exists) {
            results.notFound.push(classId);
            continue;
          }

          await db.collection('classes').doc(classId).update({
            teacher: teacher.name,
            teacherEmail: emailLower,
            updatedAt: new Date().toISOString()
          });
          results.assigned.push(classId);
        } catch (e) {
          results.errors.push({ classId, error: e.message });
        }
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, results })
      };
    }

    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ success: false, error: 'Invalid action' })
    };

  } catch (error) {
    console.error('Teacher auth error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: 'Server error: ' + error.message })
    };
  }
};

// Export helper for use in other functions
module.exports.verifyTeacherSession = verifyTeacherSession;

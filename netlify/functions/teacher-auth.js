// Teacher Authentication Function
// Handles login, registration, session management for teachers
// First teacher to register becomes admin

const { getStore } = require("@netlify/blobs");

// Use Web Crypto for password hashing (bcrypt alternative for edge functions)
async function hashPassword(password) {
  const encoder = new TextEncoder();
  // Create a salt
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');
  
  // Hash password with salt using PBKDF2
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
  
  // Return salt:hash format
  return saltHex + ':' + hashHex;
}

async function verifyPassword(password, storedHash) {
  const encoder = new TextEncoder();
  const [saltHex, hashHex] = storedHash.split(':');
  
  if (!saltHex || !hashHex) {
    return false;
  }
  
  // Convert salt back to Uint8Array
  const salt = new Uint8Array(saltHex.match(/.{2}/g).map(byte => parseInt(byte, 16)));
  
  // Hash the input password with the same salt
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
  const computedHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  
  return computedHash === hashHex;
}

// Generate secure session token
function generateSessionToken() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Generate random password for resets
function generatePassword(length = 12) {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let password = '';
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
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

// Helper to verify teacher session (exported for use in other functions)
async function verifyTeacherSession(sessionToken, teacherSessionsStore, teachersStore) {
  if (!sessionToken) {
    return { valid: false, error: 'No session token provided' };
  }
  
  try {
    const session = await teacherSessionsStore.get(sessionToken, { type: 'json' });
    
    if (!session) {
      return { valid: false, error: 'Invalid session' };
    }
    
    if (new Date(session.expiresAt) < new Date()) {
      await teacherSessionsStore.delete(sessionToken);
      return { valid: false, error: 'Session expired' };
    }
    
    // Get teacher data
    const teacher = await teachersStore.get(session.email, { type: 'json' });
    if (!teacher) {
      return { valid: false, error: 'Teacher not found' };
    }
    
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
    const teachersStore = getStore("teachers");
    const teacherSessionsStore = getStore("teacher-sessions");
    const classesStore = getStore("classes");

    // GET - List teachers (admin only)
    if (event.httpMethod === 'GET') {
      const params = event.queryStringParameters || {};
      const sessionToken = params.sessionToken || event.headers.authorization?.replace('Bearer ', '');
      
      const sessionCheck = await verifyTeacherSession(sessionToken, teacherSessionsStore, teachersStore);
      
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
      const teachers = [];
      for await (const blob of teachersStore.list()) {
        try {
          const teacher = await teachersStore.get(blob.key, { type: 'json' });
          if (teacher) {
            const { passwordHash, ...safeTeacher } = teacher;
            teachers.push(safeTeacher);
          }
        } catch (e) {
          console.error('Error reading teacher:', blob.key, e);
        }
      }
      
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
      
      const teacher = await teachersStore.get(emailLower, { type: 'json' });
      
      if (!teacher) {
        recordFailedAttempt(emailLower);
        return {
          statusCode: 401,
          headers,
          body: JSON.stringify({ success: false, error: 'Invalid email or password' })
        };
      }

      const passwordValid = await verifyPassword(password, teacher.passwordHash);
      
      if (!passwordValid) {
        recordFailedAttempt(emailLower);
        return {
          statusCode: 401,
          headers,
          body: JSON.stringify({ success: false, error: 'Invalid email or password' })
        };
      }

      // Clear failed attempts on successful login
      clearFailedAttempts(emailLower);

      // Generate session token
      const token = generateSessionToken();
      const sessionExpiry = Date.now() + (24 * 60 * 60 * 1000); // 24 hours
      
      await teacherSessionsStore.setJSON(token, {
        email: emailLower,
        role: teacher.role || 'teacher',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(sessionExpiry).toISOString()
      });

      // Update last login
      await teachersStore.setJSON(emailLower, {
        ...teacher,
        lastLogin: new Date().toISOString()
      });

      const { passwordHash, ...safeTeacher } = teacher;
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          sessionToken: token,
          teacher: safeTeacher
        })
      };
    }

    // ========================================
    // VERIFY SESSION
    // ========================================
    if (action === 'verify') {
      const { sessionToken } = body;
      
      const sessionCheck = await verifyTeacherSession(sessionToken, teacherSessionsStore, teachersStore);
      
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
          teacher: safeTeacher,
          role: sessionCheck.role,
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
          await teacherSessionsStore.delete(sessionToken);
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

    // ========================================
    // REGISTER (admin only, or first teacher becomes admin)
    // ========================================
    if (action === 'register') {
      const { sessionToken, email, password, name, role } = body;
      
      // Check if any teachers exist
      const allTeachers = [];
      for await (const blob of teachersStore.list()) {
        allTeachers.push(blob.key);
      }
      
      const isFirstTeacher = allTeachers.length === 0;
      
      // If not first teacher, require admin session
      if (!isFirstTeacher) {
        const sessionCheck = await verifyTeacherSession(sessionToken, teacherSessionsStore, teachersStore);
        
        if (!sessionCheck.valid) {
          return {
            statusCode: 401,
            headers,
            body: JSON.stringify({ success: false, error: 'Admin authentication required' })
          };
        }
        
        if (!sessionCheck.isAdmin) {
          return {
            statusCode: 403,
            headers,
            body: JSON.stringify({ success: false, error: 'Only administrators can create teacher accounts' })
          };
        }
      }

      // Validate input
      if (!email || !password || !name) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ success: false, error: 'Email, password, and name are required' })
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
      
      // Check if teacher already exists
      const existing = await teachersStore.get(emailLower, { type: 'json' });
      if (existing) {
        return {
          statusCode: 409,
          headers,
          body: JSON.stringify({ success: false, error: 'A teacher with this email already exists' })
        };
      }

      const passwordHash = await hashPassword(password);
      
      const teacherData = {
        email: emailLower,
        name: name.trim(),
        role: isFirstTeacher ? 'admin' : (role || 'teacher'),
        passwordHash,
        createdAt: new Date().toISOString(),
        lastLogin: null
      };

      await teachersStore.setJSON(emailLower, teacherData);
      
      const { passwordHash: _, ...safeTeacher } = teacherData;
      
      return {
        statusCode: 201,
        headers,
        body: JSON.stringify({ 
          success: true, 
          teacher: safeTeacher,
          message: isFirstTeacher ? 'Admin account created successfully' : 'Teacher account created successfully',
          isFirstTeacher
        })
      };
    }

    // ========================================
    // RESET PASSWORD (admin only)
    // ========================================
    if (action === 'resetPassword') {
      const { sessionToken, teacherEmail } = body;
      
      const sessionCheck = await verifyTeacherSession(sessionToken, teacherSessionsStore, teachersStore);
      
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
      const teacher = await teachersStore.get(emailLower, { type: 'json' });
      
      if (!teacher) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ success: false, error: 'Teacher not found' })
        };
      }

      const newPassword = generatePassword();
      const passwordHash = await hashPassword(newPassword);

      await teachersStore.setJSON(emailLower, {
        ...teacher,
        passwordHash,
        passwordResetAt: new Date().toISOString(),
        passwordResetBy: sessionCheck.email
      });

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
      
      const sessionCheck = await verifyTeacherSession(sessionToken, teacherSessionsStore, teachersStore);
      
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

      await teachersStore.setJSON(sessionCheck.email, {
        ...teacher,
        passwordHash,
        passwordChangedAt: new Date().toISOString()
      });

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
      
      const sessionCheck = await verifyTeacherSession(sessionToken, teacherSessionsStore, teachersStore);
      
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

      const teacher = await teachersStore.get(emailLower, { type: 'json' });
      
      if (!teacher) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ success: false, error: 'Teacher not found' })
        };
      }

      // Delete the teacher
      await teachersStore.delete(emailLower);

      // Optionally reassign their classes to the admin
      // For now, we just clear the teacherEmail on their classes
      for await (const blob of classesStore.list()) {
        try {
          const classData = await classesStore.get(blob.key, { type: 'json' });
          if (classData && classData.teacherEmail === emailLower) {
            await classesStore.setJSON(blob.key, {
              ...classData,
              teacher: null,
              teacherEmail: null,
              updatedAt: new Date().toISOString()
            });
          }
        } catch (e) {
          console.error('Error updating class:', blob.key, e);
        }
      }

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
      
      const sessionCheck = await verifyTeacherSession(sessionToken, teacherSessionsStore, teachersStore);
      
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

      const teacher = await teachersStore.get(emailLower, { type: 'json' });
      
      if (!teacher) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ success: false, error: 'Teacher not found' })
        };
      }

      await teachersStore.setJSON(emailLower, {
        ...teacher,
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
      
      const sessionCheck = await verifyTeacherSession(sessionToken, teacherSessionsStore, teachersStore);
      
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
      const teacher = await teachersStore.get(emailLower, { type: 'json' });
      
      if (!teacher) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ success: false, error: 'Teacher not found' })
        };
      }

      const results = { assigned: [], notFound: [], errors: [] };

      for (const classId of classIds) {
        try {
          const classData = await classesStore.get(classId, { type: 'json' });
          if (!classData) {
            results.notFound.push(classId);
            continue;
          }

          await classesStore.setJSON(classId, {
            ...classData,
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

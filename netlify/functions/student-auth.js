// Student Authentication Function
// Handles login, password verification, and session management
// Supports both custom auth and Firebase Auth

const { getStore } = require("@netlify/blobs");
const { getAuth } = require('./firebase-helper');

// Simple hash function for passwords
async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function verifyPassword(password, hash) {
  const inputHash = await hashPassword(password);
  return inputHash === hash;
}

// Generate a simple session token
function generateSessionToken() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('');
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
    const studentsStore = getStore("students");
    const sessionsStore = getStore("sessions");
    const classesStore = getStore("classes");

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

        // Look up student in Blobs
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

        // Generate session token
        const token = generateSessionToken();
        const sessionExpiry = Date.now() + (7 * 24 * 60 * 60 * 1000);

        await sessionsStore.setJSON(token, {
          email: emailLower,
          createdAt: new Date().toISOString(),
          expiresAt: new Date(sessionExpiry).toISOString(),
          authMethod: 'firebase'
        });

        // Update last login
        await studentsStore.setJSON(emailLower, {
          ...studentData,
          lastLogin: new Date().toISOString()
        });

        // Get class assignments
        let classAssignments = [];
        if (studentData.classId) {
          const classData = await classesStore.get(studentData.classId, { type: 'json' });
          if (classData) {
            classAssignments = classData.assignedEssays || [];
          }
        }

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

      // Generate session token
      const token = generateSessionToken();
      const sessionExpiry = Date.now() + (7 * 24 * 60 * 60 * 1000); // 7 days
      
      await sessionsStore.setJSON(token, {
        email: emailLower,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(sessionExpiry).toISOString()
      });

      // Update last login
      await studentsStore.setJSON(emailLower, {
        ...studentData,
        lastLogin: new Date().toISOString()
      });

      // Get class info for assignments
      let classAssignments = [];
      if (studentData.classId) {
        const classData = await classesStore.get(studentData.classId, { type: 'json' });
        if (classData) {
          classAssignments = classData.assignedEssays || [];
        }
      }

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

    // VERIFY SESSION - Check if session token is valid
    if (action === 'verify') {
      if (!sessionToken) {
        return {
          statusCode: 401,
          headers,
          body: JSON.stringify({ success: false, error: 'No session token' })
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

      // Get class assignments
      let classAssignments = [];
      if (studentData.classId) {
        const classData = await classesStore.get(studentData.classId, { type: 'json' });
        if (classData) {
          classAssignments = classData.assignedEssays || [];
        }
      }

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

      // Also update Firebase Auth password (non-blocking)
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
      body: JSON.stringify({ success: false, error: 'Server error' })
    };
  }
};

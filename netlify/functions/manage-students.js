// Student Management Function
// Handles CRUD operations for students and CSV import
// Uses Firestore as the sole data store

const nodeCrypto = require('crypto');
const { getAuth, initializeFirebase } = require('./firebase-helper');

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

// Generate a random password (easy to read/type)
function generatePassword(length = 8) {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let password = '';
  const bytes = nodeCrypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    password += chars[bytes[i] % chars.length];
  }
  return password;
}

// Parse CSV content
function parseCSV(csvContent) {
  const lines = csvContent.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]).map(h =>
    h.trim().toLowerCase().replace(/['"]/g, '').replace(/\s+/g, '')
  );

  const students = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;

    const values = parseCSVLine(lines[i]);
    if (values.length < 2) continue;

    const student = {};
    headers.forEach((header, idx) => {
      if (values[idx] !== undefined) {
        student[header] = values[idx].trim();
      }
    });

    if (student.email && (student.name || student.fullname || student.studentname)) {
      student.name = student.name || student.fullname || student.studentname;
      students.push(student);
    }
  }

  return students;
}

// Parse a single CSV line (handles quoted values)
function parseCSVLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim().replace(/^["']|["']$/g, ''));
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current.trim().replace(/^["']|["']$/g, ''));

  return values;
}

// Helper to create or update Firebase Auth user
async function ensureFirebaseAuthUser(email, password, displayName) {
  try {
    const auth = getAuth();
    try {
      const existingUser = await auth.getUserByEmail(email);
      if (password) {
        await auth.updateUser(existingUser.uid, { password });
      }
      return { success: true, existing: true };
    } catch (e) {
      if (e.code === 'auth/user-not-found') {
        await auth.createUser({
          email: email,
          password: password,
          displayName: displayName || email.split('@')[0]
        });
        return { success: true, created: true };
      }
      throw e;
    }
  } catch (error) {
    console.error('Firebase Auth user creation error for', email, ':', error.message);
    return { success: false, error: error.message };
  }
}

// Helper to verify teacher session via Firestore
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
    const expiresAt = session.expiresAt?.toDate ? session.expiresAt.toDate() : new Date(session.expiresAt);
    if (expiresAt < new Date()) {
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

// Extract session token from request
function getSessionToken(event) {
  const authHeader = event.headers.authorization || event.headers.Authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  return event.queryStringParameters?.sessionToken || null;
}

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers };
  }

  try {
    const db = initializeFirebase();

    // Get and verify session token
    const sessionToken = getSessionToken(event);

    // Check if teachers exist in Firestore
    let teachersExist = false;
    const teachersSnapshot = await db.collection('teachers').limit(1).get();
    if (!teachersSnapshot.empty) teachersExist = true;

    let sessionCheck = { valid: false };
    const params = event.queryStringParameters || {};

    if (teachersExist) {
      if (sessionToken) {
        sessionCheck = await verifyTeacherSession(sessionToken, db);
      }

      // Fallback to legacy password auth
      if (!sessionCheck.valid) {
        const expectedPassword = process.env.TEACHER_PASSWORD || 'teacher123';
        if (params.auth === expectedPassword || params.auth === 'teacher123') {
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
    }

    // Helper to check if teacher can access a student
    const canAccessStudent = (studentData) => {
      if (!sessionCheck.valid) return true;
      if (sessionCheck.isAdmin) return true;
      return studentData.teacherEmail === sessionCheck.email;
    };

    // GET - List all students or get a specific student
    if (event.httpMethod === 'GET') {
      const email = event.queryStringParameters?.email;
      const classId = event.queryStringParameters?.classId;
      const teacherEmailFilter = event.queryStringParameters?.teacherEmail;

      if (email) {
        // Get specific student
        const studentDoc = await db.collection('students').doc(email.toLowerCase()).get();
        if (!studentDoc.exists) {
          return {
            statusCode: 404,
            headers,
            body: JSON.stringify({ success: false, error: 'Student not found' })
          };
        }
        const student = { email: studentDoc.id, ...studentDoc.data() };

        if (!canAccessStudent(student)) {
          return {
            statusCode: 403,
            headers,
            body: JSON.stringify({ success: false, error: 'Access denied to this student' })
          };
        }

        const { passwordHash, ...safeStudent } = student;
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, student: safeStudent })
        };
      }

      // List all students from Firestore
      const studentsSnapshot = await db.collection('students').get();
      const students = [];

      studentsSnapshot.forEach(doc => {
        const student = { email: doc.id, ...doc.data() };

        // Apply ownership filter
        if (!canAccessStudent(student)) return;

        // Filter by class if specified (support both classId string and classIds array)
        if (classId) {
          const studentClassIds = student.classIds || (student.classId ? [student.classId] : []);
          if (!studentClassIds.includes(classId)) return;
        }

        // Filter by teacher email if specified
        if (teacherEmailFilter && student.teacherEmail !== teacherEmailFilter.toLowerCase()) return;

        const { passwordHash, ...safeStudent } = student;
        students.push(safeStudent);
      });

      students.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, students })
      };
    }

    // POST - Create student(s) or import CSV
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { action } = body;

      // Single student creation
      if (action === 'create') {
        const { email, name, yearGroup, password } = body;
        const classIds = body.classIds || (body.classId ? [body.classId] : []);

        if (!email || !name) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ success: false, error: 'Email and name required' })
          };
        }

        const emailLower = email.trim().toLowerCase();

        // Check if student already exists
        const existingDoc = await db.collection('students').doc(emailLower).get();
        if (existingDoc.exists) {
          return {
            statusCode: 409,
            headers,
            body: JSON.stringify({ success: false, error: 'A student with this email already exists' })
          };
        }

        // Get class info for each classId
        const classInfos = [];
        const classNames = [];
        const teachers = [];
        for (const cid of classIds) {
          const classDoc = await db.collection('classes').doc(cid).get();
          if (classDoc.exists) {
            const ci = { id: cid, ...classDoc.data() };
            // Check class ownership
            if (sessionCheck.valid && !sessionCheck.isAdmin) {
              if (ci.teacherEmail !== sessionCheck.email) {
                return {
                  statusCode: 403,
                  headers,
                  body: JSON.stringify({ success: false, error: 'Access denied to class: ' + (ci.name || cid) })
                };
              }
            }
            classInfos.push(ci);
            classNames.push(ci.name);
            if (ci.teacher && !teachers.includes(ci.teacher)) teachers.push(ci.teacher);
          }
        }

        // Generate password if not provided
        const studentPassword = password || generatePassword();
        const passwordHash = await hashPassword(studentPassword);

        let teacherName = classInfos[0]?.teacher || null;
        let teacherEmail = classInfos[0]?.teacherEmail || null;

        if (sessionCheck.valid && classInfos.length === 0) {
          teacherName = sessionCheck.name;
          teacherEmail = sessionCheck.email;
        }

        const studentData = {
          email: emailLower,
          name: name.trim(),
          classId: classIds[0] || null,
          classIds: classIds,
          className: classNames[0] || null,
          classNames: classNames,
          yearGroup: yearGroup || classInfos[0]?.yearGroup || null,
          teacher: teacherName,
          teacherEmail: teacherEmail,
          teachers: teachers.length > 0 ? teachers : (teacherName ? [teacherName] : []),
          individualAssignments: [],
          passwordHash,
          createdAt: new Date().toISOString(),
          lastLogin: null
        };

        await db.collection('students').doc(emailLower).set(studentData);

        // Create Firebase Auth user (non-blocking)
        ensureFirebaseAuthUser(emailLower, studentPassword, name.trim()).catch(err => {
          console.error('Failed to create Firebase Auth user for', emailLower, err);
        });

        // Add student to all class rosters
        for (const ci of classInfos) {
          const updatedStudents = [...(ci.students || [])];
          if (!updatedStudents.includes(emailLower)) {
            updatedStudents.push(emailLower);
            await db.collection('classes').doc(ci.id).update({ students: updatedStudents });
          }
        }

        const { passwordHash: _, ...safeStudent } = studentData;

        return {
          statusCode: 201,
          headers,
          body: JSON.stringify({
            success: true,
            student: safeStudent,
            generatedPassword: studentPassword
          })
        };
      }

      // CSV Import
      if (action === 'importCSV') {
        const { csvContent, classId, defaultYearGroup } = body;

        if (!csvContent) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ success: false, error: 'CSV content required' })
          };
        }

        // Get class info if provided
        let classInfo = null;
        if (classId) {
          const classDoc = await db.collection('classes').doc(classId).get();
          if (classDoc.exists) {
            classInfo = { id: classId, ...classDoc.data() };
          }

          // Check class ownership
          if (classInfo && sessionCheck.valid && !sessionCheck.isAdmin) {
            if (classInfo.teacherEmail !== sessionCheck.email) {
              return {
                statusCode: 403,
                headers,
                body: JSON.stringify({ success: false, error: 'Access denied to this class' })
              };
            }
          }
        }

        const parsedStudents = parseCSV(csvContent);

        if (parsedStudents.length === 0) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({
              success: false,
              error: 'No valid students found. CSV must have "email" and "name" columns.'
            })
          };
        }

        const results = { created: [], skipped: [], errors: [] };
        const newClassStudents = classInfo ? [...(classInfo.students || [])] : [];

        let teacherName = classInfo?.teacher || null;
        let teacherEmail = classInfo?.teacherEmail || null;

        if (sessionCheck.valid && !classInfo) {
          teacherName = sessionCheck.name;
          teacherEmail = sessionCheck.email;
        }

        for (const parsed of parsedStudents) {
          try {
            const emailLower = parsed.email.trim().toLowerCase();

            // Check if already exists
            const existingDoc = await db.collection('students').doc(emailLower).get();
            if (existingDoc.exists) {
              results.skipped.push({ email: emailLower, name: parsed.name, reason: 'Already exists' });

              // Still add to class if not already there
              if (classId && !newClassStudents.includes(emailLower)) {
                newClassStudents.push(emailLower);
                const existing = existingDoc.data();
                await db.collection('students').doc(emailLower).update({
                  classId: classId,
                  className: classInfo?.name || existing.className,
                  yearGroup: parsed.yeargroup || parsed.year || defaultYearGroup || classInfo?.yearGroup || existing.yearGroup,
                  teacher: classInfo?.teacher || existing.teacher,
                  teacherEmail: classInfo?.teacherEmail || existing.teacherEmail
                });
              }
              continue;
            }

            // Generate password
            const studentPassword = parsed.password || generatePassword();
            const passwordHash = await hashPassword(studentPassword);

            const studentData = {
              email: emailLower,
              name: parsed.name.trim(),
              classId: classId || null,
              className: classInfo?.name || null,
              yearGroup: parsed.yeargroup || parsed.year || defaultYearGroup || classInfo?.yearGroup || null,
              teacher: teacherName,
              teacherEmail: teacherEmail,
              individualAssignments: [],
              passwordHash,
              createdAt: new Date().toISOString(),
              lastLogin: null
            };

            await db.collection('students').doc(emailLower).set(studentData);

            // Create Firebase Auth user (non-blocking)
            ensureFirebaseAuthUser(emailLower, studentPassword, parsed.name.trim()).catch(err => {
              console.error('Failed to create Firebase Auth user for', emailLower, err);
            });

            if (classId && !newClassStudents.includes(emailLower)) {
              newClassStudents.push(emailLower);
            }

            results.created.push({
              email: emailLower,
              name: parsed.name.trim(),
              password: studentPassword
            });

          } catch (err) {
            results.errors.push({ email: parsed.email, error: err.message });
          }
        }

        // Update class roster
        if (classId && classInfo) {
          await db.collection('classes').doc(classId).update({ students: newClassStudents });
        }

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            results,
            summary: {
              total: parsedStudents.length,
              created: results.created.length,
              skipped: results.skipped.length,
              errors: results.errors.length
            }
          })
        };
      }

      // Reset password (teacher action)
      if (action === 'resetPassword') {
        const { email } = body;

        if (!email) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ success: false, error: 'Email required' })
          };
        }

        const emailLower = email.trim().toLowerCase();
        const existingDoc = await db.collection('students').doc(emailLower).get();

        if (!existingDoc.exists) {
          return {
            statusCode: 404,
            headers,
            body: JSON.stringify({ success: false, error: 'Student not found' })
          };
        }
        const existing = existingDoc.data();

        if (!canAccessStudent(existing)) {
          return {
            statusCode: 403,
            headers,
            body: JSON.stringify({ success: false, error: 'Access denied to this student' })
          };
        }

        const newPassword = generatePassword();
        const passwordHash = await hashPassword(newPassword);

        await db.collection('students').doc(emailLower).update({
          passwordHash,
          passwordResetAt: new Date().toISOString(),
          passwordResetBy: sessionCheck.valid ? sessionCheck.email : 'system'
        });

        // Update Firebase Auth password
        try {
          await ensureFirebaseAuthUser(emailLower, newPassword, existing.name);
        } catch (fbErr) {
          console.error('Failed to update Firebase Auth password for', emailLower, fbErr.message);
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

      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'Invalid action' })
      };
    }

    // PUT - Update student
    if (event.httpMethod === 'PUT') {
      const { email, updates } = JSON.parse(event.body || '{}');

      if (!email) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ success: false, error: 'Email required' })
        };
      }

      const emailLower = email.trim().toLowerCase();
      const existingDoc = await db.collection('students').doc(emailLower).get();

      if (!existingDoc.exists) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ success: false, error: 'Student not found' })
        };
      }
      const existing = existingDoc.data();

      if (!canAccessStudent(existing)) {
        return {
          statusCode: 403,
          headers,
          body: JSON.stringify({ success: false, error: 'Access denied to this student' })
        };
      }

      const updateObj = {};
      const allowedFields = ['name', 'classId', 'yearGroup', 'individualAssignments'];
      for (const field of allowedFields) {
        if (updates[field] !== undefined) {
          updateObj[field] = updates[field];
        }
      }

      // Handle class change
      if (updates.classId !== undefined && updates.classId !== existing.classId) {
        // Check if teacher can access the new class
        if (updates.classId) {
          const newClassDoc = await db.collection('classes').doc(updates.classId).get();
          if (newClassDoc.exists && sessionCheck.valid && !sessionCheck.isAdmin) {
            if (newClassDoc.data().teacherEmail !== sessionCheck.email) {
              return {
                statusCode: 403,
                headers,
                body: JSON.stringify({ success: false, error: 'Access denied to target class' })
              };
            }
          }
        }

        // Remove from old class
        if (existing.classId) {
          const oldClassDoc = await db.collection('classes').doc(existing.classId).get();
          if (oldClassDoc.exists) {
            const oldStudents = (oldClassDoc.data().students || []).filter(s => s !== emailLower);
            await db.collection('classes').doc(existing.classId).update({ students: oldStudents });
          }
        }

        // Add to new class
        if (updates.classId) {
          const newClassDoc = await db.collection('classes').doc(updates.classId).get();
          if (newClassDoc.exists) {
            const newClassData = newClassDoc.data();
            const newStudents = [...(newClassData.students || [])];
            if (!newStudents.includes(emailLower)) {
              newStudents.push(emailLower);
              await db.collection('classes').doc(updates.classId).update({ students: newStudents });
            }
            updateObj.className = newClassData.name;
            updateObj.teacher = newClassData.teacher;
            updateObj.teacherEmail = newClassData.teacherEmail;
            if (!updates.yearGroup) {
              updateObj.yearGroup = newClassData.yearGroup;
            }
          }
        } else {
          updateObj.className = null;
          updateObj.teacher = null;
          updateObj.teacherEmail = null;
        }
      }

      updateObj.updatedAt = new Date().toISOString();
      await db.collection('students').doc(emailLower).update(updateObj);

      const updatedData = { ...existing, ...updateObj };
      const { passwordHash, ...safeStudent } = updatedData;

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, student: safeStudent })
      };
    }

    // DELETE - Remove student
    if (event.httpMethod === 'DELETE') {
      const email = event.queryStringParameters?.email;

      if (!email) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ success: false, error: 'Email required' })
        };
      }

      const emailLower = email.trim().toLowerCase();
      const existingDoc = await db.collection('students').doc(emailLower).get();

      if (!existingDoc.exists) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ success: false, error: 'Student not found' })
        };
      }
      const existing = existingDoc.data();

      if (!canAccessStudent(existing)) {
        return {
          statusCode: 403,
          headers,
          body: JSON.stringify({ success: false, error: 'Access denied to this student' })
        };
      }

      // Remove from class roster
      if (existing.classId) {
        try {
          const classDoc = await db.collection('classes').doc(existing.classId).get();
          if (classDoc.exists) {
            const updatedStudents = (classDoc.data().students || []).filter(s => s !== emailLower);
            await db.collection('classes').doc(existing.classId).update({ students: updatedStudents });
          }
        } catch (e) {
          console.error('Error updating class:', e);
        }
      }

      await db.collection('students').doc(emailLower).delete();

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, message: 'Student deleted' })
      };
    }

    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ success: false, error: 'Method not allowed' })
    };

  } catch (error) {
    console.error('Student management error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: 'Server error: ' + error.message })
    };
  }
};

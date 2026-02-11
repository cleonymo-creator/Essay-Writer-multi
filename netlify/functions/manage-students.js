// Student Management Function
// Handles CRUD operations for students and CSV import
// Now with teacher authentication and ownership filtering

const nodeCrypto = require('crypto');
const { getStore } = require("@netlify/blobs");
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
      // Check if user exists
      const existingUser = await auth.getUserByEmail(email);
      // Update password if provided
      if (password) {
        await auth.updateUser(existingUser.uid, { password });
      }
      return { success: true, existing: true };
    } catch (e) {
      if (e.code === 'auth/user-not-found') {
        // Create new Firebase Auth user
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

// Helper to verify teacher session (Firestore first, Blobs fallback)
async function verifyTeacherSession(sessionToken, teacherSessionsStore, teachersStore) {
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
    const session = await teacherSessionsStore.get(sessionToken, { type: 'json' });

    if (!session) {
      return { valid: false, error: 'Invalid session' };
    }

    if (new Date(session.expiresAt) < new Date()) {
      await teacherSessionsStore.delete(sessionToken);
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
    const studentsStore = getStore("students");
    const classesStore = getStore("classes");
    const teachersStore = getStore("teachers");
    const teacherSessionsStore = getStore("teacher-sessions");

    // Get and verify session token
    const sessionToken = getSessionToken(event);
    
    // Check if teachers exist (Firestore first, Blobs fallback)
    let teachersExist = false;
    try {
      const db = initializeFirebase();
      if (db) {
        const snapshot = await firestoreTimeout(db.collection('teachers').limit(1).get());
        if (!snapshot.empty) teachersExist = true;
      }
    } catch (e) { /* Firestore unavailable or timed out */ }
    if (!teachersExist) {
      try {
        const { blobs } = await teachersStore.list();
        teachersExist = blobs && blobs.length > 0;
      } catch (e) { /* Store might not exist yet */ }
    }

    let sessionCheck = { valid: false };
    const params = event.queryStringParameters || {};

    if (teachersExist) {
      if (sessionToken) {
        sessionCheck = await verifyTeacherSession(sessionToken, teacherSessionsStore, teachersStore);
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
      if (!sessionCheck.valid) return true; // No auth required
      if (sessionCheck.isAdmin) return true; // Admin can access all
      return studentData.teacherEmail === sessionCheck.email;
    };

    // GET - List all students or get a specific student
    if (event.httpMethod === 'GET') {
      const email = event.queryStringParameters?.email;
      const classId = event.queryStringParameters?.classId;
      const teacherEmailFilter = event.queryStringParameters?.teacherEmail;
      
      if (email) {
        // Get specific student (try Blobs first, then Firestore)
        let student = await studentsStore.get(email.toLowerCase(), { type: 'json' });
        if (!student) {
          try {
            const db = initializeFirebase();
            if (db) {
              const doc = await firestoreTimeout(db.collection('students').doc(email.toLowerCase()).get());
              if (doc.exists) {
                student = { ...doc.data(), email: email.toLowerCase() };
              }
            }
          } catch (e) {
            console.error('Firestore student lookup error:', e);
          }
        }
        if (!student) {
          return {
            statusCode: 404,
            headers,
            body: JSON.stringify({ success: false, error: 'Student not found' })
          };
        }
        
        // Check access
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
      
      // List students from both Blobs and Firestore, merging by email
      const studentsMap = new Map();

      // 1. Read from Netlify Blobs
      try {
        const { blobs } = await studentsStore.list();
        for (const blob of blobs) {
          try {
            const student = await studentsStore.get(blob.key, { type: 'json' });
            if (student) {
              studentsMap.set((student.email || blob.key).toLowerCase(), student);
            }
          } catch (e) {
            console.error('Error reading student from Blobs:', blob.key, e);
          }
        }
      } catch (e) {
        console.error('Error listing Blobs students:', e);
      }

      // 2. Read from Firestore (merge, Firestore wins on conflict)
      try {
        const db = initializeFirebase();
        if (db) {
          const snapshot = await firestoreTimeout(db.collection('students').get());
          snapshot.forEach(doc => {
            const student = doc.data();
            const emailKey = (student.email || doc.id).toLowerCase();
            if (!studentsMap.has(emailKey)) {
              studentsMap.set(emailKey, { ...student, email: emailKey });
            }
          });
        }
      } catch (e) {
        console.error('Error reading Firestore students:', e);
      }

      // 3. Apply filters
      const students = [];
      for (const student of studentsMap.values()) {
        // Apply ownership filter
        if (!canAccessStudent(student)) continue;

        // Filter by class if specified (support both classId string and classIds array)
        if (classId) {
          const studentClassIds = student.classIds || (student.classId ? [student.classId] : []);
          if (!studentClassIds.includes(classId)) continue;
        }

        // Filter by teacher email if specified
        if (teacherEmailFilter && student.teacherEmail !== teacherEmailFilter.toLowerCase()) continue;

        const { passwordHash, ...safeStudent } = student;
        students.push(safeStudent);
      }

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
        // Support both classIds (array) from new UI and classId (singular) for backwards compat
        const classIds = body.classIds || (body.classId ? [body.classId] : []);

        if (!email || !name) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ success: false, error: 'Email and name required' })
          };
        }

        const emailLower = email.trim().toLowerCase();

        // Check if student already exists (check both Blobs and Firestore)
        const existing = await studentsStore.get(emailLower, { type: 'json' });
        if (existing) {
          return {
            statusCode: 409,
            headers,
            body: JSON.stringify({ success: false, error: 'A student with this email already exists' })
          };
        }
        let existsInFirestore = false;
        try {
          const db = initializeFirebase();
          if (db) {
            const doc = await firestoreTimeout(db.collection('students').doc(emailLower).get());
            if (doc.exists) existsInFirestore = true;
          }
        } catch (e) { /* ignore */ }
        if (existsInFirestore) {
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
          const ci = await classesStore.get(cid, { type: 'json' });
          if (ci) {
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
            classInfos.push({ id: cid, ...ci });
            classNames.push(ci.name);
            if (ci.teacher && !teachers.includes(ci.teacher)) teachers.push(ci.teacher);
          }
        }

        // Generate password if not provided
        const studentPassword = password || generatePassword();
        const passwordHash = await hashPassword(studentPassword);

        // Use authenticated teacher info if available
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

        // Write to Netlify Blobs
        await studentsStore.setJSON(emailLower, studentData);

        // Also write to Firestore so both backends stay in sync
        try {
          const db = initializeFirebase();
          if (db) {
            await firestoreTimeout(db.collection('students').doc(emailLower).set(studentData));
          }
        } catch (firestoreErr) {
          console.error('Failed to sync student to Firestore for', emailLower, firestoreErr.message);
        }

        // Create Firebase Auth user (non-blocking - don't fail if this errors)
        ensureFirebaseAuthUser(emailLower, studentPassword, name.trim()).catch(err => {
          console.error('Failed to create Firebase Auth user for', emailLower, err);
        });

        // Add student to all class rosters
        for (const ci of classInfos) {
          const updatedStudents = [...(ci.students || [])];
          if (!updatedStudents.includes(emailLower)) {
            updatedStudents.push(emailLower);
            await classesStore.setJSON(ci.id, {
              ...ci,
              students: updatedStudents
            });
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
          classInfo = await classesStore.get(classId, { type: 'json' });
          
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

        const results = {
          created: [],
          skipped: [],
          errors: []
        };

        const newClassStudents = classInfo ? [...(classInfo.students || [])] : [];

        // Get teacher info
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
            const existing = await studentsStore.get(emailLower, { type: 'json' });
            if (existing) {
              results.skipped.push({ email: emailLower, name: parsed.name, reason: 'Already exists' });
              
              // Still add to class if not already there
              if (classId && !newClassStudents.includes(emailLower)) {
                newClassStudents.push(emailLower);
                await studentsStore.setJSON(emailLower, {
                  ...existing,
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

            await studentsStore.setJSON(emailLower, studentData);

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
          await classesStore.setJSON(classId, {
            ...classInfo,
            students: newClassStudents
          });
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
        const existing = await studentsStore.get(emailLower, { type: 'json' });
        
        if (!existing) {
          return {
            statusCode: 404,
            headers,
            body: JSON.stringify({ success: false, error: 'Student not found' })
          };
        }

        // Check access
        if (!canAccessStudent(existing)) {
          return {
            statusCode: 403,
            headers,
            body: JSON.stringify({ success: false, error: 'Access denied to this student' })
          };
        }

        const newPassword = generatePassword();
        const passwordHash = await hashPassword(newPassword);

        await studentsStore.setJSON(emailLower, {
          ...existing,
          passwordHash,
          passwordResetAt: new Date().toISOString(),
          passwordResetBy: sessionCheck.valid ? sessionCheck.email : 'system'
        });

        // Also update Firestore so client-side login fallback works
        try {
          const db = initializeFirebase();
          if (db) {
            const studentDoc = await firestoreTimeout(db.collection('students').doc(emailLower).get());
            if (studentDoc.exists) {
              await firestoreTimeout(db.collection('students').doc(emailLower).update({
                passwordHash,
                passwordResetAt: new Date().toISOString(),
                passwordResetBy: sessionCheck.valid ? sessionCheck.email : 'system'
              }));
            }
          }
        } catch (firestoreErr) {
          console.error('Failed to update Firestore password for', emailLower, firestoreErr.message);
        }

        // Update Firebase Auth password (awaited so primary login path works)
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
      const existing = await studentsStore.get(emailLower, { type: 'json' });
      
      if (!existing) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ success: false, error: 'Student not found' })
        };
      }

      // Check access
      if (!canAccessStudent(existing)) {
        return {
          statusCode: 403,
          headers,
          body: JSON.stringify({ success: false, error: 'Access denied to this student' })
        };
      }

      let updatedData = { ...existing };
      
      // Apply allowed updates
      const allowedFields = ['name', 'classId', 'yearGroup', 'individualAssignments'];
      for (const field of allowedFields) {
        if (updates[field] !== undefined) {
          updatedData[field] = updates[field];
        }
      }

      // Handle class change
      if (updates.classId !== undefined && updates.classId !== existing.classId) {
        // Check if teacher can access the new class
        if (updates.classId) {
          const newClass = await classesStore.get(updates.classId, { type: 'json' });
          if (newClass && sessionCheck.valid && !sessionCheck.isAdmin) {
            if (newClass.teacherEmail !== sessionCheck.email) {
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
          const oldClass = await classesStore.get(existing.classId, { type: 'json' });
          if (oldClass) {
            await classesStore.setJSON(existing.classId, {
              ...oldClass,
              students: (oldClass.students || []).filter(s => s !== emailLower)
            });
          }
        }
        
        // Add to new class
        if (updates.classId) {
          const newClass = await classesStore.get(updates.classId, { type: 'json' });
          if (newClass) {
            const newStudents = [...(newClass.students || [])];
            if (!newStudents.includes(emailLower)) {
              newStudents.push(emailLower);
              await classesStore.setJSON(updates.classId, {
                ...newClass,
                students: newStudents
              });
            }
            updatedData.className = newClass.name;
            updatedData.teacher = newClass.teacher;
            updatedData.teacherEmail = newClass.teacherEmail;
            if (!updates.yearGroup) {
              updatedData.yearGroup = newClass.yearGroup;
            }
          }
        } else {
          updatedData.className = null;
          updatedData.teacher = null;
          updatedData.teacherEmail = null;
        }
      }

      updatedData.updatedAt = new Date().toISOString();
      await studentsStore.setJSON(emailLower, updatedData);

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
      const existing = await studentsStore.get(emailLower, { type: 'json' });
      
      if (!existing) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ success: false, error: 'Student not found' })
        };
      }

      // Check access
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
          const classData = await classesStore.get(existing.classId, { type: 'json' });
          if (classData) {
            await classesStore.setJSON(existing.classId, {
              ...classData,
              students: (classData.students || []).filter(s => s !== emailLower)
            });
          }
        } catch (e) {
          console.error('Error updating class:', e);
        }
      }

      await studentsStore.delete(emailLower);

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

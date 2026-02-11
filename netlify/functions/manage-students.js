// Student Management Function
// Handles CRUD operations for students and CSV import
// Now with teacher authentication and ownership filtering

const { getStore } = require("@netlify/blobs");
const { getAuth, initializeFirebase } = require('./firebase-helper');

// Improved password hashing with PBKDF2
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

// Generate a random password (easy to read/type)
function generatePassword(length = 8) {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let password = '';
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  for (let i = 0; i < length; i++) {
    password += chars[array[i] % chars.length];
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

// Helper to verify teacher session
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
      teacher: teacher
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
    
    // Check if teachers exist (for backward compatibility)
    let teachersExist = false;
    try {
      const { blobs } = await teachersStore.list();
      teachersExist = blobs && blobs.length > 0;
    } catch (e) {
      // Store might not exist yet
    }

    let sessionCheck = { valid: false };
    
    if (teachersExist) {
      if (!sessionToken) {
        return {
          statusCode: 401,
          headers,
          body: JSON.stringify({ 
            success: false, 
            error: 'Authentication required',
            requiresAuth: true
          })
        };
      }
      
      sessionCheck = await verifyTeacherSession(sessionToken, teacherSessionsStore, teachersStore);
      
      if (!sessionCheck.valid) {
        return {
          statusCode: 401,
          headers,
          body: JSON.stringify({ 
            success: false, 
            error: sessionCheck.error,
            requiresAuth: true
          })
        };
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
        // Get specific student
        const student = await studentsStore.get(email.toLowerCase(), { type: 'json' });
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
      
      // List students (filtered by ownership)
      const { blobs } = await studentsStore.list();
      const students = [];
      
      for (const blob of blobs) {
        try {
          const student = await studentsStore.get(blob.key, { type: 'json' });
          if (student) {
            // Apply ownership filter
            if (!canAccessStudent(student)) continue;
            
            // Filter by class if specified
            if (classId && student.classId !== classId) continue;
            
            // Filter by teacher email if specified
            if (teacherEmailFilter && student.teacherEmail !== teacherEmailFilter.toLowerCase()) continue;
            
            const { passwordHash, ...safeStudent } = student;
            students.push(safeStudent);
          }
        } catch (e) {
          console.error('Error reading student:', blob.key, e);
        }
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
        const { email, name, classId, yearGroup, password } = body;
        
        if (!email || !name) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ success: false, error: 'Email and name required' })
          };
        }

        const emailLower = email.trim().toLowerCase();
        
        // Check if student already exists
        const existing = await studentsStore.get(emailLower, { type: 'json' });
        if (existing) {
          return {
            statusCode: 409,
            headers,
            body: JSON.stringify({ success: false, error: 'A student with this email already exists' })
          };
        }

        // Get class info if classId provided
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

        // Generate password if not provided
        const studentPassword = password || generatePassword();
        const passwordHash = await hashPassword(studentPassword);

        // Use authenticated teacher info if available
        let teacherName = classInfo?.teacher || null;
        let teacherEmail = classInfo?.teacherEmail || null;
        
        if (sessionCheck.valid && !classInfo) {
          teacherName = sessionCheck.name;
          teacherEmail = sessionCheck.email;
        }

        const studentData = {
          email: emailLower,
          name: name.trim(),
          classId: classId || null,
          className: classInfo?.name || null,
          yearGroup: yearGroup || classInfo?.yearGroup || null,
          teacher: teacherName,
          teacherEmail: teacherEmail,
          individualAssignments: [],
          passwordHash,
          createdAt: new Date().toISOString(),
          lastLogin: null
        };

        await studentsStore.setJSON(emailLower, studentData);

        // Create Firebase Auth user (non-blocking - don't fail if this errors)
        ensureFirebaseAuthUser(emailLower, studentPassword, name.trim()).catch(err => {
          console.error('Failed to create Firebase Auth user for', emailLower, err);
        });

        // Add student to class roster
        if (classId && classInfo) {
          const updatedStudents = [...(classInfo.students || [])];
          if (!updatedStudents.includes(emailLower)) {
            updatedStudents.push(emailLower);
            await classesStore.setJSON(classId, {
              ...classInfo,
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
            const studentDoc = await db.collection('students').doc(emailLower).get();
            if (studentDoc.exists) {
              await db.collection('students').doc(emailLower).update({
                passwordHash,
                passwordResetAt: new Date().toISOString(),
                passwordResetBy: sessionCheck.valid ? sessionCheck.email : 'system'
              });
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

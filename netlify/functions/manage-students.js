// Student Management Function
// Handles CRUD operations for students and CSV import

const { getStore } = require("@netlify/blobs");

// Simple hash function for passwords
async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Generate a random password (easy to read/type)
function generatePassword(length = 8) {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789'; // No confusing chars
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
  
  // Get headers (lowercase, trimmed)
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
    
    // Require at minimum email and name
    if (student.email && (student.name || student.fullname || student.studentname)) {
      // Normalize name field
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

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers };
  }

  try {
    const studentsStore = getStore("students");
    const classesStore = getStore("classes");

    // GET - List all students or get a specific student
    if (event.httpMethod === 'GET') {
      const email = event.queryStringParameters?.email;
      const classId = event.queryStringParameters?.classId;
      
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
        const { passwordHash, ...safeStudent } = student;
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, student: safeStudent })
        };
      }
      
      // List all students (optionally filtered by class)
      const { blobs } = await studentsStore.list();
      const students = [];
      
      for (const blob of blobs) {
        try {
          const student = await studentsStore.get(blob.key, { type: 'json' });
          if (student) {
            // Filter by class if specified
            if (classId && student.classId !== classId) continue;
            
            const { passwordHash, ...safeStudent } = student;
            students.push(safeStudent);
          }
        } catch (e) {
          console.error('Error reading student:', blob.key, e);
        }
      }
      
      // Sort by name
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
        }

        // Generate password if not provided
        const studentPassword = password || generatePassword();
        const passwordHash = await hashPassword(studentPassword);

        const studentData = {
          email: emailLower,
          name: name.trim(),
          classId: classId || null,
          className: classInfo?.name || null,
          yearGroup: yearGroup || classInfo?.yearGroup || null,
          teacher: classInfo?.teacher || null,
          teacherEmail: classInfo?.teacherEmail || null,
          individualAssignments: [],
          passwordHash,
          createdAt: new Date().toISOString(),
          lastLogin: null
        };

        await studentsStore.setJSON(emailLower, studentData);

        // Add student to class roster if class exists
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
                // Update existing student's class
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
              teacher: classInfo?.teacher || null,
              teacherEmail: classInfo?.teacherEmail || null,
              individualAssignments: [],
              passwordHash,
              createdAt: new Date().toISOString(),
              lastLogin: null
            };

            await studentsStore.setJSON(emailLower, studentData);
            
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

        const newPassword = generatePassword();
        const passwordHash = await hashPassword(newPassword);

        await studentsStore.setJSON(emailLower, {
          ...existing,
          passwordHash,
          passwordResetAt: new Date().toISOString()
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

      // Handle password update separately
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
            // Update class info on student
            updatedData.className = newClass.name;
            updatedData.teacher = newClass.teacher;
            updatedData.teacherEmail = newClass.teacherEmail;
            if (!updates.yearGroup) {
              updatedData.yearGroup = newClass.yearGroup;
            }
          }
        } else {
          // Removing from class
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

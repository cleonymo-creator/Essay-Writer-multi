// Class Management Function
// Handles CRUD for classes and assignment management
// Now with teacher authentication and ownership filtering

const { getStore } = require("@netlify/blobs");
const { initializeFirebase } = require('./firebase-helper');

// Generate a simple class ID from name
function generateClassId(name) {
  return name.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') +
    '-' + Date.now().toString(36);
}

// Helper to verify teacher session (Firestore first, Blobs fallback)
async function verifyTeacherSession(sessionToken, teacherSessionsStore, teachersStore) {
  if (!sessionToken) {
    return { valid: false, error: 'No session token provided' };
  }

  try {
    // Try Firestore first (primary storage for teacher-auth.js)
    const db = initializeFirebase();
    if (db) {
      const sessionDoc = await db.collection('teacherSessions').doc(sessionToken).get();
      if (sessionDoc.exists) {
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
  // Check Authorization header first
  const authHeader = event.headers.authorization || event.headers.Authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  // Check query parameter
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
    const classesStore = getStore("classes");
    const studentsStore = getStore("students");
    const teachersStore = getStore("teachers");
    const teacherSessionsStore = getStore("teacher-sessions");

    // Get and verify session token
    const sessionToken = getSessionToken(event);
    
    // Check if teachers exist (Firestore first, Blobs fallback)
    let teachersExist = false;
    try {
      const db = initializeFirebase();
      if (db) {
        const snapshot = await db.collection('teachers').limit(1).get();
        if (!snapshot.empty) teachersExist = true;
      }
    } catch (e) { /* Firestore unavailable */ }
    if (!teachersExist) {
      try {
        const { blobs } = await teachersStore.list();
        teachersExist = blobs && blobs.length > 0;
      } catch (e) { /* Store might not exist yet */ }
    }

    let sessionCheck = { valid: false };
    
    if (teachersExist) {
      // Teachers exist, require authentication
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

    // GET - List all classes or get specific class
    if (event.httpMethod === 'GET') {
      const classId = event.queryStringParameters?.classId;
      const teacherEmailFilter = event.queryStringParameters?.teacherEmail;
      
      if (classId) {
        // Get specific class
        const classData = await classesStore.get(classId, { type: 'json' });
        if (!classData) {
          return {
            statusCode: 404,
            headers,
            body: JSON.stringify({ success: false, error: 'Class not found' })
          };
        }
        
        // Check ownership (admin can see all, teachers only their own)
        if (sessionCheck.valid && !sessionCheck.isAdmin) {
          if (classData.teacherEmail !== sessionCheck.email) {
            return {
              statusCode: 403,
              headers,
              body: JSON.stringify({ success: false, error: 'Access denied to this class' })
            };
          }
        }
        
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, class: classData })
        };
      }
      
      // List classes (filtered by ownership)
      const { blobs } = await classesStore.list();
      const classes = [];
      
      for (const blob of blobs) {
        try {
          const classData = await classesStore.get(blob.key, { type: 'json' });
          if (classData) {
            // Apply ownership filter
            if (sessionCheck.valid && !sessionCheck.isAdmin) {
              // Teachers only see their own classes
              if (classData.teacherEmail !== sessionCheck.email) continue;
            }
            
            // Apply explicit teacher email filter if provided
            if (teacherEmailFilter && classData.teacherEmail !== teacherEmailFilter.toLowerCase()) continue;
            
            classes.push(classData);
          }
        } catch (e) {
          console.error('Error reading class:', blob.key, e);
        }
      }
      
      // Sort by name
      classes.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, classes })
      };
    }

    // POST - Create class or manage assignments
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { action } = body;

      // Create new class
      if (action === 'create') {
        const { name, subject, yearGroup, teacher, teacherEmail } = body;
        
        if (!name) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ success: false, error: 'Class name required' })
          };
        }

        const classId = generateClassId(name);

        // If authenticated, use the teacher's info
        let finalTeacher = teacher;
        let finalTeacherEmail = teacherEmail?.toLowerCase();
        
        if (sessionCheck.valid) {
          finalTeacher = finalTeacher || sessionCheck.name;
          finalTeacherEmail = finalTeacherEmail || sessionCheck.email;
        }

        const classData = {
          id: classId,
          name: name.trim(),
          subject: subject || 'English',
          yearGroup: yearGroup || null,
          teacher: finalTeacher || null,
          teacherEmail: finalTeacherEmail || null,
          students: [],
          assignedEssays: [],
          createdAt: new Date().toISOString()
        };

        await classesStore.setJSON(classId, classData);
        
        return {
          statusCode: 201,
          headers,
          body: JSON.stringify({ success: true, class: classData })
        };
      }

      // Helper to check class ownership for modifications
      const checkClassOwnership = async (classId) => {
        const classData = await classesStore.get(classId, { type: 'json' });
        if (!classData) {
          return { allowed: false, error: 'Class not found', status: 404 };
        }
        
        if (sessionCheck.valid && !sessionCheck.isAdmin) {
          if (classData.teacherEmail !== sessionCheck.email) {
            return { allowed: false, error: 'Access denied to this class', status: 403 };
          }
        }
        
        return { allowed: true, classData };
      };

      // Assign essay to class
      if (action === 'assignToClass') {
        const { classId, essayId } = body;
        
        if (!classId || !essayId) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ success: false, error: 'classId and essayId required' })
          };
        }

        const ownershipCheck = await checkClassOwnership(classId);
        if (!ownershipCheck.allowed) {
          return {
            statusCode: ownershipCheck.status,
            headers,
            body: JSON.stringify({ success: false, error: ownershipCheck.error })
          };
        }

        const classData = ownershipCheck.classData;
        const assignments = [...(classData.assignedEssays || [])];
        if (!assignments.includes(essayId)) {
          assignments.push(essayId);
          await classesStore.setJSON(classId, {
            ...classData,
            assignedEssays: assignments,
            updatedAt: new Date().toISOString()
          });
        }

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ 
            success: true, 
            message: 'Essay assigned to class',
            assignedEssays: assignments
          })
        };
      }

      // Remove essay from class
      if (action === 'unassignFromClass') {
        const { classId, essayId } = body;
        
        if (!classId || !essayId) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ success: false, error: 'classId and essayId required' })
          };
        }

        const ownershipCheck = await checkClassOwnership(classId);
        if (!ownershipCheck.allowed) {
          return {
            statusCode: ownershipCheck.status,
            headers,
            body: JSON.stringify({ success: false, error: ownershipCheck.error })
          };
        }

        const classData = ownershipCheck.classData;
        const assignments = (classData.assignedEssays || []).filter(id => id !== essayId);
        await classesStore.setJSON(classId, {
          ...classData,
          assignedEssays: assignments,
          updatedAt: new Date().toISOString()
        });

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ 
            success: true, 
            message: 'Essay removed from class',
            assignedEssays: assignments
          })
        };
      }

      // Assign essay to individual student
      if (action === 'assignToStudent') {
        const { studentEmail, essayId } = body;
        
        if (!studentEmail || !essayId) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ success: false, error: 'studentEmail and essayId required' })
          };
        }

        const emailLower = studentEmail.trim().toLowerCase();
        const studentData = await studentsStore.get(emailLower, { type: 'json' });
        
        if (!studentData) {
          return {
            statusCode: 404,
            headers,
            body: JSON.stringify({ success: false, error: 'Student not found' })
          };
        }

        // Check if teacher owns the student's class
        if (sessionCheck.valid && !sessionCheck.isAdmin) {
          if (studentData.teacherEmail !== sessionCheck.email) {
            return {
              statusCode: 403,
              headers,
              body: JSON.stringify({ success: false, error: 'Access denied to this student' })
            };
          }
        }

        const assignments = [...(studentData.individualAssignments || [])];
        if (!assignments.includes(essayId)) {
          assignments.push(essayId);
          await studentsStore.setJSON(emailLower, {
            ...studentData,
            individualAssignments: assignments,
            updatedAt: new Date().toISOString()
          });
        }

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ 
            success: true, 
            message: 'Essay assigned to student',
            individualAssignments: assignments
          })
        };
      }

      // Remove essay from individual student
      if (action === 'unassignFromStudent') {
        const { studentEmail, essayId } = body;
        
        if (!studentEmail || !essayId) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ success: false, error: 'studentEmail and essayId required' })
          };
        }

        const emailLower = studentEmail.trim().toLowerCase();
        const studentData = await studentsStore.get(emailLower, { type: 'json' });
        
        if (!studentData) {
          return {
            statusCode: 404,
            headers,
            body: JSON.stringify({ success: false, error: 'Student not found' })
          };
        }

        // Check ownership
        if (sessionCheck.valid && !sessionCheck.isAdmin) {
          if (studentData.teacherEmail !== sessionCheck.email) {
            return {
              statusCode: 403,
              headers,
              body: JSON.stringify({ success: false, error: 'Access denied to this student' })
            };
          }
        }

        const assignments = (studentData.individualAssignments || []).filter(id => id !== essayId);
        await studentsStore.setJSON(emailLower, {
          ...studentData,
          individualAssignments: assignments,
          updatedAt: new Date().toISOString()
        });

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ 
            success: true, 
            message: 'Essay removed from student',
            individualAssignments: assignments
          })
        };
      }

      // Bulk assign to multiple students
      if (action === 'bulkAssign') {
        const { studentEmails, essayId } = body;
        
        if (!studentEmails || !Array.isArray(studentEmails) || !essayId) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ success: false, error: 'studentEmails array and essayId required' })
          };
        }

        const results = { updated: [], notFound: [], accessDenied: [] };

        for (const email of studentEmails) {
          const emailLower = email.trim().toLowerCase();
          const studentData = await studentsStore.get(emailLower, { type: 'json' });
          
          if (!studentData) {
            results.notFound.push(emailLower);
            continue;
          }

          // Check ownership
          if (sessionCheck.valid && !sessionCheck.isAdmin) {
            if (studentData.teacherEmail !== sessionCheck.email) {
              results.accessDenied.push(emailLower);
              continue;
            }
          }

          const assignments = [...(studentData.individualAssignments || [])];
          if (!assignments.includes(essayId)) {
            assignments.push(essayId);
            await studentsStore.setJSON(emailLower, {
              ...studentData,
              individualAssignments: assignments,
              updatedAt: new Date().toISOString()
            });
          }
          results.updated.push(emailLower);
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
    }

    // PUT - Update class
    if (event.httpMethod === 'PUT') {
      const { classId, updates } = JSON.parse(event.body || '{}');
      
      if (!classId) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ success: false, error: 'classId required' })
        };
      }

      const classData = await classesStore.get(classId, { type: 'json' });
      
      if (!classData) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ success: false, error: 'Class not found' })
        };
      }

      // Check ownership
      if (sessionCheck.valid && !sessionCheck.isAdmin) {
        if (classData.teacherEmail !== sessionCheck.email) {
          return {
            statusCode: 403,
            headers,
            body: JSON.stringify({ success: false, error: 'Access denied to this class' })
          };
        }
      }

      // Apply allowed updates
      // Note: only admins can change teacher assignment
      const allowedFields = ['name', 'subject', 'yearGroup', 'assignedEssays'];
      if (sessionCheck.isAdmin) {
        allowedFields.push('teacher', 'teacherEmail');
      }
      
      const updatedData = { ...classData };
      
      for (const field of allowedFields) {
        if (updates[field] !== undefined) {
          updatedData[field] = updates[field];
        }
      }

      // If teacher info changed (admin only), update all students in class
      if (sessionCheck.isAdmin && (updates.teacher !== undefined || updates.teacherEmail !== undefined)) {
        for (const studentEmail of (classData.students || [])) {
          const studentData = await studentsStore.get(studentEmail, { type: 'json' });
          if (studentData) {
            await studentsStore.setJSON(studentEmail, {
              ...studentData,
              teacher: updatedData.teacher,
              teacherEmail: updatedData.teacherEmail,
              className: updatedData.name
            });
          }
        }
      }

      updatedData.updatedAt = new Date().toISOString();
      await classesStore.setJSON(classId, updatedData);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, class: updatedData })
      };
    }

    // DELETE - Remove class
    if (event.httpMethod === 'DELETE') {
      const classId = event.queryStringParameters?.classId;
      
      if (!classId) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ success: false, error: 'classId required' })
        };
      }

      const classData = await classesStore.get(classId, { type: 'json' });
      
      if (!classData) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ success: false, error: 'Class not found' })
        };
      }

      // Check ownership
      if (sessionCheck.valid && !sessionCheck.isAdmin) {
        if (classData.teacherEmail !== sessionCheck.email) {
          return {
            statusCode: 403,
            headers,
            body: JSON.stringify({ success: false, error: 'Access denied to this class' })
          };
        }
      }

      // Remove class reference from all students
      for (const studentEmail of (classData.students || [])) {
        try {
          const studentData = await studentsStore.get(studentEmail, { type: 'json' });
          if (studentData && studentData.classId === classId) {
            await studentsStore.setJSON(studentEmail, {
              ...studentData,
              classId: null,
              className: null,
              teacher: null,
              teacherEmail: null
            });
          }
        } catch (e) {
          console.error('Error updating student:', studentEmail, e);
        }
      }

      await classesStore.delete(classId);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, message: 'Class deleted' })
      };
    }

    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ success: false, error: 'Method not allowed' })
    };

  } catch (error) {
    console.error('Class management error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: 'Server error: ' + error.message })
    };
  }
};

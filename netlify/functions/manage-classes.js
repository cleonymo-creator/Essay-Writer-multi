// Class Management Function
// Handles CRUD for classes and assignment management
// Uses Firestore as the sole data store

const { initializeFirebase } = require('./firebase-helper');

// Generate a simple class ID from name
function generateClassId(name) {
  return name.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') +
    '-' + Date.now().toString(36);
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

    // GET - List all classes or get specific class
    if (event.httpMethod === 'GET') {
      const classId = event.queryStringParameters?.classId;
      const teacherEmailFilter = event.queryStringParameters?.teacherEmail;

      if (classId) {
        // Get specific class
        const classDoc = await db.collection('classes').doc(classId).get();
        if (!classDoc.exists) {
          return {
            statusCode: 404,
            headers,
            body: JSON.stringify({ success: false, error: 'Class not found' })
          };
        }
        const classData = { id: classDoc.id, ...classDoc.data() };

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

      // List classes from Firestore
      const classesSnapshot = await db.collection('classes').get();
      const classes = [];

      classesSnapshot.forEach(doc => {
        const classData = { id: doc.id, ...doc.data() };

        // Apply ownership filter
        if (sessionCheck.valid && !sessionCheck.isAdmin) {
          if (classData.teacherEmail !== sessionCheck.email) return;
        }

        // Apply explicit teacher email filter if provided
        if (teacherEmailFilter && classData.teacherEmail !== teacherEmailFilter.toLowerCase()) return;

        classes.push(classData);
      });

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

        await db.collection('classes').doc(classId).set(classData);

        return {
          statusCode: 201,
          headers,
          body: JSON.stringify({ success: true, class: classData })
        };
      }

      // Helper to check class ownership for modifications
      const checkClassOwnership = async (classId) => {
        const classDoc = await db.collection('classes').doc(classId).get();
        if (!classDoc.exists) {
          return { allowed: false, error: 'Class not found', status: 404 };
        }
        const classData = { id: classDoc.id, ...classDoc.data() };

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
          await db.collection('classes').doc(classId).update({
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
        await db.collection('classes').doc(classId).update({
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
        const studentDoc = await db.collection('students').doc(emailLower).get();

        if (!studentDoc.exists) {
          return {
            statusCode: 404,
            headers,
            body: JSON.stringify({ success: false, error: 'Student not found' })
          };
        }
        const studentData = studentDoc.data();

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
          await db.collection('students').doc(emailLower).update({
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
        const studentDoc = await db.collection('students').doc(emailLower).get();

        if (!studentDoc.exists) {
          return {
            statusCode: 404,
            headers,
            body: JSON.stringify({ success: false, error: 'Student not found' })
          };
        }
        const studentData = studentDoc.data();

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
        await db.collection('students').doc(emailLower).update({
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
          const studentDoc = await db.collection('students').doc(emailLower).get();

          if (!studentDoc.exists) {
            results.notFound.push(emailLower);
            continue;
          }
          const studentData = studentDoc.data();

          if (sessionCheck.valid && !sessionCheck.isAdmin) {
            if (studentData.teacherEmail !== sessionCheck.email) {
              results.accessDenied.push(emailLower);
              continue;
            }
          }

          const assignments = [...(studentData.individualAssignments || [])];
          if (!assignments.includes(essayId)) {
            assignments.push(essayId);
            await db.collection('students').doc(emailLower).update({
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

      const classDoc = await db.collection('classes').doc(classId).get();

      if (!classDoc.exists) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ success: false, error: 'Class not found' })
        };
      }
      const classData = { id: classDoc.id, ...classDoc.data() };

      if (sessionCheck.valid && !sessionCheck.isAdmin) {
        if (classData.teacherEmail !== sessionCheck.email) {
          return {
            statusCode: 403,
            headers,
            body: JSON.stringify({ success: false, error: 'Access denied to this class' })
          };
        }
      }

      const allowedFields = ['name', 'subject', 'yearGroup', 'assignedEssays'];
      if (sessionCheck.isAdmin) {
        allowedFields.push('teacher', 'teacherEmail');
      }

      const updateObj = {};
      for (const field of allowedFields) {
        if (updates[field] !== undefined) {
          updateObj[field] = updates[field];
        }
      }
      updateObj.updatedAt = new Date().toISOString();

      // If teacher info changed (admin only), update all students in class
      if (sessionCheck.isAdmin && (updates.teacher !== undefined || updates.teacherEmail !== undefined)) {
        const batch = db.batch();
        for (const studentEmail of (classData.students || [])) {
          const studentRef = db.collection('students').doc(studentEmail);
          batch.update(studentRef, {
            teacher: updates.teacher || classData.teacher,
            teacherEmail: updates.teacherEmail || classData.teacherEmail,
            className: updates.name || classData.name
          });
        }
        await batch.commit();
      }

      await db.collection('classes').doc(classId).update(updateObj);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, class: { ...classData, ...updateObj } })
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

      const classDoc = await db.collection('classes').doc(classId).get();

      if (!classDoc.exists) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ success: false, error: 'Class not found' })
        };
      }
      const classData = classDoc.data();

      if (sessionCheck.valid && !sessionCheck.isAdmin) {
        if (classData.teacherEmail !== sessionCheck.email) {
          return {
            statusCode: 403,
            headers,
            body: JSON.stringify({ success: false, error: 'Access denied to this class' })
          };
        }
      }

      // Remove class reference from all students using batch
      const batch = db.batch();
      for (const studentEmail of (classData.students || [])) {
        const studentRef = db.collection('students').doc(studentEmail);
        batch.update(studentRef, {
          classId: null,
          className: null,
          teacher: null,
          teacherEmail: null
        });
      }
      await batch.commit();

      await db.collection('classes').doc(classId).delete();

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

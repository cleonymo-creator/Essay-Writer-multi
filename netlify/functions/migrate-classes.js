// Migration Helper Function
// Helps migrate existing classes to teacher ownership
// Run this once after setting up the first admin account

const { getStore } = require("@netlify/blobs");

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
      isAdmin: teacher.role === 'admin'
    };
  } catch (error) {
    return { valid: false, error: 'Session verification failed' };
  }
}

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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

    // Get session token
    const authHeader = event.headers.authorization || event.headers.Authorization;
    let sessionToken = null;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      sessionToken = authHeader.substring(7);
    } else {
      sessionToken = event.queryStringParameters?.sessionToken;
    }

    // Verify admin access
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
        body: JSON.stringify({ success: false, error: 'Admin access required for migration' })
      };
    }

    // GET - Show migration status
    if (event.httpMethod === 'GET') {
      const { blobs: classBlobs } = await classesStore.list();
      const { blobs: teacherBlobs } = await teachersStore.list();
      
      const unassignedClasses = [];
      const assignedClasses = [];
      
      for (const blob of classBlobs) {
        const classData = await classesStore.get(blob.key, { type: 'json' });
        if (classData) {
          if (classData.teacherEmail) {
            assignedClasses.push({
              id: classData.id,
              name: classData.name,
              teacherEmail: classData.teacherEmail,
              studentCount: (classData.students || []).length
            });
          } else {
            unassignedClasses.push({
              id: classData.id,
              name: classData.name,
              studentCount: (classData.students || []).length
            });
          }
        }
      }
      
      const teachers = [];
      for (const blob of teacherBlobs) {
        const teacher = await teachersStore.get(blob.key, { type: 'json' });
        if (teacher) {
          teachers.push({
            email: teacher.email,
            name: teacher.name,
            role: teacher.role
          });
        }
      }
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          status: {
            totalClasses: classBlobs.length,
            unassignedClasses: unassignedClasses.length,
            assignedClasses: assignedClasses.length,
            totalTeachers: teacherBlobs.length
          },
          unassignedClasses,
          assignedClasses,
          teachers
        })
      };
    }

    // POST - Perform migration actions
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { action } = body;

      // Assign a class to a teacher
      if (action === 'assignClass') {
        const { classId, teacherEmail } = body;
        
        if (!classId || !teacherEmail) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ success: false, error: 'classId and teacherEmail required' })
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

        const teacher = await teachersStore.get(teacherEmail.toLowerCase(), { type: 'json' });
        if (!teacher) {
          return {
            statusCode: 404,
            headers,
            body: JSON.stringify({ success: false, error: 'Teacher not found' })
          };
        }

        // Update class
        await classesStore.setJSON(classId, {
          ...classData,
          teacher: teacher.name,
          teacherEmail: teacher.email,
          updatedAt: new Date().toISOString()
        });

        // Update all students in the class
        for (const studentEmail of (classData.students || [])) {
          try {
            const studentData = await studentsStore.get(studentEmail, { type: 'json' });
            if (studentData) {
              await studentsStore.setJSON(studentEmail, {
                ...studentData,
                teacher: teacher.name,
                teacherEmail: teacher.email
              });
            }
          } catch (e) {
            console.error('Error updating student:', studentEmail, e);
          }
        }

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ 
            success: true, 
            message: 'Class assigned to ' + teacher.name,
            studentsUpdated: (classData.students || []).length
          })
        };
      }

      // Bulk assign multiple classes
      if (action === 'bulkAssign') {
        const { assignments } = body; // Array of { classId, teacherEmail }
        
        if (!assignments || !Array.isArray(assignments)) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ success: false, error: 'assignments array required' })
          };
        }

        const results = { success: [], failed: [] };

        for (const { classId, teacherEmail } of assignments) {
          try {
            const classData = await classesStore.get(classId, { type: 'json' });
            const teacher = await teachersStore.get(teacherEmail.toLowerCase(), { type: 'json' });
            
            if (!classData || !teacher) {
              results.failed.push({ classId, error: 'Class or teacher not found' });
              continue;
            }

            await classesStore.setJSON(classId, {
              ...classData,
              teacher: teacher.name,
              teacherEmail: teacher.email,
              updatedAt: new Date().toISOString()
            });

            // Update students
            for (const studentEmail of (classData.students || [])) {
              try {
                const studentData = await studentsStore.get(studentEmail, { type: 'json' });
                if (studentData) {
                  await studentsStore.setJSON(studentEmail, {
                    ...studentData,
                    teacher: teacher.name,
                    teacherEmail: teacher.email
                  });
                }
              } catch (e) {
                // Continue on student errors
              }
            }

            results.success.push({ classId, teacherEmail });
          } catch (e) {
            results.failed.push({ classId, error: e.message });
          }
        }

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, results })
        };
      }

      // Assign all unassigned classes to current admin
      if (action === 'claimUnassigned') {
        const { blobs } = await classesStore.list();
        const results = { claimed: [], errors: [] };

        for (const blob of blobs) {
          try {
            const classData = await classesStore.get(blob.key, { type: 'json' });
            if (classData && !classData.teacherEmail) {
              await classesStore.setJSON(blob.key, {
                ...classData,
                teacher: sessionCheck.name,
                teacherEmail: sessionCheck.email,
                updatedAt: new Date().toISOString()
              });

              // Update students
              for (const studentEmail of (classData.students || [])) {
                try {
                  const studentData = await studentsStore.get(studentEmail, { type: 'json' });
                  if (studentData) {
                    await studentsStore.setJSON(studentEmail, {
                      ...studentData,
                      teacher: sessionCheck.name,
                      teacherEmail: sessionCheck.email
                    });
                  }
                } catch (e) {
                  // Continue
                }
              }

              results.claimed.push({ id: classData.id, name: classData.name });
            }
          } catch (e) {
            results.errors.push({ classId: blob.key, error: e.message });
          }
        }

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ 
            success: true, 
            message: 'Claimed ' + results.claimed.length + ' classes',
            results
          })
        };
      }

      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'Invalid action' })
      };
    }

    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ success: false, error: 'Method not allowed' })
    };

  } catch (error) {
    console.error('Migration error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: 'Server error: ' + error.message })
    };
  }
};

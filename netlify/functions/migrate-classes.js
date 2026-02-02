// Migration Helper Function (Firebase Version)
// Helps migrate existing classes to teacher ownership
// Run this once after setting up the first admin account

const { initializeFirebase } = require('./firebase-helper');

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
    const db = initializeFirebase();

    // Get session token
    const authHeader = event.headers.authorization || event.headers.Authorization;
    let sessionToken = null;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      sessionToken = authHeader.substring(7);
    } else {
      sessionToken = event.queryStringParameters?.sessionToken;
    }

    // Verify admin access
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
        body: JSON.stringify({ success: false, error: 'Admin access required for migration' })
      };
    }

    // GET - Show migration status
    if (event.httpMethod === 'GET') {
      const classesSnapshot = await db.collection('classes').get();
      const teachersSnapshot = await db.collection('teachers').get();
      
      const unassignedClasses = [];
      const assignedClasses = [];
      
      classesSnapshot.forEach(doc => {
        const classData = doc.data();
        if (classData.teacherEmail) {
          assignedClasses.push({
            id: doc.id,
            name: classData.name,
            teacherEmail: classData.teacherEmail,
            studentCount: (classData.students || []).length
          });
        } else {
          unassignedClasses.push({
            id: doc.id,
            name: classData.name,
            studentCount: (classData.students || []).length
          });
        }
      });
      
      const teachers = [];
      teachersSnapshot.forEach(doc => {
        const teacher = doc.data();
        teachers.push({
          email: doc.id,
          name: teacher.name,
          role: teacher.role
        });
      });
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          status: {
            totalClasses: classesSnapshot.size,
            unassignedClasses: unassignedClasses.length,
            assignedClasses: assignedClasses.length,
            totalTeachers: teachersSnapshot.size
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

        const classDoc = await db.collection('classes').doc(classId).get();
        if (!classDoc.exists) {
          return {
            statusCode: 404,
            headers,
            body: JSON.stringify({ success: false, error: 'Class not found' })
          };
        }

        const teacherDoc = await db.collection('teachers').doc(teacherEmail.toLowerCase()).get();
        if (!teacherDoc.exists) {
          return {
            statusCode: 404,
            headers,
            body: JSON.stringify({ success: false, error: 'Teacher not found' })
          };
        }

        const classData = classDoc.data();
        const teacher = teacherDoc.data();

        // Update class
        await db.collection('classes').doc(classId).update({
          teacher: teacher.name,
          teacherEmail: teacherEmail.toLowerCase(),
          updatedAt: new Date().toISOString()
        });

        // Update all students in the class
        let studentsUpdated = 0;
        for (const studentEmail of (classData.students || [])) {
          try {
            const studentDoc = await db.collection('students').doc(studentEmail).get();
            if (studentDoc.exists) {
              await db.collection('students').doc(studentEmail).update({
                teacher: teacher.name,
                teacherEmail: teacherEmail.toLowerCase()
              });
              studentsUpdated++;
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
            studentsUpdated
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
            const classDoc = await db.collection('classes').doc(classId).get();
            const teacherDoc = await db.collection('teachers').doc(teacherEmail.toLowerCase()).get();
            
            if (!classDoc.exists || !teacherDoc.exists) {
              results.failed.push({ classId, error: 'Class or teacher not found' });
              continue;
            }

            const classData = classDoc.data();
            const teacher = teacherDoc.data();

            await db.collection('classes').doc(classId).update({
              teacher: teacher.name,
              teacherEmail: teacherEmail.toLowerCase(),
              updatedAt: new Date().toISOString()
            });

            // Update students
            for (const studentEmail of (classData.students || [])) {
              try {
                const studentDoc = await db.collection('students').doc(studentEmail).get();
                if (studentDoc.exists) {
                  await db.collection('students').doc(studentEmail).update({
                    teacher: teacher.name,
                    teacherEmail: teacherEmail.toLowerCase()
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
        const classesSnapshot = await db.collection('classes').where('teacherEmail', '==', null).get();
        const results = { claimed: [], errors: [] };

        for (const doc of classesSnapshot.docs) {
          try {
            const classData = doc.data();
            
            await db.collection('classes').doc(doc.id).update({
              teacher: sessionCheck.name,
              teacherEmail: sessionCheck.email,
              updatedAt: new Date().toISOString()
            });

            // Update students
            for (const studentEmail of (classData.students || [])) {
              try {
                const studentDoc = await db.collection('students').doc(studentEmail).get();
                if (studentDoc.exists) {
                  await db.collection('students').doc(studentEmail).update({
                    teacher: sessionCheck.name,
                    teacherEmail: sessionCheck.email
                  });
                }
              } catch (e) {
                // Continue
              }
            }

            results.claimed.push({ id: doc.id, name: classData.name });
          } catch (e) {
            results.errors.push({ classId: doc.id, error: e.message });
          }
        }

        // Also check for classes with no teacherEmail field at all
        const allClassesSnapshot = await db.collection('classes').get();
        for (const doc of allClassesSnapshot.docs) {
          const classData = doc.data();
          if (!classData.teacherEmail && !results.claimed.find(c => c.id === doc.id)) {
            try {
              await db.collection('classes').doc(doc.id).update({
                teacher: sessionCheck.name,
                teacherEmail: sessionCheck.email,
                updatedAt: new Date().toISOString()
              });

              // Update students
              for (const studentEmail of (classData.students || [])) {
                try {
                  const studentDoc = await db.collection('students').doc(studentEmail).get();
                  if (studentDoc.exists) {
                    await db.collection('students').doc(studentEmail).update({
                      teacher: sessionCheck.name,
                      teacherEmail: sessionCheck.email
                    });
                  }
                } catch (e) {
                  // Continue
                }
              }

              results.claimed.push({ id: doc.id, name: classData.name });
            } catch (e) {
              results.errors.push({ classId: doc.id, error: e.message });
            }
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

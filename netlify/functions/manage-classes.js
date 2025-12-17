// Class Management Function
// Handles CRUD for classes and assignment management

const { getStore } = require("@netlify/blobs");

// Generate a simple class ID from name
function generateClassId(name) {
  return name.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') + 
    '-' + Date.now().toString(36);
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
    const classesStore = getStore("classes");
    const studentsStore = getStore("students");

    // GET - List all classes or get specific class
    if (event.httpMethod === 'GET') {
      const classId = event.queryStringParameters?.classId;
      const teacherEmail = event.queryStringParameters?.teacherEmail;
      
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
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, class: classData })
        };
      }
      
      // List all classes (optionally filtered by teacher)
      const { blobs } = await classesStore.list();
      const classes = [];
      
      for (const blob of blobs) {
        try {
          const classData = await classesStore.get(blob.key, { type: 'json' });
          if (classData) {
            // Filter by teacher if specified
            if (teacherEmail && classData.teacherEmail !== teacherEmail.toLowerCase()) continue;
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

        const classData = {
          id: classId,
          name: name.trim(),
          subject: subject || 'English',
          yearGroup: yearGroup || null,
          teacher: teacher || null,
          teacherEmail: teacherEmail?.toLowerCase() || null,
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

        const classData = await classesStore.get(classId, { type: 'json' });
        if (!classData) {
          return {
            statusCode: 404,
            headers,
            body: JSON.stringify({ success: false, error: 'Class not found' })
          };
        }

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

        const classData = await classesStore.get(classId, { type: 'json' });
        if (!classData) {
          return {
            statusCode: 404,
            headers,
            body: JSON.stringify({ success: false, error: 'Class not found' })
          };
        }

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

        const results = { updated: [], notFound: [] };

        for (const email of studentEmails) {
          const emailLower = email.trim().toLowerCase();
          const studentData = await studentsStore.get(emailLower, { type: 'json' });
          
          if (!studentData) {
            results.notFound.push(emailLower);
            continue;
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

      // Apply allowed updates
      const allowedFields = ['name', 'subject', 'yearGroup', 'teacher', 'teacherEmail', 'assignedEssays'];
      const updatedData = { ...classData };
      
      for (const field of allowedFields) {
        if (updates[field] !== undefined) {
          updatedData[field] = updates[field];
        }
      }

      // If teacher info changed, update all students in class
      if (updates.teacher !== undefined || updates.teacherEmail !== undefined) {
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

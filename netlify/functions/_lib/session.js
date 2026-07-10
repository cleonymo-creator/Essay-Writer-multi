// Shared session verification for Netlify functions.
//
// Verifies a bearer token against the student `sessions` collection and the
// `teacherSessions` collection. Returns the authenticated identity so callers
// can bind writes to it rather than trusting client-supplied identifiers.
//
// This is intentionally minimal (identity + role), seeding the fuller _lib
// refactor described in Phase 2 of IMPROVEMENT_PLAN.md.

const { initializeFirebase, firestoreTimeout } = require('../firebase-helper');

// Pull a bearer token from the Authorization header, falling back to a
// ?sessionToken query param for GET requests that cannot set headers easily.
function getSessionToken(event) {
  const authHeader = event.headers.authorization || event.headers.Authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  return event.queryStringParameters?.sessionToken || null;
}

function notExpired(session) {
  if (!session || !session.expiresAt) return false;
  const expiresAt = session.expiresAt.toDate
    ? session.expiresAt.toDate()
    : new Date(session.expiresAt);
  return expiresAt >= new Date();
}

// Verify a token belongs to a valid, unexpired student or teacher session.
// Returns { valid, email, role } where role is 'student' | 'teacher' | null.
async function verifyAnySession(event) {
  const token = getSessionToken(event);
  if (!token) return { valid: false, error: 'Authentication required', email: null, role: null };

  const db = initializeFirebase();

  // Student session
  try {
    const doc = await firestoreTimeout(db.collection('sessions').doc(token).get());
    if (doc.exists && notExpired(doc.data())) {
      return { valid: true, email: (doc.data().email || '').toLowerCase(), role: 'student' };
    }
  } catch (e) {
    // fall through to teacher check
  }

  // Teacher session
  try {
    const doc = await firestoreTimeout(db.collection('teacherSessions').doc(token).get());
    if (doc.exists && notExpired(doc.data())) {
      return { valid: true, email: (doc.data().email || '').toLowerCase(), role: 'teacher' };
    }
  } catch (e) {
    // fall through
  }

  return { valid: false, error: 'Invalid or expired session', email: null, role: null };
}

// Verify a token belongs to a valid, unexpired ADMIN teacher session.
// Checks Firestore first, then the legacy Netlify Blobs stores that predate
// the Firestore migration (callers must run connectLambda(event) first).
// Returns { valid, email, name } on success.
// Extracted here from the near-identical copies in the generate-essay-* and
// extract-pdf-content functions; manage-essays.js and
// migrate-to-firebase-auth.js still carry inline copies to be migrated.
async function verifyAdminSession(sessionToken) {
  if (!sessionToken) {
    return { valid: false, error: 'No session token provided' };
  }

  try {
    const db = initializeFirebase();
    if (db) {
      const sessionDoc = await firestoreTimeout(db.collection('teacherSessions').doc(sessionToken).get());
      if (sessionDoc.exists) {
        const session = sessionDoc.data();
        if (!notExpired(session)) {
          return { valid: false, error: 'Session expired' };
        }

        const teacherDoc = await firestoreTimeout(db.collection('teachers').doc(session.email).get());
        if (!teacherDoc.exists) {
          return { valid: false, error: 'Teacher not found' };
        }

        const teacher = teacherDoc.data();
        if (teacher.role !== 'admin') {
          return { valid: false, error: 'Admin access required' };
        }

        return { valid: true, email: session.email, name: teacher.name };
      }
    }

    // Legacy Netlify Blobs fallback
    const { getStore } = require('@netlify/blobs');
    const session = await getStore('teacher-sessions').get(sessionToken, { type: 'json' });
    if (!session) {
      return { valid: false, error: 'Invalid session' };
    }
    if (!notExpired(session)) {
      return { valid: false, error: 'Session expired' };
    }

    const teacher = await getStore('teachers').get(session.email, { type: 'json' });
    if (!teacher || teacher.role !== 'admin') {
      return { valid: false, error: 'Admin access required' };
    }

    return { valid: true, email: session.email, name: teacher.name };
  } catch (error) {
    console.error('Session verification error:', error);
    return { valid: false, error: 'Session verification failed' };
  }
}

module.exports = { getSessionToken, verifyAnySession, verifyAdminSession };

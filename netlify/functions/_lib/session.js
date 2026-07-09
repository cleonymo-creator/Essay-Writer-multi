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

module.exports = { getSessionToken, verifyAnySession };

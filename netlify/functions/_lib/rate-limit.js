// Durable, per-identity rate limiting for expensive (AI) endpoints.
//
// The only pre-existing limiter was an in-memory counter that reset on every
// cold start and was per-instance, so it provided no real protection. This
// uses a Firestore-backed fixed-window counter keyed by identity + endpoint,
// which survives cold starts and is shared across function instances.
//
// Fixed windows are simple and adequate here (the goal is abuse/cost control,
// not precise fairness). A failure to read/write the limiter never blocks a
// legitimate request — we fail open so a Firestore hiccup can't lock students
// out of grading.

const { initializeFirebase, firestoreTimeout } = require('../firebase-helper');

// Returns { allowed: boolean, retryAfterSeconds?: number }.
// key: a stable identity string (session email, or IP as a fallback).
// endpoint: short name so limits are per-endpoint.
// limit: max requests per window. windowSeconds: window length.
async function checkRateLimit(key, endpoint, { limit = 20, windowSeconds = 60 } = {}) {
  if (!key) return { allowed: true }; // nothing to key on; fail open

  try {
    const db = initializeFirebase();
    const safeKey = String(key).toLowerCase().replace(/[^a-z0-9@._-]/g, '_');
    const docId = `${endpoint}__${safeKey}`;
    const ref = db.collection('rateLimits').doc(docId);

    const result = await firestoreTimeout(db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const now = Date.now();
      const windowMs = windowSeconds * 1000;
      const data = snap.exists ? snap.data() : null;

      // Start a fresh window if none exists or the current one has elapsed.
      if (!data || !data.windowStart || now - data.windowStart >= windowMs) {
        tx.set(ref, { windowStart: now, count: 1, endpoint });
        return { allowed: true };
      }

      if (data.count >= limit) {
        const retryAfterSeconds = Math.ceil((data.windowStart + windowMs - now) / 1000);
        return { allowed: false, retryAfterSeconds: Math.max(1, retryAfterSeconds) };
      }

      tx.update(ref, { count: data.count + 1 });
      return { allowed: true };
    }), 3000);

    return result;
  } catch (e) {
    // Fail open — never block a legitimate user because the limiter errored.
    console.warn('[rate-limit] check failed, allowing request:', e.message);
    return { allowed: true };
  }
}

// Best-effort client IP for anonymous fallback keying.
function getClientIp(event) {
  const xff = event.headers['x-forwarded-for'] || event.headers['X-Forwarded-For'];
  if (xff) return xff.split(',')[0].trim();
  return event.headers['client-ip'] || event.headers['x-nf-client-connection-ip'] || null;
}

module.exports = { checkRateLimit, getClientIp };

// Get/set the teacher's essay-generator defaults - Admin only.
// Stored on the teacher's Firestore document so defaults follow the teacher
// across devices (localStorage keeps a per-device copy as a fallback).
const { connectLambda } = require('@netlify/blobs');
const { initializeFirebase } = require('./firebase-helper');
const { getSessionToken, verifyAdminSession } = require('./_lib/session');

const ALLOWED_FIELDS = ['subject', 'yearGroup', 'examBoard', 'minWords', 'targetWords', 'maxAttempts'];

exports.handler = async (event, context) => {
  connectLambda(event);

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const authResult = await verifyAdminSession(getSessionToken(event));
  if (!authResult.valid) {
    return { statusCode: 403, headers, body: JSON.stringify({ success: false, error: authResult.error }) };
  }

  try {
    const db = initializeFirebase();
    if (!db) {
      // No Firestore: defaults simply don't roam; the client's localStorage
      // copy still works, so report an empty result rather than an error.
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(event.httpMethod === 'GET' ? { success: true, defaults: null } : { success: false, error: 'Storage unavailable' })
      };
    }

    const teacherRef = db.collection('teachers').doc(authResult.email);

    if (event.httpMethod === 'GET') {
      const doc = await teacherRef.get();
      const defaults = doc.exists ? (doc.data().generatorDefaults || null) : null;
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, defaults }) };
    }

    const body = JSON.parse(event.body);
    const incoming = body.defaults || {};
    const defaults = {};
    for (const field of ALLOWED_FIELDS) {
      if (incoming[field] != null && String(incoming[field]).trim() !== '') {
        defaults[field] = String(incoming[field]).slice(0, 200);
      }
    }

    await teacherRef.set({ generatorDefaults: defaults }, { merge: true });
    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };

  } catch (error) {
    console.error('Teacher preferences error:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: error.message }) };
  }
};

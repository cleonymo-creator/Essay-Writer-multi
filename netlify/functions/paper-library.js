// Shared past-paper library - Admin only.
// A paper's extracted content (question, source material, mark scheme, grade
// boundaries) is saved once and reusable by every teacher, so the same
// AQA June 2023 Paper 1 never has to be found, uploaded and extracted twice.
//
//   GET               → list library entries (metadata only)
//   GET ?id=...       → one full entry
//   POST { paper }    → save an entry
//   DELETE ?id=...    → remove an entry
const { connectLambda } = require('@netlify/blobs');
const { initializeFirebase, firestoreTimeout } = require('./firebase-helper');
const { getSessionToken, verifyAdminSession } = require('./_lib/session');

// Large text fields are capped so a single entry stays well under the 1MiB
// Firestore document limit.
const TEXT_FIELDS = { examQuestion: 100000, sourceMaterial: 400000, markScheme: 200000 };
const META_FIELDS = ['title', 'subject', 'level', 'yearGroup', 'examBoard', 'examSeries', 'paperName'];

exports.handler = async (event, context) => {
  connectLambda(event);

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const authResult = await verifyAdminSession(getSessionToken(event));
  if (!authResult.valid) {
    return { statusCode: 403, headers, body: JSON.stringify({ success: false, error: authResult.error }) };
  }

  try {
    const db = initializeFirebase();
    if (!db) {
      return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: 'Storage unavailable' }) };
    }
    const collection = db.collection('paperResources');

    if (event.httpMethod === 'GET') {
      const id = event.queryStringParameters?.id;
      if (id) {
        const doc = await firestoreTimeout(collection.doc(id).get());
        if (!doc.exists) {
          return { statusCode: 404, headers, body: JSON.stringify({ success: false, error: 'Paper not found' }) };
        }
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, paper: { id: doc.id, ...doc.data() } }) };
      }

      const snapshot = await firestoreTimeout(collection.orderBy('savedAt', 'desc').limit(100).get());
      const papers = snapshot.docs.map(doc => {
        const d = doc.data();
        return {
          id: doc.id,
          title: d.title || '',
          subject: d.subject || '',
          level: d.level || '',
          examBoard: d.examBoard || '',
          examSeries: d.examSeries || '',
          paperName: d.paperName || '',
          totalMarks: d.totalMarks || null,
          hasMarkScheme: !!(d.markScheme && d.markScheme.trim()),
          gradeBoundaryCount: Array.isArray(d.gradeBoundaries) ? d.gradeBoundaries.length : 0,
          savedByName: d.savedByName || d.savedBy || '',
          savedAt: d.savedAt || null
        };
      });
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, papers }) };
    }

    if (event.httpMethod === 'POST') {
      const { paper } = JSON.parse(event.body);
      if (!paper || !paper.examQuestion || !String(paper.examQuestion).trim()) {
        return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'A paper needs at least an exam question.' }) };
      }

      const entry = {
        savedBy: authResult.email,
        savedByName: authResult.name || authResult.email,
        savedAt: Date.now()
      };
      for (const field of META_FIELDS) {
        entry[field] = String(paper[field] || '').slice(0, 500);
      }
      for (const [field, cap] of Object.entries(TEXT_FIELDS)) {
        const value = String(paper[field] || '');
        if (value.length > cap) {
          return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: `${field} is too large to store in the library.` }) };
        }
        entry[field] = value;
      }
      entry.totalMarks = parseInt(paper.totalMarks) || null;
      entry.selectedQuestions = Array.isArray(paper.selectedQuestions) ? paper.selectedQuestions.slice(0, 20).map(String) : [];
      entry.gradeBoundaries = Array.isArray(paper.gradeBoundaries)
        ? paper.gradeBoundaries.slice(0, 20)
            .filter(b => b && b.grade != null)
            .map(b => ({ grade: String(b.grade), minMarks: Number(b.minMarks) || 0, maxMarks: Number(b.maxMarks) || 0 }))
        : [];
      if (!entry.title) {
        entry.title = [entry.subject, entry.examBoard, entry.paperName, entry.examSeries].filter(Boolean).join(' - ') || 'Untitled paper';
      }

      const ref = await firestoreTimeout(collection.add(entry));
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, id: ref.id }) };
    }

    if (event.httpMethod === 'DELETE') {
      const id = event.queryStringParameters?.id;
      if (!id) {
        return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Missing id' }) };
      }
      await firestoreTimeout(collection.doc(id).delete());
      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  } catch (error) {
    console.error('Paper library error:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: error.message }) };
  }
};

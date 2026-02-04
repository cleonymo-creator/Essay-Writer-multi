// Extract exam question(s) and source material from uploaded PDF text using Claude
const https = require('https');
const { getStore, connectLambda } = require('@netlify/blobs');
const { initializeFirebase } = require('./firebase-helper');

// Verify admin session
async function verifyAdminSession(sessionToken) {
  if (!sessionToken) {
    return { valid: false, error: 'No session token provided' };
  }

  try {
    const db = initializeFirebase();
    if (db) {
      const sessionDoc = await db.collection('teacherSessions').doc(sessionToken).get();
      if (sessionDoc.exists) {
        const session = sessionDoc.data();
        if (new Date(session.expiresAt.toDate ? session.expiresAt.toDate() : session.expiresAt) < new Date()) {
          return { valid: false, error: 'Session expired' };
        }

        const teacherDoc = await db.collection('teachers').doc(session.email).get();
        if (!teacherDoc.exists) {
          return { valid: false, error: 'Teacher not found' };
        }

        const teacher = teacherDoc.data();
        if (teacher.role !== 'admin') {
          return { valid: false, error: 'Admin access required' };
        }

        return { valid: true, email: session.email };
      }
    }

    // Fallback to Netlify Blobs
    const teacherSessionsStore = getStore("teacher-sessions");
    const teachersStore = getStore("teachers");

    const session = await teacherSessionsStore.get(sessionToken, { type: 'json' });
    if (!session) {
      return { valid: false, error: 'Invalid session' };
    }

    const teacher = await teachersStore.get(session.email, { type: 'json' });
    if (!teacher || teacher.role !== 'admin') {
      return { valid: false, error: 'Admin access required' };
    }

    return { valid: true, email: session.email };
  } catch (error) {
    console.error('Session verification error:', error);
    return { valid: false, error: 'Session verification failed' };
  }
}

function getSessionToken(event) {
  const authHeader = event.headers.authorization || event.headers.Authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  return event.queryStringParameters?.sessionToken || null;
}

function makeRequest(apiKey, messages) {
  return new Promise((resolve, reject) => {
    const requestBody = JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      messages: messages
    });

    const options = {
      hostname: 'api.anthropic.com',
      port: 443,
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(requestBody)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(res.statusCode !== 200 ? { error: parsed } : parsed);
        } catch (e) {
          resolve({ error: data });
        }
      });
    });
    req.on('error', reject);
    req.write(requestBody);
    req.end();
  });
}

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

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // Verify admin session
  const sessionToken = getSessionToken(event);
  const authResult = await verifyAdminSession(sessionToken);
  if (!authResult.valid) {
    return {
      statusCode: 403,
      headers,
      body: JSON.stringify({ success: false, error: authResult.error })
    };
  }

  try {
    const body = JSON.parse(event.body);
    const { pdfText, subject, examBoard, paperName, selectedQuestions } = body;

    if (!pdfText || !pdfText.trim()) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'No PDF text provided' })
      };
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ success: false, error: 'API key not configured' })
      };
    }

    // Build the question selection context
    const hasSelectedQuestions = selectedQuestions && Array.isArray(selectedQuestions) && selectedQuestions.length > 0;
    const selectionContext = hasSelectedQuestions
      ? `\n\nIMPORTANT - SPECIFIC QUESTIONS SELECTED:\nThe teacher has selected ONLY the following question(s) from this paper. Extract ONLY these specific questions and their associated source material/extracts. Ignore all other questions on the paper.\n\nSelected questions:\n${selectedQuestions.map(q => `- ${q}`).join('\n')}\n`
      : '';

    const prompt = `You are an expert at reading UK exam question papers. I have extracted text from a PDF question paper. Please identify and extract the following:

1. **Exam Question(s)**: The actual question(s) that students need to answer. Include the full question text, any sub-parts, bullet points, and mark allocations.

2. **Source Material / Extract(s)**: Any text extracts, passages, poems, data, or source material that students need to read and reference in their answers. This might be labelled as "Extract", "Source", "Text", "Insert", "Resource Material", or similar. Include the full text of any extracts.

${subject ? `Subject: ${subject}` : ''}
${examBoard ? `Exam Board: ${examBoard}` : ''}
${paperName ? `Paper: ${paperName}` : ''}${selectionContext}

Here is the extracted PDF text:

---
${pdfText}
---

Please respond in EXACTLY this JSON format (no markdown code fences, just raw JSON):
{
  "examQuestion": "The full exam question text here, including any sub-parts and mark allocations",
  "sourceMaterial": "The full source material / extract text here. If there are multiple extracts, include them all separated by line breaks. If there is no source material, use an empty string.",
  "totalMarks": null,
  "examSeries": "The exam series/session and year, e.g. 'June 2023', 'November 2024', 'Sample Paper 2025'. If not identifiable, use an empty string.",
  "summary": "A brief 1-sentence summary of what this question paper asks students to do"
}

IMPORTANT:
- Extract the COMPLETE text of both the question and source material - do not summarise or truncate
- Preserve the original formatting as much as possible (line breaks, indentation)${hasSelectedQuestions ? '\n- ONLY extract the specific selected question(s) listed above - do NOT include other questions from the paper' : '\n- If there are multiple questions on the paper, extract ALL of them'}
- Only include source material/extracts that are relevant to the selected question(s)
- If you can identify the total marks for the question(s), include it as a number in totalMarks
- Look for the exam series/session and year (often in the header, e.g. "June 2023", "November 2024", "Specimen 2025"). Include it in examSeries if found
- Use plain ASCII characters only`;

    const messages = [{ role: 'user', content: prompt }];
    const claudeData = await makeRequest(apiKey, messages);

    if (claudeData.error) {
      console.error('Claude error:', JSON.stringify(claudeData.error));
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ success: false, error: 'AI extraction failed' })
      };
    }

    const responseText = claudeData.content[0].text.trim();

    // Parse the JSON response
    let extracted;
    try {
      // Try to parse directly
      extracted = JSON.parse(responseText);
    } catch (e) {
      // Try to extract JSON from markdown code fences
      const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        extracted = JSON.parse(jsonMatch[1].trim());
      } else {
        // Try to find JSON object in the response
        const objMatch = responseText.match(/\{[\s\S]*\}/);
        if (objMatch) {
          extracted = JSON.parse(objMatch[0]);
        } else {
          throw new Error('Could not parse AI response as JSON');
        }
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        examQuestion: extracted.examQuestion || '',
        sourceMaterial: extracted.sourceMaterial || '',
        totalMarks: extracted.totalMarks || null,
        examSeries: extracted.examSeries || '',
        summary: extracted.summary || ''
      })
    };

  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: error.message })
    };
  }
};

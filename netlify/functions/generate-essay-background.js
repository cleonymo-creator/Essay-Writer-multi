// Process essay generation in background - calls Claude and saves result.
// Uses structured output (forced tool use) so the model returns validated
// JSON instead of JavaScript source that has to be re-parsed.
const https = require('https');
const { getStore, connectLambda } = require('@netlify/blobs');
const { initializeFirebase } = require('./firebase-helper');

// Verify admin session (same as start/check functions)
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

    if (new Date(session.expiresAt) < new Date()) {
      return { valid: false, error: 'Session expired' };
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

exports.handler = async (event, context) => {
  connectLambda(event);

  let jobId;
  let store;

  // Verify admin session so job processing can't be triggered anonymously
  const sessionToken = getSessionToken(event);
  const authResult = await verifyAdminSession(sessionToken);
  if (!authResult.valid) {
    return { statusCode: 403, body: JSON.stringify({ error: authResult.error }) };
  }

  try {
    const { jobId: id } = JSON.parse(event.body);
    jobId = id;

    console.log('Processing essay generation job:', jobId);

    store = getStore('essay-generation-jobs');

    let job = await store.get(jobId, { type: 'json' });
    if (!job) {
      console.error('Job not found:', jobId);
      return { statusCode: 404, body: JSON.stringify({ error: 'Job not found' }) };
    }

    // Idempotency: don't re-run completed jobs or ones another invocation
    // picked up recently (re-triggering would double the API spend).
    if (job.status === 'completed') {
      return { statusCode: 200, body: JSON.stringify({ status: 'completed' }) };
    }
    if (job.pickedUpAt && Date.now() - job.pickedUpAt < 20 * 60 * 1000 && job.status === 'processing') {
      console.log('Job already being processed, skipping duplicate trigger');
      return { statusCode: 200, body: JSON.stringify({ status: 'processing' }) };
    }
    job = { ...job, pickedUpAt: Date.now() };
    await store.setJSON(jobId, job);

    const body = job.input;
    console.log('Subject:', body.subject);

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      await store.setJSON(jobId, { ...job, status: 'error', error: 'ANTHROPIC_API_KEY not configured' });
      return { statusCode: 500, body: JSON.stringify({ error: 'API key not configured' }) };
    }

    console.log('Calling Claude Sonnet (structured output)...');
    const requestBody = buildRequest(body);
    const claudeData = await callClaudeWithRetry(apiKey, requestBody);
    console.log('Claude response received');

    if (claudeData.error) {
      console.error('Claude error:', JSON.stringify(claudeData.error));
      await store.setJSON(jobId, { ...job, status: 'error', error: claudeData.error });
      return { statusCode: 200, body: JSON.stringify({ status: 'error' }) };
    }

    if (claudeData.stop_reason === 'max_tokens') {
      const msg = 'The AI response was cut off before the essay was complete. Try again, or reduce the amount of source material / number of paragraphs.';
      await store.setJSON(jobId, { ...job, status: 'error', error: msg });
      return { statusCode: 200, body: JSON.stringify({ status: 'error' }) };
    }

    const toolBlock = (claudeData.content || []).find(b => b.type === 'tool_use' && b.name === 'create_essay_config');
    if (!toolBlock || !toolBlock.input) {
      await store.setJSON(jobId, { ...job, status: 'error', error: 'The AI did not return a structured essay configuration. Please try again.' });
      return { statusCode: 200, body: JSON.stringify({ status: 'error' }) };
    }

    const parsedEssay = assembleEssay(toolBlock.input, body);
    console.log('Essay assembled, paragraphs:', parsedEssay.paragraphs.length);

    // Keep a raw-config string for the "view raw" panel and legacy fallback
    const config = serializeConfig(parsedEssay);

    await store.setJSON(jobId, {
      ...job,
      status: 'completed',
      config: config,
      parsedEssay: parsedEssay,
      completedAt: Date.now()
    });

    console.log('Result saved successfully');
    return { statusCode: 200, body: JSON.stringify({ status: 'completed' }) };

  } catch (error) {
    console.error('Error:', error);
    if (store && jobId) {
      try {
        const job = await store.get(jobId, { type: 'json' });
        await store.setJSON(jobId, { ...job, status: 'error', error: error.message });
      } catch (e) {
        console.error('Failed to save error state:', e);
      }
    }
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};

function makeRequest(apiKey, requestBody) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(requestBody);

    const options = {
      hostname: 'api.anthropic.com',
      port: 443,
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(bodyStr)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(res.statusCode !== 200 ? { error: parsed, statusCode: res.statusCode } : parsed);
        } catch (e) {
          resolve({ error: data, statusCode: res.statusCode });
        }
      });
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

// One retry with backoff on rate limits, server errors and network failures
async function callClaudeWithRetry(apiKey, requestBody) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await makeRequest(apiKey, requestBody);
      if (!res.error) return res;
      lastError = res;
      const status = res.statusCode || 0;
      if (attempt === 0 && (status === 429 || status >= 500)) {
        console.warn('Claude returned', status, '- retrying in 5s');
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }
      return res;
    } catch (err) {
      lastError = { error: err.message };
      if (attempt === 0) {
        console.warn('Network error calling Claude - retrying in 5s:', err.message);
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }
    }
  }
  return lastError;
}

// JSON schema for the essay config, enforced by the API via forced tool use
function buildEssayTool(hasGradeBoundaries, examSeries) {
  const criterion = {
    type: 'object',
    required: ['weight', 'description'],
    properties: {
      weight: { type: 'number' },
      description: { type: 'string', description: 'Taken from the mark scheme' }
    }
  };

  const properties = {
    id: { type: 'string', description: "Lowercase with hyphens, e.g. 'creative-writing-sunset'" },
    title: { type: 'string', description: 'Title for this essay task' + (examSeries ? ` - include '${examSeries}' in the title` : '') },
    essayTitle: { type: 'string', description: 'The exam question exactly as students should see it' },
    instructions: { type: 'string', description: 'Clear instructions for students' },
    originalTask: { type: 'string', description: 'Markdown with two sections: "## Exam Question" (the full question) and "## Mark Scheme Summary" (the key criteria)' },
    paragraphs: {
      type: 'array',
      minItems: 4,
      maxItems: 6,
      items: {
        type: 'object',
        required: ['title', 'type', 'learningMaterial', 'writingPrompt', 'keyPoints'],
        properties: {
          title: { type: 'string', description: "e.g. 'Introduction'" },
          type: { type: 'string', enum: ['introduction', 'body', 'conclusion'] },
          learningMaterial: {
            type: 'object',
            required: ['foundation', 'intermediate', 'advanced'],
            properties: {
              foundation: { type: 'string', description: 'Markdown guidance: simplified language, step-by-step scaffolding (GCSE 1-4 / A-Level D-E)' },
              intermediate: { type: 'string', description: 'Markdown guidance: balanced, some analytical depth (GCSE 5-6 / A-Level C-B)' },
              advanced: { type: 'string', description: 'Markdown guidance: sophisticated techniques, nuanced analysis (GCSE 7-9 / A-Level A*-A)' }
            }
          },
          writingPrompt: { type: 'string', description: 'The clear instruction the student sees for this paragraph' },
          keyPoints: { type: 'array', items: { type: 'string' }, description: 'Mark scheme criteria relevant to this paragraph' },
          exampleQuotes: { type: 'array', items: { type: 'string' } }
        }
      }
    }
  };

  const required = ['id', 'title', 'essayTitle', 'instructions', 'originalTask', 'paragraphs'];

  if (hasGradeBoundaries) {
    properties.gradeBoundaries = {
      type: 'array',
      description: 'All grades from highest to lowest, interpolating any the teacher did not provide',
      items: {
        type: 'object',
        required: ['grade', 'minMarks', 'maxMarks', 'descriptor'],
        properties: {
          grade: { type: 'string' },
          minMarks: { type: 'number' },
          maxMarks: { type: 'number' },
          descriptor: { type: 'string' }
        }
      }
    };
    required.push('gradeBoundaries');
  } else {
    properties.gradingCriteria = {
      type: 'object',
      description: 'Weights must sum to 100; descriptions drawn from the mark scheme',
      required: ['content', 'analysis', 'structure', 'expression'],
      properties: {
        content: criterion,
        analysis: criterion,
        structure: criterion,
        expression: criterion
      }
    };
    required.push('gradingCriteria');
  }

  return {
    name: 'create_essay_config',
    description: 'Save the complete guided essay writing configuration.',
    input_schema: { type: 'object', required, properties }
  };
}

function buildRequest(data) {
  const {
    subject, yearGroup, examBoard, examSeries, totalMarks, timeAllowed, paperName,
    examQuestion, sourceMaterial, sourceFiles, markScheme, markSchemeFile,
    additionalNotes, minWords, targetWords, maxAttempts,
    selectedQuestionDescriptions, gradeBoundaries
  } = data;

  const content = [];

  // Add source files (images with extracted text or base64)
  if (sourceFiles?.length > 0) {
    for (const file of sourceFiles) {
      if (file.extractedText) {
        content.push({ type: 'text', text: `[Source file: ${file.name}]\n${file.extractedText}` });
      } else if (file.type?.startsWith('image/') && file.content) {
        content.push({ type: 'image', source: { type: 'base64', media_type: file.type, data: file.content } });
        content.push({ type: 'text', text: `[Image: ${file.name}]` });
      }
    }
  }

  // Add mark scheme file
  if (markSchemeFile?.extractedText) {
    content.push({ type: 'text', text: `[Mark scheme: ${markSchemeFile.name}]\n${markSchemeFile.extractedText}` });
  } else if (markSchemeFile?.type?.startsWith('image/') && markSchemeFile.content) {
    content.push({ type: 'image', source: { type: 'base64', media_type: markSchemeFile.type, data: markSchemeFile.content } });
    content.push({ type: 'text', text: `[Mark scheme image: ${markSchemeFile.name}]` });
  }

  const hasGradeBoundaries = gradeBoundaries && gradeBoundaries.length > 0;

  let gradeBoundariesSection = '';
  if (hasGradeBoundaries) {
    gradeBoundariesSection = `\n## GRADE BOUNDARIES (PROVIDED BY TEACHER)\n`;
    gradeBoundariesSection += `The following grade boundaries have been provided:\n`;
    gradeBoundaries.forEach(b => {
      gradeBoundariesSection += `- Grade ${b.grade}: ${b.minMarks || '?'}-${b.maxMarks || '?'} marks\n`;
    });
    gradeBoundariesSection += `\n**IMPORTANT:** Interpolate any missing grades between the provided boundaries.\n`;
  }

  const selectedQuestionsSection = selectedQuestionDescriptions?.length
    ? `\n## SELECTED QUESTION(S) FROM THIS PAPER\nThe teacher is targeting these specific questions - tailor the guidance to their demands and mark allocations:\n${selectedQuestionDescriptions.map(q => `- ${q}`).join('\n')}\n`
    : '';

  const prompt = `You are an expert educational content designer. Create a guided essay writing configuration by calling the create_essay_config tool.

## EXAM INFORMATION
- Subject: ${subject || 'Not specified'}
- Year Group: ${yearGroup || 'Not specified'}
- Exam Board: ${examBoard || 'Not specified'}
${examSeries ? `- Exam Series: ${examSeries}` : ''}
- Total Marks: ${totalMarks || 'Not specified'}
- Time Allowed: ${timeAllowed ? timeAllowed + ' minutes' : 'Not specified'}
${paperName ? `- Paper: ${paperName}` : ''}
${selectedQuestionsSection}
## EXAM QUESTION
${examQuestion || 'No question provided'}

${sourceMaterial ? `## SOURCE MATERIAL\n${sourceMaterial}\n` : ''}

## MARK SCHEME
${markScheme || 'No mark scheme provided - create appropriate criteria for this subject.'}
${gradeBoundariesSection}
${additionalNotes ? `## TEACHER NOTES\n${additionalNotes}\n` : ''}

## CONFIGURATION SETTINGS
- Min words/paragraph: ${minWords || 80}
- Target words/paragraph: ${targetWords || 150}
- Max attempts: ${maxAttempts || 3}

## DIFFERENTIATED LEARNING MATERIALS
Create learning materials at THREE difficulty tiers for EACH paragraph:
1. **Foundation** (GCSE 1-4 / A-Level D-E): Simplified language, step-by-step scaffolding
2. **Intermediate** (GCSE 5-6 / A-Level C-B): Balanced guidance, some analytical depth
3. **Advanced** (GCSE 7-9 / A-Level A*-A): Sophisticated techniques, nuanced analysis

## IMPORTANT RULES
- Use ONLY plain ASCII characters - no special symbols, emojis, or accented characters
- Use simple dashes (-) or asterisks (*) for bullet points in markdown fields
- Every paragraph's learningMaterial MUST have substantial content for all three tiers

## TASK
Create a complete essay configuration with 4-6 paragraphs (introduction, body paragraphs, conclusion) and call the create_essay_config tool with it.`;

  content.push({ type: 'text', text: prompt });

  return {
    model: 'claude-sonnet-5',
    thinking: { type: 'disabled' },
    max_tokens: 16000,
    tools: [buildEssayTool(hasGradeBoundaries, examSeries)],
    tool_choice: { type: 'tool', name: 'create_essay_config' },
    messages: [{ role: 'user', content }]
  };
}

// Combine the model's structured output with the teacher's actual inputs.
// Source material and exam metadata come straight from the wizard - no
// post-hoc regex injection into generated code.
function assembleEssay(toolInput, body) {
  const paragraphs = (toolInput.paragraphs || []).map((p, i) => ({
    exampleQuotes: [],
    keyPoints: [],
    ...p,
    id: i + 1
  }));

  if (paragraphs.length === 0) {
    throw new Error('The AI returned no paragraphs. Please try again.');
  }

  const sourceImages = (body.sourceFiles || [])
    .filter(f => f.type && f.type.startsWith('image/') && f.content)
    .map(f => ({
      name: f.name,
      type: f.type,
      caption: f.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '),
      data: f.content
    }));

  return {
    ...toolInput,
    id: (toolInput.id || 'generated-essay').toLowerCase().replace(/[^a-z0-9-]/g, '-'),
    subject: body.subject || 'Not specified',
    yearGroup: body.yearGroup || 'Not specified',
    totalMarks: parseInt(body.totalMarks) || 40,
    maxAttempts: parseInt(body.maxAttempts) || 3,
    minWordsPerParagraph: parseInt(body.minWords) || 80,
    targetWordsPerParagraph: parseInt(body.targetWords) || 150,
    sourceMaterial: (body.sourceMaterial || '').trim(),
    sourceImages,
    // Exam metadata, persisted on the essay so it can be filtered, reused
    // and consulted by grading later
    examBoard: body.examBoard || '',
    examSeries: body.examSeries || '',
    paperName: body.paperName || '',
    markScheme: (body.markScheme || body.markSchemeFile?.extractedText || '').trim(),
    selectedQuestions: body.selectedQuestionDescriptions || [],
    paragraphs
  };
}

// Raw-config string for the "view raw" panel and legacy client fallback.
// Base64 image data is redacted for readability; the parsed essay object is
// always the source of truth for saving.
function serializeConfig(essay) {
  const display = {
    ...essay,
    sourceImages: (essay.sourceImages || []).map(img => ({ ...img, data: '[base64 image data omitted]' }))
  };
  return 'window.ESSAYS = window.ESSAYS || {};\n' +
    'window.ESSAYS[' + JSON.stringify(essay.id) + '] = ' + JSON.stringify(display, null, 2) + ';';
}

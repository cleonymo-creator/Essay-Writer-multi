// Extract exam content from uploaded papers using Claude - Admin only.
//
// Two modes:
//   'question'   (default) - pull the exam question(s), source material,
//                marks and series out of a question paper
//   'markScheme' - clean up a mark scheme and detect grade boundaries
//
// Files arrive either as extracted text (from client-side pdf.js) or as
// base64 PDF data, which is sent to Claude as a native document block —
// this is what makes scanned papers work, since they have no text layer.
// The legacy { pdfText } body shape is still accepted.
const Anthropic = require('@anthropic-ai/sdk').default;
const { connectLambda } = require('@netlify/blobs');
const { getSessionToken, verifyAdminSession } = require('./_lib/session');
const { parseJsonResponse } = require('./_lib/anthropic');

let client;
function getClient() {
  if (!client) client = new Anthropic({ maxRetries: 2 });
  return client;
}

// ~4.5MB of base64 keeps the request under Netlify's payload limit
const MAX_TOTAL_BASE64 = 4.5 * 1024 * 1024;

function buildFileBlocks(body) {
  const blocks = [];
  const files = Array.isArray(body.files) ? [...body.files] : [];

  // Legacy shape: a single pre-extracted text blob
  if (files.length === 0 && body.pdfText) {
    files.push({ name: 'uploaded.pdf', text: body.pdfText });
  }

  let base64Budget = MAX_TOTAL_BASE64;
  for (const file of files) {
    if (file.base64 && file.base64.length <= base64Budget) {
      base64Budget -= file.base64.length;
      blocks.push({
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: file.base64 }
      });
      blocks.push({ type: 'text', text: `[The document above is: ${file.name || 'uploaded PDF'}]` });
    } else if (file.text && file.text.trim()) {
      blocks.push({ type: 'text', text: `[Extracted text of ${file.name || 'uploaded PDF'}]\n---\n${file.text}\n---` });
    }
  }
  return blocks;
}

function questionPrompt({ subject, examBoard, paperName, selectedQuestions }) {
  const hasSelected = Array.isArray(selectedQuestions) && selectedQuestions.length > 0;
  const selectionContext = hasSelected
    ? `\n\nIMPORTANT - SPECIFIC QUESTIONS SELECTED:\nThe teacher has selected ONLY the following question(s) from this paper. Extract ONLY these specific questions and their associated source material/extracts. Ignore all other questions on the paper.\n\nSelected questions:\n${selectedQuestions.map(q => `- ${q}`).join('\n')}\n`
    : '';

  return `You are an expert at reading UK exam question papers. Using the document(s) provided above, identify and extract:

1. **Exam Question(s)**: The actual question(s) that students need to answer. Include the full question text, any sub-parts, bullet points, and mark allocations.

2. **Source Material / Extract(s)**: Any text extracts, passages, poems, data, or source material that students need to read and reference in their answers. This might be labelled as "Extract", "Source", "Text", "Insert", "Resource Material", or similar. Include the full text of any extracts.

${subject ? `Subject: ${subject}` : ''}
${examBoard ? `Exam Board: ${examBoard}` : ''}
${paperName ? `Paper: ${paperName}` : ''}${selectionContext}

Respond in EXACTLY this JSON format (no markdown code fences, just raw JSON):
{
  "examQuestion": "The full exam question text here, including any sub-parts and mark allocations",
  "sourceMaterial": "The full source material / extract text here. If there are multiple extracts, include them all separated by line breaks. If there is no source material, use an empty string.",
  "totalMarks": null,
  "examSeries": "The exam series/session and year, e.g. 'June 2023', 'November 2024', 'Sample Paper 2025'. If not identifiable, use an empty string.",
  "summary": "A brief 1-sentence summary of what this question paper asks students to do"
}

IMPORTANT:
- Extract the COMPLETE text of both the question and source material - do not summarise or truncate
- Preserve the original formatting as much as possible (line breaks, indentation)${hasSelected ? '\n- ONLY extract the specific selected question(s) listed above - do NOT include other questions from the paper' : '\n- If there are multiple questions on the paper, extract ALL of them'}
- Only include source material/extracts that are relevant to the selected question(s)
- If you can identify the total marks for the question(s), include it as a number in totalMarks
- Look for the exam series/session and year (often in the header). Include it in examSeries if found
- Use plain ASCII characters only`;
}

function markSchemePrompt({ subject, examBoard, paperName, selectedQuestions }) {
  const hasSelected = Array.isArray(selectedQuestions) && selectedQuestions.length > 0;
  const selectionContext = hasSelected
    ? `\nThe teacher is using these question(s): ${selectedQuestions.join('; ')}. Extract the mark scheme content for these questions only.`
    : '';

  return `You are an expert at reading UK exam mark schemes. Using the document(s) provided above, extract the marking criteria.

${subject ? `Subject: ${subject}` : ''}
${examBoard ? `Exam Board: ${examBoard}` : ''}
${paperName ? `Paper: ${paperName}` : ''}${selectionContext}

Respond in EXACTLY this JSON format (no markdown code fences, just raw JSON):
{
  "markSchemeText": "The relevant mark scheme content as clean readable text: assessment objectives, level descriptors with their mark ranges, and key indicative content. Preserve the level structure (e.g. 'Level 4 (19-24 marks): ...'). Do not summarise away the descriptors - keep their full wording.",
  "gradeBoundaries": [],
  "summary": "A brief 1-sentence summary of what this mark scheme covers"
}

IMPORTANT:
- markSchemeText must contain the actual descriptors and mark ranges, not a summary of them
- If the document includes grade boundaries (grade letters/numbers mapped to mark ranges), return them in gradeBoundaries as [{"grade": "9", "minMarks": 34, "maxMarks": 40}, ...] from highest to lowest; otherwise return []
- Level descriptors (Level 1/2/3/4) are NOT grade boundaries - only actual grades (9-1, A*-E) belong in gradeBoundaries
- Use plain ASCII characters only`;
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

  const authResult = await verifyAdminSession(getSessionToken(event));
  if (!authResult.valid) {
    return {
      statusCode: 403,
      headers,
      body: JSON.stringify({ success: false, error: authResult.error })
    };
  }

  try {
    const body = JSON.parse(event.body);
    const mode = body.mode === 'markScheme' ? 'markScheme' : 'question';

    const fileBlocks = buildFileBlocks(body);
    if (fileBlocks.length === 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'No readable file content provided' })
      };
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ success: false, error: 'API key not configured' })
      };
    }

    const prompt = mode === 'markScheme' ? markSchemePrompt(body) : questionPrompt(body);
    const content = [...fileBlocks, { type: 'text', text: prompt }];

    const response = await getClient().messages.create({
      model: 'claude-sonnet-5',
      thinking: { type: 'disabled' },
      max_tokens: 8000,
      messages: [{ role: 'user', content }]
    });

    if (response.stop_reason === 'max_tokens') {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ success: false, error: 'The document is too long to extract in one pass. Try uploading only the relevant pages.' })
      };
    }

    const textBlock = response.content.find(b => b.type === 'text');
    const extracted = parseJsonResponse(textBlock ? textBlock.text.trim() : '', 'extraction');

    if (mode === 'markScheme') {
      const boundaries = Array.isArray(extracted.gradeBoundaries)
        ? extracted.gradeBoundaries
            .filter(b => b && b.grade != null && b.minMarks != null && b.maxMarks != null)
            .map(b => ({ grade: String(b.grade), minMarks: Number(b.minMarks), maxMarks: Number(b.maxMarks) }))
        : [];
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          markSchemeText: extracted.markSchemeText || '',
          gradeBoundaries: boundaries,
          summary: extracted.summary || ''
        })
      };
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

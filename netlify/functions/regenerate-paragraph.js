// Regenerate a single paragraph of a generated essay - Admin only.
// A synchronous call (like the grading functions): one paragraph is a small
// enough output to return directly, so the teacher can iterate on weak
// guidance without regenerating (and paying for) the whole essay.
const Anthropic = require('@anthropic-ai/sdk').default;
const { getSessionToken, verifyAdminSession } = require('./_lib/session');

let client;
function getClient() {
  if (!client) client = new Anthropic({ maxRetries: 2 });
  return client;
}

const PARAGRAPH_TOOL = {
  name: 'create_paragraph',
  description: 'Save the regenerated paragraph configuration.',
  input_schema: {
    type: 'object',
    required: ['title', 'type', 'learningMaterial', 'writingPrompt', 'keyPoints'],
    properties: {
      title: { type: 'string' },
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
};

const truncate = (str, len) => {
  const s = (str || '').trim();
  return s.length > len ? s.slice(0, len) + '\n[...truncated]' : s;
};

exports.handler = async (event, context) => {
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
    return { statusCode: 403, headers, body: JSON.stringify({ success: false, error: authResult.error }) };
  }

  try {
    const { essay, paragraph, paragraphIndex, instruction } = JSON.parse(event.body);
    if (!essay || !paragraph) {
      return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Missing essay context or paragraph' }) };
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: 'API key not configured' }) };
    }

    const paragraphTitles = (essay.paragraphTitles || []).map((t, i) =>
      `${i + 1}. ${t}${i === paragraphIndex ? '  <-- REGENERATE THIS ONE' : ''}`).join('\n');

    const prompt = `You are an expert educational content designer. An essay-writing guide has already been generated; the teacher wants ONE paragraph's guidance regenerated. Call the create_paragraph tool with the improved paragraph.

## ESSAY CONTEXT
- Subject: ${essay.subject || 'Not specified'}
- Year Group: ${essay.yearGroup || 'Not specified'}
- Exam Board: ${essay.examBoard || 'Not specified'}
- Exam Question: ${essay.essayTitle || 'Not specified'}
- Min/target words per paragraph: ${essay.minWordsPerParagraph || 80}/${essay.targetWordsPerParagraph || 150}

## ESSAY STRUCTURE
${paragraphTitles || 'Not specified'}

${essay.markScheme ? `## MARK SCHEME\n${truncate(essay.markScheme, 4000)}\n` : ''}
${essay.sourceMaterial ? `## SOURCE MATERIAL\n${truncate(essay.sourceMaterial, 4000)}\n` : ''}

## CURRENT PARAGRAPH (to regenerate)
${JSON.stringify(paragraph, null, 2)}

${instruction ? `## TEACHER'S INSTRUCTION\n${instruction}\n` : ''}

## RULES
- Keep the paragraph coherent with the rest of the essay structure - do not duplicate other paragraphs' focus
- Provide substantial markdown learning material for ALL THREE tiers (foundation, intermediate, advanced)
- Use ONLY plain ASCII characters; simple dashes (-) or asterisks (*) for bullets
${instruction ? '- Follow the teacher\'s instruction above - it is the reason for the regeneration' : '- Produce a noticeably improved version of the current paragraph'}`;

    const response = await getClient().messages.create({
      model: 'claude-sonnet-5',
      thinking: { type: 'disabled' },
      max_tokens: 6000,
      tools: [PARAGRAPH_TOOL],
      tool_choice: { type: 'tool', name: 'create_paragraph' },
      messages: [{ role: 'user', content: prompt }]
    });

    if (response.stop_reason === 'max_tokens') {
      return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: 'The response was cut off - please try again.' }) };
    }

    const toolBlock = (response.content || []).find(b => b.type === 'tool_use' && b.name === 'create_paragraph');
    if (!toolBlock || !toolBlock.input) {
      return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: 'The AI did not return a paragraph - please try again.' }) };
    }

    const result = { exampleQuotes: [], ...toolBlock.input };
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, paragraph: result }) };

  } catch (error) {
    console.error('Regenerate paragraph error:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: error.message }) };
  }
};

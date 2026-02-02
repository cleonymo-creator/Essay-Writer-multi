// Process essay generation in background - calls Claude and saves result
// Named without -background suffix but uses extended timeout via netlify.toml
const https = require('https');
const { getStore, connectLambda } = require('@netlify/blobs');

exports.handler = async (event, context) => {
  connectLambda(event);

  let jobId;
  let store;

  try {
    const { jobId: id } = JSON.parse(event.body);
    jobId = id;

    console.log('Processing essay generation job:', jobId);

    store = getStore('essay-generation-jobs');

    const job = await store.get(jobId, { type: 'json' });
    if (!job) {
      console.error('Job not found:', jobId);
      return { statusCode: 404, body: JSON.stringify({ error: 'Job not found' }) };
    }

    const body = job.input;
    console.log('Subject:', body.subject);

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      await store.setJSON(jobId, { ...job, status: 'error', error: 'ANTHROPIC_API_KEY not configured' });
      return { statusCode: 500, body: JSON.stringify({ error: 'API key not configured' }) };
    }

    console.log('Calling Claude Sonnet...');
    const messages = buildMessages(body);
    const claudeData = await makeRequest(apiKey, messages);
    console.log('Claude response received');

    if (claudeData.error) {
      console.error('Claude error:', JSON.stringify(claudeData.error));
      await store.setJSON(jobId, { ...job, status: 'error', error: claudeData.error });
      return { statusCode: 200, body: JSON.stringify({ status: 'error' }) };
    }

    let config = extractJavaScript(claudeData.content[0].text);
    console.log('Config generated, length:', config.length);

    // Post-process: inject actual source material
    config = injectSourceContent(config, body);
    console.log('Source content injected, final length:', config.length);

    // Save the result
    await store.setJSON(jobId, {
      ...job,
      status: 'completed',
      config: config,
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

function makeRequest(apiKey, messages) {
  return new Promise((resolve, reject) => {
    const requestBody = JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8000,
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

function buildMessages(data) {
  const {
    subject, yearGroup, examBoard, totalMarks, timeAllowed, paperName,
    examQuestion, sourceMaterial, sourceFiles, markScheme, markSchemeFile,
    additionalNotes, minWords, targetWords, maxAttempts,
    gradeBoundaries
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

  let gradingSection = hasGradeBoundaries ? `
  gradeBoundaries: [
    // Include all grades from highest to lowest with descriptors
    { grade: "[grade]", minMarks: [min], maxMarks: [max], descriptor: "[description]" }
  ]` : `
  gradingCriteria: {
    content: { weight: 30, description: "[From mark scheme]" },
    analysis: { weight: 30, description: "[From mark scheme]" },
    structure: { weight: 20, description: "[From mark scheme]" },
    expression: { weight: 20, description: "[From mark scheme]" }
  }`;

  const prompt = `You are an expert educational content designer. Create a guided essay writing configuration.

## EXAM INFORMATION
- Subject: ${subject || 'Not specified'}
- Year Group: ${yearGroup || 'Not specified'}
- Exam Board: ${examBoard || 'Not specified'}
- Total Marks: ${totalMarks || 'Not specified'}
- Time Allowed: ${timeAllowed ? timeAllowed + ' minutes' : 'Not specified'}
${paperName ? `- Paper: ${paperName}` : ''}

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

## IMPORTANT FORMATTING RULES
- Use ONLY plain ASCII characters - no special symbols, emojis, or accented characters
- Use simple dashes (-) or asterisks (*) for bullet points
- The essay ID should be lowercase with hyphens (e.g., 'creative-writing-sunset')

## TASK
Generate a complete essay configuration with 4-6 paragraphs. Output ONLY valid JavaScript:

\`\`\`javascript
window.ESSAYS = window.ESSAYS || {};
window.ESSAYS['[essay-id-here]'] = {
  id: '[essay-id-here]',
  title: "[Title for this essay task]",
  subject: "${subject || 'Subject'}",
  yearGroup: "${yearGroup || 'Year'}",
  totalMarks: ${totalMarks || 40},
  essayTitle: "[The exam question]",
  instructions: "[Clear instructions for students]",
  originalTask: \`## Exam Question
[Full question]

## Mark Scheme Summary
[Key criteria]\`,
  sourceMaterial: \`[Include the full source material text here]\`,
  sourceImages: [],
  maxAttempts: ${maxAttempts || 3},
  minWordsPerParagraph: ${minWords || 80},
  targetWordsPerParagraph: ${targetWords || 150},
  paragraphs: [
    {
      id: 1,
      title: "Introduction",
      type: "introduction",
      learningMaterial: {
        foundation: \`## Writing Your Introduction (Foundation)\n[Simple guidance...]\`,
        intermediate: \`## Writing Your Introduction (Intermediate)\n[Balanced guidance...]\`,
        advanced: \`## Writing Your Introduction (Advanced)\n[Sophisticated guidance...]\`
      },
      writingPrompt: "[Clear instruction]",
      keyPoints: ["[Mark scheme criterion]"],
      exampleQuotes: []
    },
    // More paragraphs...
    {
      id: [n],
      title: "Conclusion",
      type: "conclusion",
      learningMaterial: {
        foundation: \`[...]\`,
        intermediate: \`[...]\`,
        advanced: \`[...]\`
      },
      writingPrompt: "[Instruction]",
      keyPoints: ["[Criterion]"],
      exampleQuotes: []
    }
  ],${gradingSection}
};
\`\`\`

REMEMBER: Every paragraph's learningMaterial MUST be an object with foundation, intermediate, and advanced keys.`;

  content.push({ type: 'text', text: prompt });
  return [{ role: 'user', content }];
}

function extractJavaScript(text) {
  const match = text.match(/```(?:javascript|js)?\s*([\s\S]*?)```/);
  if (match) return match[1].trim();
  const configMatch = text.match(/(window\.ESSAYS[\s\S]*};?)/);
  if (configMatch) return configMatch[1].trim();
  return text.trim();
}

function injectSourceContent(config, body) {
  const { sourceMaterial, sourceFiles } = body;

  function escapeForTemplateLiteral(str) {
    if (!str) return '';
    return str.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
  }

  if (sourceMaterial && sourceMaterial.trim()) {
    const escapedMaterial = escapeForTemplateLiteral(sourceMaterial.trim());
    config = config.replace(
      /sourceMaterial:\s*`\[Include the full source material[^\`]*\]`/,
      `sourceMaterial: \`${escapedMaterial}\``
    );
  }

  if (sourceFiles && sourceFiles.length > 0) {
    const imageObjects = sourceFiles
      .filter(f => f.type && f.type.startsWith('image/') && f.content)
      .map(f => ({
        name: f.name,
        type: f.type,
        caption: f.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '),
        data: f.content
      }));

    if (imageObjects.length > 0) {
      const imagesArrayStr = JSON.stringify(imageObjects, null, 4);
      config = config.replace(/sourceImages:\s*\[\]/, `sourceImages: ${imagesArrayStr}`);
    }
  }

  return config;
}

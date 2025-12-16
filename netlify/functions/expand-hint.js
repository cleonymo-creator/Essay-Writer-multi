// Expand a hint or tip using Claude Haiku for more detailed explanation
const Anthropic = require("@anthropic-ai/sdk").default;

const client = new Anthropic();

exports.handler = async (event) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      },
      body: ''
    };
  }

  if (event.httpMethod !== "POST") {
    return { 
      statusCode: 405, 
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: "Method not allowed" 
    };
  }

  try {
    const { hint, context, subject, targetGrade } = JSON.parse(event.body);
    
    if (!hint || hint.trim().length === 0) {
      return {
        statusCode: 400,
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ error: 'Hint text is required' })
      };
    }

    // Determine the appropriate explanation level based on target grade
    const getExplanationLevel = (grade) => {
      const highGrades = ['9', '8', '7', 'A*', 'A'];
      const foundationGrades = ['3', '2', '1', 'D', 'E'];
      if (highGrades.includes(grade)) return 'advanced';
      if (foundationGrades.includes(grade)) return 'foundation';
      return 'intermediate';
    };

    const level = getExplanationLevel(targetGrade || '5');
    
    const levelInstructions = {
      foundation: `Explain in simple, accessible language suitable for a student working at foundation level. 
- Use short sentences and simple vocabulary
- Give a concrete, relatable example
- Avoid jargon or explain any technical terms used
- Keep the explanation to 2-3 short paragraphs maximum`,
      intermediate: `Explain clearly with appropriate academic vocabulary for a GCSE/A-Level student.
- Define key terms
- Give a relevant example showing how to apply this
- Connect to exam success where relevant
- Keep the explanation focused and practical (3-4 paragraphs)`,
      advanced: `Provide a sophisticated explanation suitable for a high-achieving student.
- Use precise academic terminology
- Explain nuances and complexities
- Suggest how this could be used to achieve top grades
- Reference exam board expectations where relevant
- Can be more detailed (4-5 paragraphs) but stay focused`
    };

    const systemPrompt = `You are a knowledgeable and helpful teacher providing additional explanation for essay writing hints and tips.

Your task is to expand on a specific hint or piece of advice, making it more concrete and actionable for the student.

${levelInstructions[level]}

Important guidelines:
- Be specific and practical - give examples the student can actually use
- If the hint mentions a theory, concept, or technique, explain what it is and how to apply it
- If the hint mentions a literary device, explain it with examples
- Connect your explanation to how it helps improve essay writing
- Format your response in clear paragraphs (no bullet points or headers)
- Don't start with "This hint is about..." - dive straight into the explanation`;

    const userPrompt = `${context ? `Context: This is for a ${subject || 'English'} essay. ${context}\n\n` : ''}The student clicked on this hint for more information:

"${hint}"

Please explain this in more detail, making it practical and actionable for the student.`;

    const response = await client.messages.create({
      model: "claude-haiku-4-20250414",
      max_tokens: 500,
      messages: [
        {
          role: "user",
          content: userPrompt
        }
      ],
      system: systemPrompt
    });

    const explanation = response.content[0].text;

    return {
      statusCode: 200,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: true,
        hint: hint,
        explanation: explanation
      })
    };

  } catch (error) {
    console.error("Hint expansion error:", error);
    return {
      statusCode: 500,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: false,
        error: "Failed to expand hint",
        details: error.message
      })
    };
  }
};

// Grade a single paragraph with detailed feedback for revision
const Anthropic = require("@anthropic-ai/sdk").default;

const client = new Anthropic();

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  try {
    const {
      paragraphText,
      paragraphConfig,
      attemptNumber,
      maxAttempts,
      previousFeedback,
      essayTitle,
      gradingCriteria
    } = JSON.parse(event.body);

    const isLastAttempt = attemptNumber >= maxAttempts;

    // Build context from previous feedback if this is a revision
    let revisionContext = "";
    if (previousFeedback && previousFeedback.length > 0) {
      revisionContext = `
## Previous Attempts
The student has made ${previousFeedback.length} previous attempt(s). Here is the feedback from each:

${previousFeedback
  .map(
    (fb, i) => `
### Attempt ${i + 1}
**Their writing:** "${fb.text}"
**Feedback given:** ${fb.feedback}
**Score:** ${fb.score}%
`
  )
  .join("\n")}

Please assess whether they have improved based on previous feedback.
`;
    }

    const systemPrompt = `You are an experienced English teacher providing detailed, encouraging feedback on essay paragraphs. Your role is to help students improve their analytical writing through constructive feedback.

## Your Approach
- Be encouraging but honest
- Highlight specific strengths before areas for improvement
- Give concrete, actionable suggestions
- Use age-appropriate language (secondary school level)
- Reference the specific assessment criteria
- If this is a revision, acknowledge improvements made

## Assessment Criteria (weight in brackets)
${Object.entries(gradingCriteria)
  .map(([key, val]) => `- **${key}** (${val.weight}%): ${val.description}`)
  .join("\n")}

## Response Format
You must respond with valid JSON in this exact format:
{
  "overallScore": <number 0-100>,
  "criteriaScores": {
    "content": <number 0-100>,
    "analysis": <number 0-100>,
    "structure": <number 0-100>,
    "expression": <number 0-100>
  },
  "strengths": ["<specific strength 1>", "<specific strength 2>"],
  "improvements": ["<specific, actionable improvement 1>", "<specific, actionable improvement 2>"],
  "detailedFeedback": "<2-3 paragraphs of detailed feedback>",
  "exampleRevision": "<optional: a sentence or two showing how they could improve a specific part>",
  "progressNote": "<if revision: comment on improvement since last attempt>"
}`;

    const userPrompt = `## Essay Question
"${essayTitle}"

## Paragraph Being Written
**Section:** ${paragraphConfig.title} (${paragraphConfig.type})
**Writing Prompt:** ${paragraphConfig.writingPrompt}

## What to Look For
${paragraphConfig.keyPoints.map((p) => `- ${p}`).join("\n")}

${
  paragraphConfig.exampleQuotes
    ? `## Suggested Quotations
${paragraphConfig.exampleQuotes.map((q) => `- "${q}"`).join("\n")}`
    : ""
}

## Attempt Information
This is attempt ${attemptNumber} of ${maxAttempts}.
${isLastAttempt ? "⚠️ This is the student's FINAL attempt - provide comprehensive feedback for their learning even though they cannot revise further." : `The student has ${maxAttempts - attemptNumber} revision(s) remaining.`}

${revisionContext}

## Student's Writing (Attempt ${attemptNumber})
"${paragraphText}"

---

Please assess this paragraph and provide detailed feedback in the JSON format specified. Remember to:
1. Score based on the weighted criteria
2. Be specific about what works well
3. Give actionable improvement suggestions
${!isLastAttempt ? "4. Help them understand exactly what to change in their next revision" : "4. Summarise their overall achievement and learning"}`;

    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1500,
      messages: [
        {
          role: "user",
          content: userPrompt,
        },
      ],
      system: systemPrompt,
    });

    const content = response.content[0].text;

    // Extract JSON from response
    let feedback;
    try {
      // Try to parse directly first
      feedback = JSON.parse(content);
    } catch {
      // Try to extract JSON from markdown code blocks
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        feedback = JSON.parse(jsonMatch[1].trim());
      } else {
        // Try to find JSON object in the response
        const jsonStart = content.indexOf("{");
        const jsonEnd = content.lastIndexOf("}");
        if (jsonStart !== -1 && jsonEnd !== -1) {
          feedback = JSON.parse(content.slice(jsonStart, jsonEnd + 1));
        } else {
          throw new Error("Could not parse feedback JSON");
        }
      }
    }

    // Calculate weighted score if not provided correctly
    if (!feedback.overallScore && feedback.criteriaScores) {
      feedback.overallScore = Math.round(
        Object.entries(feedback.criteriaScores).reduce((sum, [key, score]) => {
          const weight = gradingCriteria[key]?.weight || 25;
          return sum + (score * weight) / 100;
        }, 0)
      );
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        success: true,
        feedback: feedback,
        attemptNumber: attemptNumber,
        isLastAttempt: isLastAttempt,
        canRevise: !isLastAttempt,
      }),
    };
  } catch (error) {
    console.error("Paragraph grading error:", error);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        success: false,
        error: "Failed to grade paragraph",
        details: error.message,
      }),
    };
  }
};

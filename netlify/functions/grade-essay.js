// Grade the complete essay with holistic feedback
const Anthropic = require("@anthropic-ai/sdk").default;

const client = new Anthropic();

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  try {
    const {
      studentName,
      essayTitle,
      paragraphs, // Array of { config, finalText, attempts, paragraphScore }
      gradingCriteria
    } = JSON.parse(event.body);

    // Compile the full essay
    const fullEssay = paragraphs.map(p => p.finalText).join("\n\n");
    
    // Calculate paragraph scores summary
    const paragraphSummary = paragraphs.map(p => ({
      title: p.config.title,
      type: p.config.type,
      score: p.paragraphScore,
      attempts: p.attempts
    }));
    
    const averageScore = Math.round(
      paragraphSummary.reduce((sum, p) => sum + p.score, 0) / paragraphSummary.length
    );

    const systemPrompt = `You are an experienced English teacher providing holistic feedback on a complete essay. The student has written this essay paragraph by paragraph with revision opportunities. Now you're assessing the complete piece.

## Your Role
- Assess how well the essay works as a unified whole
- Comment on argument flow and coherence between paragraphs
- Identify overall strengths and patterns
- Suggest how the essay could be improved further
- Provide an encouraging summary of achievement
- Consider this is a secondary school student

## Assessment Criteria
${Object.entries(gradingCriteria).map(([key, val]) => `- **${key}** (${val.weight}%): ${val.description}`).join('\n')}

## Response Format
Respond with valid JSON:
{
  "overallGrade": "<Excellent|Good|Satisfactory|Needs Improvement>",
  "overallScore": <number 0-100>,
  "essaySummary": "<2-3 sentence overview of the essay's argument and quality>",
  "holisticStrengths": ["<strength about the essay as a whole>", "<another strength>", "<another>"],
  "holisticImprovements": ["<area for improvement>", "<another area>"],
  "paragraphByParagraph": [
    {
      "title": "<paragraph title>",
      "comment": "<1-2 sentence comment on this paragraph's contribution to the whole>"
    }
  ],
  "flowAndCoherence": "<comment on how well the paragraphs link together>",
  "argumentStrength": "<comment on the overall argument and how convincing it is>",
  "bestQuotation": "<quote the best analytical sentence from their essay>",
  "closingEncouragement": "<encouraging final message to the student>"
}`;

    const userPrompt = `## Essay Question
"${essayTitle}"

## Student
${studentName}

## Paragraph Scores During Writing
${paragraphSummary.map(p => `- ${p.title} (${p.type}): ${p.score}% (${p.attempts} attempt${p.attempts > 1 ? 's' : ''})`).join('\n')}

**Average paragraph score:** ${averageScore}%

## Complete Essay

${paragraphs.map((p, i) => `### ${p.config.title}
${p.finalText}`).join('\n\n')}

---

Please provide holistic feedback on this complete essay. Assess how well it works as a unified piece of analytical writing, considering flow, argument development, and overall quality.`;

    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2000,
      messages: [{ role: "user", content: userPrompt }],
      system: systemPrompt
    });

    const content = response.content[0].text;
    
    // Extract JSON from response
    let feedback;
    try {
      feedback = JSON.parse(content);
    } catch {
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        feedback = JSON.parse(jsonMatch[1].trim());
      } else {
        const jsonStart = content.indexOf('{');
        const jsonEnd = content.lastIndexOf('}');
        if (jsonStart !== -1 && jsonEnd !== -1) {
          feedback = JSON.parse(content.slice(jsonStart, jsonEnd + 1));
        } else {
          throw new Error("Could not parse essay feedback JSON");
        }
      }
    }

    // Calculate final score (blend of paragraph scores and holistic score)
    const finalScore = Math.round((averageScore * 0.7) + (feedback.overallScore * 0.3));

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        success: true,
        feedback: feedback,
        fullEssay: fullEssay,
        paragraphSummary: paragraphSummary,
        averageParagraphScore: averageScore,
        finalScore: finalScore
      })
    };

  } catch (error) {
    console.error("Essay grading error:", error);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        success: false,
        error: "Failed to grade essay",
        details: error.message
      })
    };
  }
};

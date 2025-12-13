// Grade a single paragraph with detailed feedback for revision
// Adapted for student's target grade (Zone of Proximal Development)
const Anthropic = require("@anthropic-ai/sdk").default;

const client = new Anthropic();

// Define grade systems and their characteristics
const GRADE_SYSTEMS = {
  gcse: {
    name: "GCSE",
    grades: ["9", "8", "7", "6", "5", "4", "3", "2", "1"],
    tiers: {
      high: ["9", "8", "7"],      // High ability - challenge with sophisticated concepts
      middle: ["6", "5", "4"],    // Middle ability - balanced support and challenge
      foundation: ["3", "2", "1"] // Foundation - more scaffolding and encouragement
    }
  },
  alevel: {
    name: "A-Level", 
    grades: ["A*", "A", "B", "C", "D", "E"],
    tiers: {
      high: ["A*", "A"],         // High ability
      middle: ["B", "C"],        // Middle ability
      foundation: ["D", "E"]     // Foundation
    }
  }
};

// Get the ability tier for a given grade
function getAbilityTier(targetGrade, gradeSystem) {
  const system = GRADE_SYSTEMS[gradeSystem] || GRADE_SYSTEMS.gcse;
  for (const [tier, grades] of Object.entries(system.tiers)) {
    if (grades.includes(targetGrade)) return tier;
  }
  return "middle"; // Default fallback
}

// Generate differentiated teaching approach based on ability tier
function getDifferentiatedApproach(tier, targetGrade, gradeSystem) {
  const systemName = GRADE_SYSTEMS[gradeSystem]?.name || "GCSE";
  
  const approaches = {
    high: {
      tone: "intellectually challenging and collegial",
      scaffolding: "minimal - expect independence and sophisticated thinking",
      vocabulary: "advanced academic vocabulary appropriate for high-achieving students",
      feedback_style: `
- Challenge them to think more deeply and critically
- Push beyond their target grade ${targetGrade} - aim for excellence, not just competence
- Introduce sophisticated analytical concepts and terminology
- Ask probing questions that extend their thinking
- Expect precise use of subject terminology
- Suggest ambitious improvements that would elevate their work to exceptional
- Be direct and concise - they can handle complex feedback
- Reference higher-level analytical frameworks they could employ
- Don't over-praise - be honest about what would make their work outstanding`,
      example_style: "Show sophisticated examples that demonstrate mastery-level analysis",
      encouragement: "acknowledge their strong foundation while pushing for exceptional work"
    },
    middle: {
      tone: "supportive yet challenging",
      scaffolding: "moderate - provide frameworks but encourage independent application",
      vocabulary: "clear academic vocabulary with occasional explanations of key terms",
      feedback_style: `
- Balance encouragement with constructive challenge
- Their target is grade ${targetGrade} but always push them toward the grade above
- Provide clear, actionable steps they can take
- Use a mix of specific praise and focused improvement points
- Explain WHY certain techniques are effective
- Model good analytical sentences they can learn from
- Break complex improvements into manageable steps
- Connect feedback to mark scheme criteria they need to hit
- Celebrate progress while maintaining high expectations`,
      example_style: "Provide clear model sentences showing how to improve specific aspects",
      encouragement: "celebrate their efforts while showing them the path to the next level"
    },
    foundation: {
      tone: "warm, encouraging, and highly supportive",
      scaffolding: "substantial - break down tasks and provide clear structures",
      vocabulary: "accessible language, explaining any technical terms used",
      feedback_style: `
- Prioritise building confidence alongside skills
- Their target is grade ${targetGrade} - celebrate every step toward and beyond it
- Focus on 1-2 key improvements at a time (don't overwhelm)
- Use bullet points and clear, short sentences
- Provide sentence starters and frameworks they can use
- Heavily praise what they've done well before suggesting changes
- Make improvements feel achievable and specific
- Use encouraging language: "you could try...", "a great next step would be..."
- Relate feedback to things they already understand
- Be patient and repeat key points in different ways
- Celebrate effort and progress, not just achievement`,
      example_style: "Provide fill-in-the-blank templates and sentence starters they can adapt",
      encouragement: "enthusiastically celebrate their progress and build their belief in themselves"
    }
  };
  
  return approaches[tier] || approaches.middle;
}

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
      gradingCriteria,
      targetGrade,      // NEW: e.g., "6" for GCSE or "B" for A-Level
      gradeSystem       // NEW: "gcse" or "alevel"
    } = JSON.parse(event.body);

    const isLastAttempt = attemptNumber >= maxAttempts;
    
    // Determine ability tier and get differentiated approach
    const abilityTier = getAbilityTier(targetGrade || "5", gradeSystem || "gcse");
    const approach = getDifferentiatedApproach(abilityTier, targetGrade || "5", gradeSystem || "gcse");
    const systemName = GRADE_SYSTEMS[gradeSystem]?.name || "GCSE";

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

Please assess whether they have improved based on previous feedback. ${abilityTier === 'foundation' ? 'Celebrate any improvements enthusiastically!' : abilityTier === 'high' ? 'Note improvements but maintain high expectations.' : 'Acknowledge improvements while encouraging further development.'}
`;
    }

    const systemPrompt = `You are an experienced, skilled English teacher providing personalised feedback on essay paragraphs. You adapt your teaching style to each student's needs and target grade.

## THIS STUDENT'S PROFILE
- **Target Grade:** ${targetGrade || "5"} (${systemName})
- **Ability Tier:** ${abilityTier.charAt(0).toUpperCase() + abilityTier.slice(1)}
- **Your Tone:** ${approach.tone}
- **Scaffolding Level:** ${approach.scaffolding}
- **Vocabulary Level:** ${approach.vocabulary}

## YOUR DIFFERENTIATED APPROACH FOR THIS STUDENT
${approach.feedback_style}

## KEY PRINCIPLE: Zone of Proximal Development
Your feedback should ALWAYS push the student slightly beyond their current level:
- Don't just help them reach their target grade - help them EXCEED it
- If they're working at their target level, show them what the next grade up looks like
- Never let them feel "that's good enough" - there's always room to grow
- BUT ensure your challenges are achievable, not demoralising

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
  "improvements": [${abilityTier === 'foundation' ? '"<ONE focused, achievable improvement with a helpful hint>"' : '"<specific, actionable improvement 1>", "<specific, actionable improvement 2>"'}],
  "detailedFeedback": "<${abilityTier === 'foundation' ? '1-2 short, encouraging paragraphs' : abilityTier === 'high' ? '2-3 paragraphs of substantive, challenging feedback' : '2-3 paragraphs of balanced feedback'}>",
  "exampleRevision": "<${approach.example_style}>",
  "progressNote": "<if revision: ${approach.encouragement}>",
  "nextLevelHint": "<what would make this work reach the NEXT grade up from their target>"
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

## Student Profile
- **Target Grade:** ${targetGrade || "5"} (${systemName})
- **Ability Tier:** ${abilityTier}

## Attempt Information
This is attempt ${attemptNumber} of ${maxAttempts}.
${isLastAttempt ? "⚠️ This is the student's FINAL attempt - provide comprehensive feedback for their learning even though they cannot revise further." : `The student has ${maxAttempts - attemptNumber} revision(s) remaining.`}

${revisionContext}

## Student's Writing (Attempt ${attemptNumber})
"${paragraphText}"

---

Please assess this paragraph and provide differentiated feedback appropriate for a student targeting grade ${targetGrade || "5"}. Remember to:
1. Score based on the weighted criteria
2. Use the ${approach.tone} tone appropriate for this student
3. ${abilityTier === 'foundation' ? 'Focus on 1-2 achievable improvements with lots of support' : abilityTier === 'high' ? 'Challenge them with sophisticated improvements' : 'Provide balanced, actionable feedback'}
4. Always push them toward the NEXT grade up from their target
${!isLastAttempt ? `5. Help them understand exactly what to change in their next revision` : `5. Summarise their overall achievement and learning`}`;

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
        targetGrade: targetGrade,
        abilityTier: abilityTier
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

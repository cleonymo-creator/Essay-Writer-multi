// Grade the complete essay with holistic feedback
// Adapted for student's target grade (Zone of Proximal Development)
const Anthropic = require("@anthropic-ai/sdk").default;

const client = new Anthropic();

// Define grade systems and their characteristics
const GRADE_SYSTEMS = {
  gcse: {
    name: "GCSE",
    grades: ["9", "8", "7", "6", "5", "4", "3", "2", "1"],
    tiers: {
      high: ["9", "8", "7"],
      middle: ["6", "5", "4"],
      foundation: ["3", "2", "1"]
    }
  },
  alevel: {
    name: "A-Level",
    grades: ["A*", "A", "B", "C", "D", "E"],
    tiers: {
      high: ["A*", "A"],
      middle: ["B", "C"],
      foundation: ["D", "E"]
    }
  }
};

function getAbilityTier(targetGrade, gradeSystem) {
  const system = GRADE_SYSTEMS[gradeSystem] || GRADE_SYSTEMS.gcse;
  for (const [tier, grades] of Object.entries(system.tiers)) {
    if (grades.includes(targetGrade)) return tier;
  }
  return "middle";
}

function getNextGradeUp(targetGrade, gradeSystem) {
  const system = GRADE_SYSTEMS[gradeSystem] || GRADE_SYSTEMS.gcse;
  const grades = system.grades;
  const currentIndex = grades.indexOf(targetGrade);
  if (currentIndex > 0) {
    return grades[currentIndex - 1];
  }
  return targetGrade; // Already at top
}

function getDifferentiatedApproach(tier, targetGrade, gradeSystem) {
  const systemName = GRADE_SYSTEMS[gradeSystem]?.name || "GCSE";
  const nextGrade = getNextGradeUp(targetGrade, gradeSystem);
  
  const approaches = {
    high: {
      tone: "collegial and intellectually rigorous",
      summary_style: "sophisticated analysis acknowledging their strong foundation while identifying paths to excellence",
      encouragement_style: `Direct and honest. Acknowledge their achievement but make clear what separates very good from exceptional. Challenge them: "${nextGrade === targetGrade ? 'You\'re aiming for the top - here\'s what truly outstanding work looks like.' : `You're capable of more than grade ${targetGrade} - here's what grade ${nextGrade} requires.`}"`,
      improvements_focus: "sophisticated refinements and advanced techniques",
      praise_level: "measured - acknowledge strengths without over-praising"
    },
    middle: {
      tone: "warm but appropriately challenging",
      summary_style: "clear overview celebrating strengths while providing a roadmap for improvement",
      encouragement_style: `Supportive and motivating. "You're working at a solid grade ${targetGrade} level - with these improvements, you could achieve grade ${nextGrade}." Make the next level feel achievable.`,
      improvements_focus: "concrete, actionable steps toward the next grade",
      praise_level: "generous but genuine - celebrate real achievements"
    },
    foundation: {
      tone: "enthusiastic, warm, and highly supportive",
      summary_style: "celebratory overview focusing on what they've achieved, with gentle guidance for growth",
      encouragement_style: `Effusive and confidence-building. "This is wonderful progress! You should be proud of what you've written. You're absolutely capable of reaching grade ${targetGrade} and beyond - keep going!" Build their belief.`,
      improvements_focus: "one or two manageable next steps (don't overwhelm)",
      praise_level: "high - find and celebrate every positive aspect"
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
      studentName,
      essayTitle,
      paragraphs,
      gradingCriteria,
      targetGrade,
      gradeSystem
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

    // Get differentiated approach
    const abilityTier = getAbilityTier(targetGrade || "5", gradeSystem || "gcse");
    const approach = getDifferentiatedApproach(abilityTier, targetGrade || "5", gradeSystem || "gcse");
    const systemName = GRADE_SYSTEMS[gradeSystem]?.name || "GCSE";
    const nextGrade = getNextGradeUp(targetGrade || "5", gradeSystem || "gcse");

    const systemPrompt = `You are an experienced English teacher providing holistic feedback on a complete essay. You adapt your feedback style to each student's target grade and ability level.

## THIS STUDENT'S PROFILE
- **Student Name:** ${studentName}
- **Target Grade:** ${targetGrade || "5"} (${systemName})
- **Ability Tier:** ${abilityTier.charAt(0).toUpperCase() + abilityTier.slice(1)}
- **Your Tone:** ${approach.tone}

## YOUR DIFFERENTIATED APPROACH
- **Summary Style:** ${approach.summary_style}
- **Encouragement Style:** ${approach.encouragement_style}
- **Improvements Focus:** ${approach.improvements_focus}
- **Praise Level:** ${approach.praise_level}

## KEY PRINCIPLE: Always Push Beyond the Target
- Don't let the student settle at their target grade
- Show them what grade ${nextGrade} looks like and how to get there
- Make exceeding their target feel achievable, not impossible
- Feedback should inspire growth, not complacency

## Assessment Criteria
${Object.entries(gradingCriteria).map(([key, val]) => `- **${key}** (${val.weight}%): ${val.description}`).join('\n')}

## Response Format
Respond with valid JSON:
{
  "overallGrade": "<${abilityTier === 'high' ? 'be precise and honest' : abilityTier === 'foundation' ? 'focus on achievement' : 'balanced assessment'}: Excellent|Good|Satisfactory|Needs Improvement>",
  "overallScore": <number 0-100>,
  "essaySummary": "<${abilityTier === 'foundation' ? '2-3 encouraging sentences celebrating their work' : '2-3 sentences: honest assessment of argument and quality'}>",
  "holisticStrengths": [${abilityTier === 'foundation' ? '"<strength - be generous and specific>", "<another strength>", "<find a third positive>"' : '"<genuine strength>", "<another strength>", "<third strength>"'}],
  "holisticImprovements": [${abilityTier === 'foundation' ? '"<ONE gentle, achievable improvement>"' : abilityTier === 'high' ? '"<sophisticated improvement 1>", "<challenging improvement 2>", "<advanced technique 3>"' : '"<clear improvement 1>", "<actionable improvement 2>"'}],
  "paragraphByParagraph": [
    {
      "title": "<paragraph title>",
      "comment": "<${abilityTier === 'foundation' ? 'encouraging 1-sentence comment' : '1-2 sentence comment on contribution to whole'}>"
    }
  ],
  "flowAndCoherence": "<${abilityTier === 'foundation' ? 'positive comment on how their ideas connect' : 'analysis of how paragraphs link together'}>",
  "argumentStrength": "<${abilityTier === 'foundation' ? 'celebrate their argument, note one way to strengthen it' : 'honest assessment of argument conviction'}>",
  "bestQuotation": "<quote their BEST analytical sentence - find something to celebrate>",
  "pathToNextGrade": "<specific advice on what would lift this essay from grade ${targetGrade} to grade ${nextGrade}>",
  "closingEncouragement": "<${approach.encouragement_style}>"
}`;

    const userPrompt = `## Essay Question
"${essayTitle}"

## Student Profile
- **Name:** ${studentName}
- **Target Grade:** ${targetGrade || "5"} (${systemName})
- **Ability Tier:** ${abilityTier}

## Paragraph Scores During Writing
${paragraphSummary.map(p => `- ${p.title} (${p.type}): ${p.score}% (${p.attempts} attempt${p.attempts > 1 ? 's' : ''})`).join('\n')}

**Average paragraph score:** ${averageScore}%

## Complete Essay

${paragraphs.map((p, i) => `### ${p.config.title}
${p.finalText}`).join('\n\n')}

---

Please provide holistic feedback on this complete essay, adapting your tone and approach for a student targeting grade ${targetGrade || "5"}. 

Remember:
- Use a ${approach.tone} tone
- ${abilityTier === 'foundation' ? 'Be generous with praise and gentle with criticism' : abilityTier === 'high' ? 'Be honest and challenging - they can handle it' : 'Balance praise with constructive challenge'}
- Always show them the path to grade ${nextGrade}
- ${abilityTier === 'foundation' ? 'Find and celebrate every positive aspect of their writing' : 'Acknowledge achievements while maintaining high expectations'}`;

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
        finalScore: finalScore,
        targetGrade: targetGrade,
        abilityTier: abilityTier
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

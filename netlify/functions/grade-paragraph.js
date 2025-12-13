// Grade a single paragraph with detailed feedback for revision
// Supports authentic exam grade descriptors when available, with fallback to generic criteria
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

// Get the ability tier for a given grade
function getAbilityTier(targetGrade, gradeSystem) {
  const system = GRADE_SYSTEMS[gradeSystem] || GRADE_SYSTEMS.gcse;
  for (const [tier, grades] of Object.entries(system.tiers)) {
    if (grades.includes(targetGrade)) return tier;
  }
  return "middle";
}

// Get the next grade up from current target
function getNextGradeUp(targetGrade, gradeSystem) {
  const system = GRADE_SYSTEMS[gradeSystem] || GRADE_SYSTEMS.gcse;
  const grades = system.grades;
  const currentIndex = grades.indexOf(targetGrade);
  if (currentIndex > 0) {
    return grades[currentIndex - 1];
  }
  return targetGrade;
}

// Build grade descriptors text from gradeBoundaries array
function buildGradeDescriptorsText(gradeBoundaries, totalMarks) {
  if (!gradeBoundaries || !Array.isArray(gradeBoundaries) || gradeBoundaries.length === 0) {
    return null;
  }
  
  return gradeBoundaries.map(gb => {
    const markRange = gb.maxMarks 
      ? `${gb.minMarks}-${gb.maxMarks}/${totalMarks} marks`
      : `${gb.minMarks}+ marks`;
    return `### ${gb.grade} (${markRange})
${gb.descriptor}`;
  }).join('\n\n');
}

// Find the grade descriptor for a specific grade
function getGradeDescriptor(gradeBoundaries, grade) {
  if (!gradeBoundaries || !Array.isArray(gradeBoundaries)) return null;
  const boundary = gradeBoundaries.find(gb => gb.grade === grade || gb.grade === `Grade ${grade}`);
  return boundary?.descriptor || null;
}

// Convert total marks to a grade using authentic boundaries
function marksToGrade(marks, gradeBoundaries) {
  if (!gradeBoundaries || !Array.isArray(gradeBoundaries) || gradeBoundaries.length === 0) {
    return null;
  }
  
  // Sort boundaries by minMarks descending to find highest matching grade
  const sorted = [...gradeBoundaries].sort((a, b) => b.minMarks - a.minMarks);
  
  for (const boundary of sorted) {
    if (marks >= boundary.minMarks) {
      // Return just the number/letter, stripping "Grade " prefix if present
      return boundary.grade.replace('Grade ', '');
    }
  }
  
  // Return lowest grade if below all boundaries
  const lowestGrade = sorted[sorted.length - 1]?.grade || "1";
  return lowestGrade.replace('Grade ', '');
}

// Get adjacent grade descriptors for comparison
function getAdjacentGradeDescriptors(gradeBoundaries, targetGrade) {
  if (!gradeBoundaries || !Array.isArray(gradeBoundaries)) return null;
  
  const targetIndex = gradeBoundaries.findIndex(gb => 
    gb.grade === targetGrade || 
    gb.grade === `Grade ${targetGrade}` ||
    gb.grade.includes(targetGrade)
  );
  
  if (targetIndex === -1) return null;
  
  const result = {
    target: gradeBoundaries[targetIndex],
    above: targetIndex > 0 ? gradeBoundaries[targetIndex - 1] : null,
    below: targetIndex < gradeBoundaries.length - 1 ? gradeBoundaries[targetIndex + 1] : null
  };
  
  return result;
}

// Generate differentiated teaching approach based on ability tier
function getDifferentiatedApproach(tier, targetGrade, gradeSystem) {
  const systemName = GRADE_SYSTEMS[gradeSystem]?.name || "GCSE";
  const nextGrade = getNextGradeUp(targetGrade, gradeSystem);
  
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
- Their target is grade ${targetGrade} but always push them toward grade ${nextGrade}
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
    const requestBody = JSON.parse(event.body);
    const {
      paragraphText,
      paragraphConfig,
      attemptNumber,
      maxAttempts,
      previousFeedback,
      essayTitle,
      gradingCriteria,
      gradeBoundaries,  // Array of {grade, minMarks, maxMarks, descriptor}
      totalMarks,       // Total marks for the essay
      targetGrade,
      gradeSystem
    } = requestBody;
    
    // Debug logging for grade boundaries
    console.log('[grade-paragraph] Received gradeBoundaries:', {
      exists: !!gradeBoundaries,
      isArray: Array.isArray(gradeBoundaries),
      length: gradeBoundaries?.length,
      sample: gradeBoundaries?.[0]?.grade
    });

    const isLastAttempt = attemptNumber >= maxAttempts;
    
    // Determine ability tier and get differentiated approach
    const abilityTier = getAbilityTier(targetGrade || "5", gradeSystem || "gcse");
    const approach = getDifferentiatedApproach(abilityTier, targetGrade || "5", gradeSystem || "gcse");
    const systemName = GRADE_SYSTEMS[gradeSystem]?.name || "GCSE";
    const nextGrade = getNextGradeUp(targetGrade || "5", gradeSystem || "gcse");

    // Check if we have authentic grade descriptors
    // Validate the gradeBoundaries array structure
    const isValidGradeBoundaries = gradeBoundaries && 
      Array.isArray(gradeBoundaries) && 
      gradeBoundaries.length > 0 &&
      gradeBoundaries[0]?.grade &&  // Must have grade property
      gradeBoundaries[0]?.descriptor;  // Must have descriptor property
    
    const hasAuthenticDescriptors = isValidGradeBoundaries;
    
    console.log('[grade-paragraph] hasAuthenticDescriptors:', hasAuthenticDescriptors);
    
    const gradeDescriptorsText = hasAuthenticDescriptors 
      ? buildGradeDescriptorsText(gradeBoundaries, totalMarks || 40)
      : null;
    
    if (hasAuthenticDescriptors) {
      console.log('[grade-paragraph] Using authentic descriptors with', gradeBoundaries.length, 'grade levels');
    } else {
      console.log('[grade-paragraph] Using fallback criteria:', Object.keys(gradingCriteria || {}).join(', '));
    }
    
    // Get specific descriptors for target grade and adjacent grades
    const adjacentDescriptors = hasAuthenticDescriptors 
      ? getAdjacentGradeDescriptors(gradeBoundaries, targetGrade || "5")
      : null;

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
**Score:** ${fb.score}%${fb.estimatedGrade ? ` (Est. ${fb.estimatedGrade})` : ''}
`
  )
  .join("\n")}

Please assess whether they have improved based on previous feedback. ${abilityTier === 'foundation' ? 'Celebrate any improvements enthusiastically!' : abilityTier === 'high' ? 'Note improvements but maintain high expectations.' : 'Acknowledge improvements while encouraging further development.'}
`;
    }

    // Build assessment criteria section - use authentic descriptors if available, fallback to generic
    let assessmentCriteriaSection;
    if (hasAuthenticDescriptors) {
      assessmentCriteriaSection = `## OFFICIAL GRADE DESCRIPTORS
Use these authentic exam board descriptors to assess the student's work:

${gradeDescriptorsText}

## TARGET GRADE FOCUS
The student is targeting **${targetGrade}**. Here's what they need to demonstrate:

**To achieve ${targetGrade}:**
${adjacentDescriptors?.target?.descriptor || 'Meet the standard descriptors for this grade.'}

${adjacentDescriptors?.above ? `**To reach ${adjacentDescriptors.above.grade} (stretch goal):**
${adjacentDescriptors.above.descriptor}` : ''}

Your feedback should:
1. Assess which grade level their current work matches
2. Identify specific evidence that places them at that level
3. Give concrete steps to move toward the next grade up`;
    } else {
      // Fallback to generic criteria
      assessmentCriteriaSection = `## Assessment Criteria (weight in brackets)
${Object.entries(gradingCriteria)
  .map(([key, val]) => `- **${key}** (${val.weight}%): ${val.description}`)
  .join("\n")}`;
    }

    // Build response format based on whether we have authentic descriptors
    const responseFormat = hasAuthenticDescriptors ? `{
  "awardedMarks": <number: the marks you would award this paragraph out of ${totalMarks || 40} based on the grade descriptors>,
  "marksJustification": "<1-2 sentences explaining how you arrived at this mark, referencing the grade boundaries>",
  "strengths": ["<specific strength with evidence from their writing>", "<another strength>"],
  "improvements": [${abilityTier === 'foundation' ? '"<ONE focused, achievable improvement linked to grade descriptors>"' : '"<improvement linked to next grade descriptor>", "<another specific improvement>"'}],
  "detailedFeedback": "<${abilityTier === 'foundation' ? '1-2 short, encouraging paragraphs referencing what the grade descriptors say' : '2-3 paragraphs linking feedback to grade descriptors'}>",
  "exampleRevision": "<${approach.example_style}>",
  "progressNote": "<if revision: note improvement with reference to grade movement>",
  "nextLevelHint": "<specific advice quoting what the ${nextGrade} descriptor requires that they haven't yet demonstrated>"
}` : `{
  "overallScore": <number 0-100>,
  "criteriaScores": {
${Object.entries(gradingCriteria)
  .map(([key, val]) => `    "${key}": <number 0-100 for ${val.description}>`)
  .join(",\n")}
  },
  "strengths": ["<specific strength 1>", "<specific strength 2>"],
  "improvements": [${abilityTier === 'foundation' ? '"<ONE focused, achievable improvement with a helpful hint>"' : '"<specific, actionable improvement 1>", "<specific, actionable improvement 2>"'}],
  "detailedFeedback": "<${abilityTier === 'foundation' ? '1-2 short, encouraging paragraphs' : abilityTier === 'high' ? '2-3 paragraphs of substantive, challenging feedback' : '2-3 paragraphs of balanced feedback'}>",
  "exampleRevision": "<${approach.example_style}>",
  "progressNote": "<if revision: ${approach.encouragement}>",
  "nextLevelHint": "<what would make this work reach the NEXT grade up from their target>"
}`;

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
- If they're working at their target level, show them what grade ${nextGrade} looks like
- Never let them feel "that's good enough" - there's always room to grow
- BUT ensure your challenges are achievable, not demoralising

${assessmentCriteriaSection}

## Response Format
You must respond with valid JSON in this exact format:
${responseFormat}`;

    const userPrompt = `## Essay Question
"${essayTitle}"

## Paragraph Being Written
**Section:** ${paragraphConfig.title} (${paragraphConfig.type})
**Writing Prompt:** ${paragraphConfig.writingPrompt}

## What to Look For
${paragraphConfig.keyPoints.map((p) => `- ${p}`).join("\n")}

${
  paragraphConfig.exampleQuotes && paragraphConfig.exampleQuotes.length > 0
    ? `## Suggested Quotations
${paragraphConfig.exampleQuotes.map((q) => `- "${q}"`).join("\n")}`
    : ""
}

## Student Profile
- **Target Grade:** ${targetGrade || "5"} (${systemName})
- **Ability Tier:** ${abilityTier}
${hasAuthenticDescriptors ? `- **Assessment:** Using official exam board grade descriptors` : '- **Assessment:** Using standard criteria'}

## Attempt Information
This is attempt ${attemptNumber} of ${maxAttempts}.
${isLastAttempt ? "ÃƒÂ¢Ã…Â¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â This is the student's FINAL attempt - provide comprehensive feedback for their learning even though they cannot revise further." : `The student has ${maxAttempts - attemptNumber} revision(s) remaining.`}

${revisionContext}

## Student's Writing (Attempt ${attemptNumber})
"${paragraphText}"

---

Please assess this paragraph${hasAuthenticDescriptors ? ' against the official grade descriptors' : ''} and provide differentiated feedback appropriate for a student targeting grade ${targetGrade || "5"}. 

Remember:
1. ${hasAuthenticDescriptors ? 'Determine which grade level the work currently matches and cite specific evidence' : 'Score based on the weighted criteria'}
2. Use the ${approach.tone} tone appropriate for this student
3. ${abilityTier === 'foundation' ? 'Focus on 1-2 achievable improvements with lots of support' : abilityTier === 'high' ? 'Challenge them with sophisticated improvements' : 'Provide balanced, actionable feedback'}
4. Always push them toward grade ${nextGrade}
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
      feedback = JSON.parse(content);
    } catch {
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        feedback = JSON.parse(jsonMatch[1].trim());
      } else {
        const jsonStart = content.indexOf("{");
        const jsonEnd = content.lastIndexOf("}");
        if (jsonStart !== -1 && jsonEnd !== -1) {
          feedback = JSON.parse(content.slice(jsonStart, jsonEnd + 1));
        } else {
          throw new Error("Could not parse feedback JSON");
        }
      }
    }

    // Process grading results based on assessment mode
    let awardedMarks, estimatedGrade, overallScore;
    
    if (hasAuthenticDescriptors) {
      // Use marks-based grading with authentic boundaries
      awardedMarks = feedback.awardedMarks;
      
      if (awardedMarks != null && gradeBoundaries) {
        // Convert marks to grade using authentic boundaries
        estimatedGrade = marksToGrade(awardedMarks, gradeBoundaries);
        // Calculate percentage score from marks
        overallScore = Math.round((awardedMarks / (totalMarks || 40)) * 100);
      } else {
        // Fallback if AI didn't return marks (shouldn't happen)
        console.warn('[grade-paragraph] No awardedMarks returned, using fallback');
        awardedMarks = null;
        estimatedGrade = null;
        overallScore = 0;
      }
      
      // Add derived values to feedback
      feedback.estimatedGrade = estimatedGrade;
      feedback.overallScore = overallScore;
      feedback.awardedMarks = awardedMarks;
      feedback.totalMarks = totalMarks || 40;
      feedback.markBreakdown = `${awardedMarks}/${totalMarks || 40} marks = Grade ${estimatedGrade}`;
      
    } else {
      // Fallback mode: Calculate weighted score from criteria scores
      if (!feedback.overallScore && feedback.criteriaScores) {
        const criteriaKeys = Object.keys(feedback.criteriaScores);
        feedback.overallScore = Math.round(
          criteriaKeys.reduce((sum, key) => {
            const weight = gradingCriteria[key]?.weight || 25;
            return sum + (feedback.criteriaScores[key] * weight) / 100;
          }, 0)
        );
      }
      overallScore = feedback.overallScore;
    }

    console.log('[grade-paragraph] Response:', {
      usedAuthenticDescriptors: hasAuthenticDescriptors,
      awardedMarks: awardedMarks,
      totalMarks: totalMarks,
      estimatedGrade: estimatedGrade || feedback.estimatedGrade,
      overallScore: overallScore
    });

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
        abilityTier: abilityTier,
        usedAuthenticDescriptors: hasAuthenticDescriptors,
        // Include marks breakdown for transparency
        awardedMarks: hasAuthenticDescriptors ? awardedMarks : null,
        totalMarks: hasAuthenticDescriptors ? (totalMarks || 40) : null,
        estimatedGrade: hasAuthenticDescriptors ? estimatedGrade : null,
        markBreakdown: hasAuthenticDescriptors ? `${awardedMarks}/${totalMarks || 40} marks = Grade ${estimatedGrade}` : null
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

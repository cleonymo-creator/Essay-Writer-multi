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


// Get differentiated hint based on ability tier
function getHintForAbilityLevel(tier, targetGrade, nextGrade, adjacentDescriptors, gradeBoundaries) {
  const hints = {
    foundation: {
      level: "Foundation Support",
      approach: "Step-by-step guidance with clear examples",
      detail: `Your target is grade ${targetGrade}. Here's ONE focused thing to improve:`,
      format: "Simple, actionable step with a clear example sentence structure"
    },
    middle: {
      level: "Targeted Advice",
      approach: "Clear improvement steps with reasoning",
      detail: `To move from grade ${targetGrade} toward grade ${nextGrade}, focus on:`,
      format: "2-3 specific improvements with explanation of why they matter"
    },
    high: {
      level: "Advanced Challenge",
      approach: "Sophisticated refinements for excellence",
      detail: `To reach grade ${nextGrade} and beyond:`,
      format: "Advanced techniques and nuanced analytical approaches"
    }
  };
  
  return hints[tier] || hints.middle;
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
      completedParagraphs,  // Previously completed paragraphs for cumulative grading
      essayTitle,
      gradingCriteria,
      gradeBoundaries,  // Array of {grade, minMarks, maxMarks, descriptor}
      totalMarks,       // Total marks for the essay
      targetGrade,
      gradeSystem
    } = requestBody;
    
    // Build cumulative essay (all completed paragraphs + current one)
    const hasPreviousParagraphs = completedParagraphs && completedParagraphs.length > 0;
    const cumulativeEssay = hasPreviousParagraphs
      ? [
          ...completedParagraphs.map(p => `### ${p.title}\n${p.text}`),
          `### ${paragraphConfig.title}\n${paragraphText}`
        ].join('\n\n')
      : `### ${paragraphConfig.title}\n${paragraphText}`;
    
    const paragraphCount = (completedParagraphs?.length || 0) + 1;
    
    // Debug logging
    console.log('[grade-paragraph] Cumulative grading:', {
      completedParagraphs: completedParagraphs?.length || 0,
      currentParagraph: paragraphConfig.title,
      totalParagraphsSoFar: paragraphCount,
      hasGradeBoundaries: !!gradeBoundaries
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
3. Give concrete steps to move toward the next grade up



## CRITICAL: "Best Achievement" Marking Principle
When assessing student work, apply this fundamental principle:
- **Credit the HIGHEST level of skill demonstrated**, even if shown only once or briefly
- **Don't average out** high and low performance - if they show Grade 7 analysis in one area, that's evidence of Grade 7 capability
- **Don't penalize twice** - if you've noted a weakness, don't let it drag the grade down across multiple criteria
- **Look for the ceiling, not the floor** - What's the best thing they've done? That shows their true capability
- **Partial achievement of higher grades beats full achievement of lower grades** - A student attempting sophisticated analysis (even imperfectly) shows more promise than perfect basic description
- **Weaknesses are learning opportunities, not grade anchors** - Note areas for improvement without letting them overshadow demonstrated strengths

## CUMULATIVE GRADING APPROACH
${hasPreviousParagraphs ? `You are grading the essay CUMULATIVELY - assessing the complete work written so far (${paragraphCount} paragraph${paragraphCount > 1 ? 's' : ''}).

**Important:**
- Grade the WHOLE essay written so far, not just the new paragraph in isolation
- The new paragraph may lift or maintain the overall grade
- Look for how the new paragraph contributes to the complete argument
- Award the grade that reflects the quality of the entire essay so far
- Strong new work can elevate the overall grade (ceiling grading)

For feedback:
- Comment on how this paragraph contributes to the whole essay
- Note whether the essay is strengthening or if they need to maintain quality
- Guide them on what the next paragraph needs to do` : `This is the student's first paragraph, so you're grading just this opening section. Your grade represents the quality of their essay so far (which is just this introduction).`}

### Example:
If a student writes 4 paragraphs where:
- 3 paragraphs show basic Grade 5 analysis
- 1 paragraph demonstrates sophisticated Grade 7 critical thinking

**Award Grade 7 (or Grade 6/7 borderline)** - They've proven they CAN work at that level. The task now is to help them do it consistently, not to penalize them for inconsistency.

## IMPORTANT: Fair Marking Guidance
When assessing, apply the "best achievement" principle used by expert examiners:
- **Always credit the HIGHEST skill level demonstrated** - even if shown in just one part of the work
- If work shows characteristics of TWO adjacent grades, award the HIGHER grade when that level is genuinely demonstrated
- **Don't average** - A mix of Grade 5 and Grade 7 work suggests Grade 6/7 capability, not Grade 6
- **Don't penalize twice** - note weaknesses once, don't let them reduce the grade multiple times
- **Recognize potential** - attempts at sophisticated techniques show capability even if not perfectly executed
- **Focus on what they CAN do** - the highest skill demonstrated reveals their true capability
- Students are still learning - assess their best work as evidence of their developing skills`;
    } else {
      // Fallback to generic criteria
      assessmentCriteriaSection = `## Assessment Criteria (weight in brackets)
${Object.entries(gradingCriteria)
  .map(([key, val]) => `- **${key}** (${val.weight}%): ${val.description}`)
  .join("\n")}`;
    }

    // Build the user prompt - conditional based on whether there are previous paragraphs
    let userPrompt;
    
    if (hasPreviousParagraphs) {
      // CUMULATIVE GRADING MODE
      userPrompt = `## Essay Question
"${essayTitle}"

## Complete Essay Written So Far (${paragraphCount} paragraphs)

${cumulativeEssay}

---

## CUMULATIVE GRADING ASSESSMENT
You are grading the COMPLETE ESSAY written so far - all ${paragraphCount} paragraphs above.

**Current paragraph being assessed:** ${paragraphConfig.title} (${paragraphConfig.type})

**What you're grading:**
- The complete work from start to current paragraph
- How well the essay develops and builds
- The overall quality across all paragraphs written so far

## Student Profile
- **Target Grade:** ${targetGrade || "5"} (${systemName})
- **Ability Tier:** ${abilityTier}
${hasAuthenticDescriptors ? `- **Assessment Mode:** CUMULATIVE - Grading entire essay using official descriptors` : '- **Assessment:** Using standard criteria'}

## Attempt Information  
This is attempt ${attemptNumber} of ${maxAttempts} for the ${paragraphConfig.title} paragraph.
${isLastAttempt ? "⚠️ FINAL attempt for this paragraph." : `${maxAttempts - attemptNumber} revision(s) remaining.`}

${revisionContext}

---

Grade the COMPLETE ESSAY (${paragraphCount} paragraphs) holistically.

${hasAuthenticDescriptors ? `
CRITICAL: Your response MUST include:
- "awardedGrade": GCSE grade for COMPLETE ESSAY SO FAR (e.g., "6", "7", "8")
- "awardedMarks": Mark out of ${totalMarks || 40} for complete essay
Use ceiling grading across ALL paragraphs.
` : ''}

Remember:
1. Grade the WHOLE essay cumulatively - highest quality across all paragraphs
2. Use ${approach.tone} tone
3. ${abilityTier === 'foundation' ? '1-2 achievable improvements' : abilityTier === 'high' ? 'Sophisticated improvements' : 'Balanced feedback'}
4. Push toward grade ${nextGrade}
${!isLastAttempt ? `5. Guide next revision` : `5. Summarise achievement`}`;
    } else {
      // FIRST PARAGRAPH MODE
      userPrompt = `## Essay Question
"${essayTitle}"

## Paragraph Being Written
**Section:** ${paragraphConfig.title} (${paragraphConfig.type})
**Writing Prompt:** ${paragraphConfig.writingPrompt}

## What to Look For
${paragraphConfig.keyPoints.map((p) => `- ${p}`).join("\n")}

${paragraphConfig.exampleQuotes && paragraphConfig.exampleQuotes.length > 0
    ? `## Suggested Quotations
${paragraphConfig.exampleQuotes.map((q) => `- "${q}"`).join("\n")}`
    : ""}

## Student Profile
- **Target Grade:** ${targetGrade || "5"} (${systemName})
- **Ability Tier:** ${abilityTier}
${hasAuthenticDescriptors ? `- **Assessment:** Official exam board descriptors` : '- **Assessment:** Standard criteria'}

## Attempt Information
Attempt ${attemptNumber} of ${maxAttempts}.
${isLastAttempt ? "⚠️ FINAL attempt." : `${maxAttempts - attemptNumber} revision(s) remaining.`}

${revisionContext}

## Student's Writing (Attempt ${attemptNumber})
"${paragraphText}"

---

Assess this paragraph${hasAuthenticDescriptors ? ' against official grade descriptors' : ''}.

${hasAuthenticDescriptors ? `
CRITICAL: Must include:
- "awardedGrade": GCSE grade (e.g., "6", "7", "8")  
- "awardedMarks": Mark out of ${totalMarks || 40}
Use ceiling grading.
` : ''}

Remember:
1. ${hasAuthenticDescriptors ? 'Ceiling grading - cite evidence' : 'Score by criteria'}
2. Use ${approach.tone} tone
3. ${abilityTier === 'foundation' ? '1-2 achievable improvements' : abilityTier === 'high' ? 'Sophisticated improvements' : 'Balanced feedback'}
4. Push toward grade ${nextGrade}
${!isLastAttempt ? `5. Guide next revision` : `5. Summarise achievement`}`;
    }

    // Build response format based on whether we have authentic descriptors
    const responseFormat = hasAuthenticDescriptors ? `{
  "awardedGrade": "<the actual GCSE grade this work achieves (e.g., '6', '7', '8') - use ceiling grading, crediting highest demonstrated skills>",
  "awardedMarks": <number: specific mark out of ${totalMarks || 40} that reflects the grade awarded>,
  "levelJustification": "<1-2 sentences explaining why this work achieves this grade, highlighting the highest skills demonstrated>",
  "strengths": ["<specific strength with evidence from their writing>", "<another strength>"],
  "improvements": [${abilityTier === 'foundation' ? '"<ONE focused, achievable improvement linked to grade descriptors>"' : abilityTier === 'high' ? '"<sophisticated improvement 1>", "<advanced technique 2>", "<nuanced refinement 3>"' : '"<clear improvement 1 with explanation>", "<targeted improvement 2 with rationale>"'}],
  "tieredHint": {
    "level": "${abilityTier.charAt(0).toUpperCase() + abilityTier.slice(1)} Level",
    "targetGrade": "${targetGrade}",
    "nextGrade": "${nextGrade}",
    "hint": "<${abilityTier === 'foundation' ? 'ONE simple, clear step they can take right now with an example' : abilityTier === 'high' ? 'Sophisticated technique or analytical framework to elevate their work' : '2-3 clear steps to move closer to the next grade'}>"
  },
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



## HOLISTIC ASSESSMENT APPROACH
You are assessing this paragraph HOLISTICALLY, not by counting up marks:
- Identify the HIGHEST grade descriptor that this work genuinely demonstrates
- Look for evidence of sophisticated skills, even if briefly shown
- Don't average across criteria - credit the best work as evidence of capability
- The question is: "What's the highest level this student has proven they can work at?"


## YOUR PRIMARY TASK: IDENTIFY THE HIGHEST SKILL LEVEL
When you assess this paragraph, ask yourself:
1. **What's the BEST analytical point they made?** - This shows their capability
2. **What's the most sophisticated technique they attempted?** - Even partial success counts
3. **Which grade descriptor best matches their STRONGEST work?** - Not their average

Then assign the grade that matches that highest demonstrated skill level.

Remember: A student who shows one moment of Grade 8 analysis mixed with Grade 6 work is demonstrating Grade 7/8 capability - they CAN do it, they just need practice doing it consistently. Don't penalize them for being on a learning journey.

## Response Format
You must respond with valid JSON in this exact format:
${responseFormat}`;

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
      // Use the grade awarded directly by the AI (ceiling grading principle)
      estimatedGrade = feedback.awardedGrade;
      awardedMarks = feedback.awardedMarks;
      
      // Calculate percentage for internal tracking only
      if (awardedMarks != null) {
        overallScore = Math.round((awardedMarks / (totalMarks || 40)) * 100);
      } else {
        // Fallback: derive marks from grade if needed
        console.warn('[grade-paragraph] No awardedMarks, deriving from grade');
        const gradeBoundary = gradeBoundaries.find(gb => 
          gb.grade === estimatedGrade || 
          gb.grade === `Grade ${estimatedGrade}` ||
          gb.grade.includes(estimatedGrade)
        );
        awardedMarks = gradeBoundary ? gradeBoundary.minMarks : 0;
        overallScore = Math.round((awardedMarks / (totalMarks || 40)) * 100);
      }
      
      // Ensure grade is in clean format (just number/letter, not "Grade X")
      if (estimatedGrade && estimatedGrade.startsWith('Grade ')) {
        estimatedGrade = estimatedGrade.replace('Grade ', '');
      }
      
      // Add derived values to feedback for display
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
        // Cumulative grading info
        isCumulative: hasPreviousParagraphs,
        paragraphCount: paragraphCount,
        currentParagraphTitle: paragraphConfig.title,
        // Primary grade display (for exam-style grading)
        estimatedGrade: hasAuthenticDescriptors ? (estimatedGrade || null) : null,
        // Marks breakdown for transparency
        awardedMarks: hasAuthenticDescriptors ? (awardedMarks || 0) : null,
        totalMarks: hasAuthenticDescriptors ? (totalMarks || 40) : null,
        markBreakdown: hasAuthenticDescriptors && estimatedGrade ? `${awardedMarks}/${totalMarks || 40} marks = Grade ${estimatedGrade}` : null,
        // For internal tracking and fallback display
        overallScore: overallScore || 0
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

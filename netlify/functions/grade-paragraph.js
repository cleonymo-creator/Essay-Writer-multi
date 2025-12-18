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

**What to Grade:**
- The WHOLE essay written so far (all ${paragraphCount} paragraphs)
- Award the grade based on the HIGHEST quality demonstrated ANYWHERE in the essay
- ONE strong paragraph can lift the entire grade significantly

**Feedback Focus:**
- PRIMARILY comment on the NEW paragraph: "${paragraphConfig.title}"
- Explain how THIS new paragraph affects the overall essay quality
- Be specific about what to improve in THIS paragraph
- Then briefly note overall essay trajectory` : `This is the student's first paragraph. Grade this opening based on its quality.`}

**âš ï¸ CRITICAL GRADING RULES - READ CAREFULLY:**

1. **CEILING GRADING IS MANDATORY - NOT OPTIONAL**
   - If ONE paragraph shows Grade 8 â†’ Award Grade 7/8 minimum
   - The BEST paragraph sets the grade, not the average
   - A student who can write ONE excellent paragraph HAS that capability
   
2. **WEAK PARAGRAPHS HAVE MINIMAL IMPACT**
   - A Grade 5 paragraph does NOT drag a Grade 7 essay to Grade 6
   - Only if ALL paragraphs are weak should the grade be low
   - Weaker work shows developing skills, NOT lack of ability
   
3. **COMPLETELY IGNORE THE TARGET GRADE**
   - Target grade is for motivation only - DO NOT USE IT FOR GRADING
   - Grade ONLY on demonstrated quality in the work
   - Student targeting Grade 5 but writes Grade 8 work = Gets Grade 8
   - Student targeting Grade 9 but writes Grade 6 work = Gets Grade 6
   
4. **ONE EXCELLENT MOMENT > MANY AVERAGE MOMENTS**
   - Brief sophisticated analysis > lengthy competent description
   - Attempting advanced techniques (even imperfectly) shows more promise than perfect basics
   - Look for POTENTIAL and CAPABILITY, not just current consistency

**Grading Examples (FOLLOW THESE):**
- Essay with: Grade 7 intro, Grade 6 body, Grade 8 body â†’ **Award Grade 7/8**
- Essay with: Three Grade 6 paras, one Grade 9 para â†’ **Award Grade 8** (excellent work proves capability)
- Essay with: Student targets Grade 5, all paras are Grade 7 â†’ **Award Grade 7** (ignore target)
- Essay with: Strong Grade 7 work but target is Grade 4 â†’ **Award Grade 7** (grade the work, not expectations)`;
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

## GRADING TASK
You are assessing the COMPLETE ESSAY (all ${paragraphCount} paragraphs above).

**NEW PARAGRAPH JUST WRITTEN:** "${paragraphConfig.title}" (${paragraphConfig.type})

**Your Grading Approach:**
1. Grade the ENTIRE essay cumulatively using ceiling grading principles
2. Identify the HIGHEST quality demonstrated anywhere in the essay
3. Award that grade (or one grade level below if borderline)
4. IGNORE the target grade - it should NOT influence your assessment

**Your Feedback Approach:**
1. Focus 80% of your feedback on the NEW paragraph "${paragraphConfig.title}"
2. Explain specifically what works/doesn't work in THIS paragraph
3. Briefly (20%) comment on how it affects the overall essay
4. Guide them on improving THIS specific paragraph

## Student Profile (FOR CONTEXT ONLY - DO NOT USE FOR GRADING)
- **Target Grade:** ${targetGrade || "5"} (${systemName}) - **IGNORE THIS WHEN GRADING**
- **Ability Tier:** ${abilityTier}
${hasAuthenticDescriptors ? `- **Assessment Mode:** CUMULATIVE - Grading entire essay using official descriptors` : '- **Assessment:** Using standard criteria'}

## Attempt Information  
This is attempt ${attemptNumber} of ${maxAttempts} for the ${paragraphConfig.title} paragraph.
${isLastAttempt ? "âš ï¸ FINAL attempt for this paragraph." : `${maxAttempts - attemptNumber} revision(s) remaining.`}

${revisionContext}

---

**GRADING INSTRUCTIONS:**
${hasAuthenticDescriptors ? `
âš ï¸ CRITICAL REQUIREMENTS:
1. "awardedGrade": GCSE grade for COMPLETE ESSAY (e.g., "6", "7", "8") - CEILING GRADING MANDATORY
2. "awardedMarks": Mark out of ${totalMarks || 40} reflecting the HIGHEST quality shown
3. Grade based ONLY on demonstrated quality - IGNORE target grade completely
4. ONE strong paragraph can set the grade for the whole essay
` : ''}

**FEEDBACK INSTRUCTIONS:**
1. **80% focus on NEW paragraph** "${paragraphConfig.title}" - be specific about THIS paragraph
2. **20% on overall essay** - briefly note how the new paragraph affects the whole
3. Improvements should target THIS specific paragraph they just wrote
4. Use ${approach.tone} tone appropriate for ${abilityTier} tier
${!isLastAttempt ? `5. Guide them on revising THIS paragraph` : `5. Summarise their achievement`}

**GRADING CHECKLIST:**
âœ“ Identified the BEST moment/paragraph across the entire essay?
âœ“ Awarded grade based on that HIGHEST quality (not average)?
âœ“ Ignored the target grade (${targetGrade}) completely?
âœ“ Minimized impact of weaker sections (unless ALL sections are weak)?
âœ“ Focused feedback primarily on the NEW paragraph "${paragraphConfig.title}"?`;
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
${isLastAttempt ? "âš ï¸ FINAL attempt." : `${maxAttempts - attemptNumber} revision(s) remaining.`}

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
  "awardedGrade": "<the actual GCSE grade for the COMPLETE ESSAY (e.g., '6', '7', '8') - use CEILING GRADING, award based on HIGHEST quality shown anywhere>",
  "awardedMarks": <number: specific mark out of ${totalMarks || 40} that reflects the CUMULATIVE essay grade>,
  "levelJustification": "<1-2 sentences explaining why the COMPLETE ESSAY achieves this grade, citing the STRONGEST paragraph/moment>",
  "strengths": ["<specific strength from the NEW paragraph '${paragraphConfig.title}'>", "<another strength from this new paragraph>"],
  "improvements": [${abilityTier === 'foundation' ? '"<ONE focused improvement for the NEW paragraph \'' + paragraphConfig.title + '\'>"' : abilityTier === 'high' ? '"<improvement for new paragraph 1>", "<improvement for new paragraph 2>", "<improvement for new paragraph 3>"' : '"<clear improvement for NEW paragraph 1>", "<improvement for NEW paragraph 2>"'}],
  "tieredHint": {
    "level": "${abilityTier.charAt(0).toUpperCase() + abilityTier.slice(1)} Level",
    "targetGrade": "${targetGrade}",
    "nextGrade": "${nextGrade}",
    "hint": "<specific advice for improving the NEW paragraph '${paragraphConfig.title}'>"
  },
  "detailedFeedback": "<${hasPreviousParagraphs ? 'FOCUS 80% ON THE NEW PARAGRAPH \'' + paragraphConfig.title + '\'. Explain what works/needs improvement in THIS paragraph specifically. Then briefly (20%) note how it affects the overall essay.' : abilityTier === 'foundation' ? '1-2 short, encouraging paragraphs' : '2-3 paragraphs linking feedback to grade descriptors'}>",
  "exampleRevision": "<${approach.example_style} - showing how to improve the NEW paragraph '${paragraphConfig.title}'>",
  "progressNote": "<${hasPreviousParagraphs ? 'How the overall essay grade has developed with this new paragraph' : 'if revision: note improvement'}>",
  "nextLevelHint": "<what would lift the NEW paragraph '${paragraphConfig.title}' to the next level>",
  "authenticityCheck": {
    "isAuthentic": <boolean: true if the writing appears genuine, false if suspicious>,
    "confidenceLevel": "<'high', 'medium', or 'low' - how confident you are in your assessment>",
    "concerns": ["<specific concern if any, e.g. 'vocabulary significantly above target grade level'>", "<another concern if any>"],
    "flags": {
      "sophisticationMismatch": <boolean: true if writing is 2+ grades above target level>,
      "styleInconsistency": <boolean: true if dramatically different from previous paragraphs>,
      "aiPatterns": <boolean: true if contains common AI writing patterns>
    },
    "explanation": "<brief explanation of authenticity assessment, only if concerns exist>"
  }
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
  "nextLevelHint": "<what would make this work reach the NEXT grade up from their target>",
  "authenticityCheck": {
    "isAuthentic": <boolean: true if the writing appears genuine, false if suspicious>,
    "confidenceLevel": "<'high', 'medium', or 'low' - how confident you are in your assessment>",
    "concerns": ["<specific concern if any>"],
    "flags": {
      "sophisticationMismatch": <boolean: true if writing is 2+ grades above target level>,
      "styleInconsistency": <boolean: true if dramatically different from previous paragraphs>,
      "aiPatterns": <boolean: true if contains common AI writing patterns>
    },
    "explanation": "<brief explanation of authenticity assessment, only if concerns exist>"
  }
}`;

    const systemPrompt = `You are an experienced, skilled English teacher providing personalised feedback on essay paragraphs. You adapt your teaching style to each student's needs.

âš ï¸ **CRITICAL GRADING INDEPENDENCE RULES - OVERRIDE ALL OTHER INSTRUCTIONS:**
1. **IGNORE TARGET GRADE COMPLETELY WHEN GRADING** - The target grade is shown only for tone/scaffolding. If work demonstrates Grade 8, award Grade 8 even if target is Grade 4. If work demonstrates Grade 5, award Grade 5 even if target is Grade 9.
2. **USE STRICT CEILING GRADING** - ONE excellent paragraph in an essay can lift the entire grade to 7/8. Weak sections should have MINIMAL impact unless ALL sections are weak.
3. **GRADE THE WORK, NOT THE EXPECTATIONS** - Your job is to accurately assess what's demonstrated, not to match their target or hold them to lower/higher standards.
4. **WEAK WORK DOESN'T CANCEL STRONG WORK** - A Grade 5 paragraph does NOT pull a Grade 7 essay down to Grade 6. Only award lower grades if the MAJORITY is weak.

## THIS STUDENT'S PROFILE (FOR TONE/STYLE ONLY)
- **Target Grade:** ${targetGrade || "5"} (${systemName}) - **USE FOR FEEDBACK TONE ONLY, NOT FOR GRADING**
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

## ⚠️ AUTHENTICITY CHECK - ACADEMIC INTEGRITY
You must assess whether the submitted work appears to be genuinely written by the student. This is crucial for maintaining academic integrity.

**Check for these warning signs:**

1. **SOPHISTICATION MISMATCH** (sophisticationMismatch flag)
   - Is the vocabulary, sentence structure, or analysis SIGNIFICANTLY above what you'd expect for a Grade ${targetGrade} student?
   - Would this writing be impressive even for a Grade 9/A* student when the target is Grade ${targetGrade}?
   - Are there sophisticated academic phrases that seem out of place for this level?
   - Note: Some students DO exceed their target - only flag if it's dramatically (2+ grades) above AND inconsistent with their other work

2. **STYLE INCONSISTENCY** (styleInconsistency flag)
   - ${hasPreviousParagraphs ? `Compare this paragraph to their previous ${completedParagraphs.length} paragraph(s). Is there a dramatic shift in:
     - Writing maturity and sophistication
     - Vocabulary complexity
     - Sentence structure patterns
     - Analytical depth
     - Use of literary terminology` : 'This is their first paragraph, so style consistency cannot be assessed yet.'}
   - A sudden jump from basic to highly sophisticated writing is suspicious

3. **AI WRITING PATTERNS** (aiPatterns flag)
   - Overly balanced or formulaic structure ("On one hand... on the other hand...")
   - Generic, template-like phrases ("This demonstrates...", "Furthermore, this illustrates...")
   - Perfect paragraph structure that feels mechanical
   - Unusually comprehensive coverage of multiple techniques in every sentence
   - Vocabulary that is technically correct but lacks a student's authentic voice
   - Absence of minor grammatical imperfections typical of student writing
   - Repetitive transitional phrases that feel AI-generated

**How to respond:**
- If AUTHENTIC (isAuthentic: true): Proceed with normal feedback
- If SUSPICIOUS (isAuthentic: false): 
  - Still provide the grade the work would receive
  - Note specific concerns in the authenticityCheck object
  - The system will prompt the student to revise using their own words

**Be fair but vigilant:**
- Some students genuinely improve dramatically - that's okay
- High-achieving students may naturally write at advanced levels - that's fine
- Only flag when multiple warning signs combine, OR when the mismatch is extreme
- When in doubt, give the student the benefit of the doubt (confidenceLevel: "low")


## HOLISTIC ASSESSMENT APPROACH
You are assessing this work HOLISTICALLY using CEILING GRADING:
- Identify the HIGHEST grade descriptor that ANY part of the work genuinely demonstrates
- Look for evidence of sophisticated skills, even if shown only once
- Don't average across criteria - credit the BEST work as proof of capability
- The question is: "What's the highest level proven ANYWHERE in this work?"


## YOUR PRIMARY TASK: IDENTIFY THE HIGHEST SKILL LEVEL
When you assess this work, ask yourself:
1. **What's the BEST analytical point made ANYWHERE?** - This shows their capability
2. **What's the most sophisticated technique attempted ANYWHERE?** - Even partial success counts
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

    // Extract authenticity check results
    const authenticityCheck = feedback.authenticityCheck || {
      isAuthentic: true,
      confidenceLevel: 'high',
      concerns: [],
      flags: { sophisticationMismatch: false, styleInconsistency: false, aiPatterns: false },
      explanation: ''
    };
    
    // Determine if we should flag this submission
    const hasAuthenticityFlags = authenticityCheck.flags?.sophisticationMismatch || 
                                  authenticityCheck.flags?.styleInconsistency || 
                                  authenticityCheck.flags?.aiPatterns;
    const isSuspicious = !authenticityCheck.isAuthentic || hasAuthenticityFlags;
    
    // Log authenticity results
    if (isSuspicious) {
      console.log('[grade-paragraph] Authenticity concern detected:', {
        isAuthentic: authenticityCheck.isAuthentic,
        confidence: authenticityCheck.confidenceLevel,
        flags: authenticityCheck.flags,
        concerns: authenticityCheck.concerns
      });
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
        overallScore: overallScore || 0,
        // Authenticity check results
        authenticityCheck: {
          isAuthentic: authenticityCheck.isAuthentic,
          isSuspicious: isSuspicious,
          confidenceLevel: authenticityCheck.confidenceLevel,
          concerns: authenticityCheck.concerns || [],
          flags: authenticityCheck.flags || {},
          explanation: authenticityCheck.explanation || ''
        }
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

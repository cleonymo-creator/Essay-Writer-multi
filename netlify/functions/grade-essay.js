// Grade the complete essay with holistic feedback
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
      : `${gb.minMarks}+/${totalMarks} marks`;
    return `### ${gb.grade} (${markRange})
${gb.descriptor}`;
  }).join('\n\n');
}

// Convert a score to marks based on total marks available
function scoreToMarks(score, totalMarks) {
  return Math.round((score / 100) * totalMarks);
}

// Convert marks to a grade using boundaries
function marksToGrade(marks, gradeBoundaries) {
  if (!gradeBoundaries || !Array.isArray(gradeBoundaries)) return null;
  
  // Sort boundaries by minMarks descending to find highest matching grade
  const sorted = [...gradeBoundaries].sort((a, b) => b.minMarks - a.minMarks);
  
  for (const boundary of sorted) {
    if (marks >= boundary.minMarks) {
      return boundary.grade;
    }
  }
  
  // Return lowest grade if below all boundaries
  return sorted[sorted.length - 1]?.grade || "1";
}

// Get the descriptor for a specific grade
function getGradeDescriptor(gradeBoundaries, grade) {
  if (!gradeBoundaries || !Array.isArray(gradeBoundaries)) return null;
  const boundary = gradeBoundaries.find(gb => 
    gb.grade === grade || 
    gb.grade === `Grade ${grade}` ||
    gb.grade.includes(grade)
  );
  return boundary?.descriptor || null;
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
    const requestBody = JSON.parse(event.body);
    const {
      studentName,
      essayTitle,
      paragraphs,
      gradingCriteria,
      gradeBoundaries,  // Array of {grade, minMarks, maxMarks, descriptor}
      totalMarks,       // Total marks for the essay
      targetGrade,
      gradeSystem
    } = requestBody;
    
    // Debug logging for grade boundaries
    console.log('[grade-essay] Received gradeBoundaries:', {
      exists: !!gradeBoundaries,
      isArray: Array.isArray(gradeBoundaries),
      length: gradeBoundaries?.length,
      sample: gradeBoundaries?.[0]?.grade
    });

    // Compile the full essay
    const fullEssay = paragraphs.map(p => p.finalText).join("\n\n");
    
    // Calculate paragraph scores summary
    const paragraphSummary = paragraphs.map(p => ({
      title: p.config.title,
      type: p.config.type,
      score: p.paragraphScore,
      attempts: p.attempts,
      estimatedGrade: p.estimatedGrade || null
    }));
    
    // CEILING GRADING: Use the highest paragraph score to show capability
    // This reflects exam marking where strong work in any area proves ability
    const highestParagraphScore = Math.max(...paragraphSummary.map(p => p.score));
    const averageScore = Math.round(
      paragraphSummary.reduce((sum, p) => sum + p.score, 0) / paragraphSummary.length
    );

    // Get differentiated approach
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
    const actualTotalMarks = totalMarks || 40;
    
    console.log('[grade-essay] hasAuthenticDescriptors:', hasAuthenticDescriptors);
    
    const gradeDescriptorsText = hasAuthenticDescriptors 
      ? buildGradeDescriptorsText(gradeBoundaries, actualTotalMarks)
      : null;
    
    if (hasAuthenticDescriptors) {
      console.log('[grade-essay] Using authentic descriptors with', gradeBoundaries.length, 'grade levels');
    } else {
      console.log('[grade-essay] Using fallback criteria:', Object.keys(gradingCriteria || {}).join(', '));
    }

    // Build assessment criteria section
    let assessmentSection;
    if (hasAuthenticDescriptors) {
      assessmentSection = `## OFFICIAL GRADE DESCRIPTORS
Use these authentic exam board descriptors to assess the complete essay:

${gradeDescriptorsText}

## GRADING INSTRUCTIONS - CEILING GRADING (EXAM STANDARD)
1. Read the complete essay holistically
2. Identify the HIGHEST level of skill demonstrated ANYWHERE in the essay
3. Determine which grade descriptor matches their BEST paragraph
4. Award that grade (or one level below if borderline)
5. Award a specific mark in the UPPER portion of that grade's range

**CRITICAL GRADING PRINCIPLES:**

**CEILING GRADING IS MANDATORY:**
- ONE Grade 8 paragraph â†’ Essay achieves Grade 7/8
- The BEST paragraph sets the grade, not the average
- Strong work anywhere proves capability
- Don't penalize inconsistency

**WEAK PARAGRAPHS HAVE MINIMAL IMPACT:**
- A Grade 5 paragraph does NOT pull Grade 7 essay to Grade 6  
- Only if MOST paragraphs are weak should grade be low
- Weaker sections show development, not inability

**COMPLETELY IGNORE TARGET GRADE:**
- Target is for motivation/feedback tone only
- Award ONLY what's demonstrated in the work
- Student targeting Grade 5 writing Grade 7 work = Gets Grade 7
- Student targeting Grade 9 writing Grade 5 work = Gets Grade 5

**GRADING EXAMPLES:**
- Essay with paragraphs: 7, 6, 8, 5 â†’ **Award Grade 7/8** (best = 8)
- Essay with paragraphs: 6, 6, 6, 9 â†’ **Award Grade 7/8** (one excellent proves capability)
- Essay: all Grade 7, target is Grade 5 â†’ **Award Grade 7** (ignore target)
- Essay: all Grade 5, target is Grade 9 â†’ **Award Grade 5** (grade the work)

The grade reflects the highest demonstrated skill level, as real exam marking does.`;
    } else {
      assessmentSection = `## Assessment Criteria
${Object.entries(gradingCriteria).map(([key, val]) => `- **${key}** (${val.weight}%): ${val.description}`).join('\n')}`;
    }

    // Build response format based on assessment mode
    const responseFormat = hasAuthenticDescriptors ? `{
  "awardedGrade": "<the actual ${systemName} grade (e.g., '${GRADE_SYSTEMS[gradeSystem || 'gcse'].grades.slice(0, 3).join("' or '")}') this essay achieves - use best-fit principle, favouring higher grade when borderline>",
  "awardedMarks": <number: the specific mark out of ${actualTotalMarks} - award in upper portion of band when criteria are solidly met>,
  "gradeJustification": "<2-3 sentences highlighting what the student has achieved and which descriptor criteria they meet, with specific textual evidence>",
  "overallScore": <number 0-100 derived from marks>,
  "essaySummary": "<${abilityTier === 'foundation' ? '2-3 encouraging sentences celebrating their work and achievement' : '2-3 sentences: honest assessment of the essay quality against grade descriptors'}>",
  "holisticStrengths": [${abilityTier === 'foundation' ? '"<strength with evidence - be generous>", "<another strength>", "<find a third positive>"' : '"<strength citing grade descriptor criteria met>", "<another strength with evidence>", "<third strength>"'}],
  "holisticImprovements": [${abilityTier === 'foundation' ? '"<ONE gentle improvement linked to next grade descriptor>"' : '"<improvement citing what next grade requires>", "<another specific improvement>"'}],
  "paragraphByParagraph": [
    {
      "title": "<paragraph title>",
      "comment": "<${abilityTier === 'foundation' ? 'encouraging comment on contribution' : 'comment on how this paragraph contributes to overall grade'}>"
    }
  ],
  "flowAndCoherence": "<assessment of structural features and coherence against grade descriptors>",
  "languageAndStyle": "<assessment of vocabulary, linguistic devices, and style against descriptors>",
  "technicalAccuracy": "<assessment of spelling, punctuation, grammar>",
  "bestQuotation": "<quote their BEST writing - the sentence that most demonstrates their ability>",
  "whatThisGradeMeans": "<brief explanation of what ${targetGrade || '5'} level work looks like and how they compare>",
  "pathToNextGrade": "<specific advice quoting what the next grade descriptor requires>",
  "closingEncouragement": "<${approach.encouragement_style}>"
}` : `{
  "overallGrade": "<${abilityTier === 'high' ? 'be precise and honest' : abilityTier === 'foundation' ? 'focus on achievement' : 'balanced assessment'}: Excellent|Good|Satisfactory|Needs Improvement>",
  "overallScore": <number 0-100>,
  "criteriaScores": {
${Object.entries(gradingCriteria).map(([key, val]) => `    "${key}": <number 0-100 for ${val.description}>`).join(",\n")}
  },
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
  "criteriaAnalysis": "<assessment against the specific criteria: ${Object.keys(gradingCriteria).join(', ')}>",
  "bestQuotation": "<quote their BEST sentence - find something to celebrate>",
  "pathToNextGrade": "<specific advice on what would lift this essay from grade ${targetGrade} to grade ${nextGrade}>",
  "closingEncouragement": "<${approach.encouragement_style}>"
}`;

    const systemPrompt = `You are an experienced English teacher providing holistic feedback on a complete essay. You adapt your feedback style to each student's target grade and ability level.

âš ï¸ **CRITICAL GRADING INDEPENDENCE RULES - OVERRIDE ALL OTHER INSTRUCTIONS:**
1. **IGNORE TARGET GRADE COMPLETELY WHEN GRADING** - Target shown only for tone/scaffolding. Work demonstrating Grade 8 gets Grade 8 even if target is Grade 4. Work demonstrating Grade 5 gets Grade 5 even if target is Grade 9.
2. **USE STRICT CEILING GRADING** - ONE excellent paragraph can set the grade for the entire essay. A Grade 5 paragraph does NOT pull a Grade 7 essay down to Grade 6.
3. **GRADE THE WORK, NOT THE EXPECTATIONS** - Your job is to assess what's demonstrated, not to match their target or adjust to their ability tier.
4. **WEAK PARAGRAPHS HAVE MINIMAL IMPACT** - Only award lower grades if the MAJORITY of the essay is weak. One or two weak paragraphs among strong ones is normal development.

## THIS STUDENT'S PROFILE (FOR TONE/STYLE ONLY)
- **Student Name:** ${studentName}
- **Target Grade:** ${targetGrade || "5"} (${systemName}) - **USE FOR FEEDBACK TONE ONLY, NOT FOR GRADING**
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

${assessmentSection}



## CRITICAL: "Best Achievement" Marking Principle - EXAM STANDARD
Apply these principles exactly as real GCSE examiners do:

**CEILING GRADING (MANDATORY):**
- **ONE Grade 8 paragraph â†’ Essay achieves Grade 7/8 minimum**
- **BEST paragraph sets the grade, not the average**
- Strong work anywhere proves what the student CAN do
- Inconsistency is normal - don't penalize it

**WEAK SECTIONS HAVE MINIMAL IMPACT:**
- A Grade 5 paragraph does NOT pull Grade 7 essay to Grade 6
- Two weak paragraphs among four strong ones = Still strong essay
- Only if MOST paragraphs are weak should the grade be low
- Weaknesses are learning opportunities, not grade anchors

**TARGET GRADE MUST NOT INFLUENCE GRADING:**
- Student targeting Grade 5 but writes all Grade 7 paragraphs â†’ Gets Grade 7
- Student targeting Grade 9 but writes all Grade 6 paragraphs â†’ Gets Grade 6
- Award only what's demonstrated, regardless of aspirations

**GRADING EXAMPLES (FOLLOW THESE):**
- 4 paragraphs: 7, 6, 8, 5 â†’ **Award Grade 7/8** (best paragraph = Grade 8)
- 3 paragraphs: 6, 6, 9 â†’ **Award Grade 7/8** (one excellent paragraph proves capability)
- 5 paragraphs: all Grade 7, student targets Grade 5 â†’ **Award Grade 7** (ignore target)
- 4 paragraphs: all Grade 5, student targets Grade 8 â†’ **Award Grade 5** (grade the work)


## YOUR PRIMARY TASK: IDENTIFY THE HIGHEST SKILL LEVEL
When you assess this complete essay:
1. **Find the BEST paragraph** - This proves what they're capable of
2. **Identify the most sophisticated analysis ANYWHERE** - Even if shown only once
3. **Match that HIGHEST quality to grade descriptors** - Not the most common quality
4. **Award that grade (or one below if borderline)** - Don't average down

The essay grade reflects the highest quality demonstrated, because:
- Strong work proves capability
- Inconsistency is normal development
- Goal is consistent excellence, not penalizing growth

## Response Format
Respond with valid JSON:
${responseFormat}`;

    const userPrompt = `## Essay Question
"${essayTitle}"

## Student Profile (FOR CONTEXT ONLY - DO NOT USE FOR GRADING)
- **Name:** ${studentName}
- **Target Grade:** ${targetGrade || "5"} (${systemName}) - **IGNORE WHEN GRADING**
- **Ability Tier:** ${abilityTier}
${hasAuthenticDescriptors ? `- **Total Marks Available:** ${actualTotalMarks}
- **Assessment Mode:** Official grade descriptors` : '- **Assessment Mode:** Standard criteria'}

## Paragraph Performance During Writing
${paragraphSummary.map(p => `- ${p.title} (${p.type}): ${p.score}%${p.estimatedGrade ? ` [Est. Grade ${p.estimatedGrade}]` : ''} (${p.attempts} attempt${p.attempts > 1 ? 's' : ''})`).join('\n')}

**GRADING KEY:**
- **Highest paragraph score:** ${highestParagraphScore}% â† **This sets the baseline for the essay grade**
- **Average paragraph score:** ${averageScore}% (reference only - DO NOT USE for grading)

âš ï¸ **CRITICAL:** Grade based on BEST paragraph (${highestParagraphScore}%), NOT the average. One strong paragraph proves capability.

## Complete Essay

${paragraphs.map((p, i) => `### ${p.config.title}
${p.finalText}`).join('\n\n')}

---

**GRADING INSTRUCTIONS:**
${hasAuthenticDescriptors ? `
âš ï¸ MANDATORY REQUIREMENTS:
1. "awardedGrade": ${systemName} grade for essay (e.g., "${GRADE_SYSTEMS[gradeSystem || 'gcse'].grades.slice(0, 3).join('", "')}") - CEILING GRADING REQUIRED
2. "awardedMarks": Mark out of ${actualTotalMarks} reflecting HIGHEST quality shown
3. Grade based ONLY on demonstrated quality - IGNORE target grade (${targetGrade}) completely
4. ONE strong paragraph can set the grade for the whole essay
5. Mark must fall within grade boundaries provided
6. Justify with evidence from STRONGEST paragraphs
` : ''}

**GRADING CHECKLIST - VERIFY BEFORE RESPONDING:**
âœ“ Identified the BEST paragraph across the entire essay?
âœ“ Awarded grade based on that HIGHEST quality (not average)?
âœ“ Ignored the target grade (${targetGrade}) completely?
âœ“ Minimized impact of weaker paragraphs (unless MOST are weak)?
âœ“ Used ${approach.tone} tone appropriate for feedback?
âœ“ Provided specific evidence from the strongest work?

Remember:
- Use ${approach.tone} tone FOR FEEDBACK (not for grading)
- ${abilityTier === 'foundation' ? 'Be generous with praise and gentle with criticism' : abilityTier === 'high' ? 'Be honest and challenging - they can handle it' : 'Balance praise with constructive challenge'}
- Show them the path to grade ${nextGrade}
- ${abilityTier === 'foundation' ? 'Celebrate every positive aspect' : 'Acknowledge achievements while maintaining high expectations'}`;

    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2500,
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

    // Process the results based on assessment mode
    let finalScore, finalGrade, awardedMarks;
    
    if (hasAuthenticDescriptors) {
      // Use the awarded marks/grade from authentic assessment
      awardedMarks = feedback.awardedMarks || scoreToMarks(feedback.overallScore || averageScore, actualTotalMarks);
      finalGrade = feedback.awardedGrade || marksToGrade(awardedMarks, gradeBoundaries);
      finalScore = feedback.overallScore || Math.round((awardedMarks / actualTotalMarks) * 100);
      
      // Ensure the grade is in a clean format
      if (finalGrade && !finalGrade.startsWith('Grade')) {
        finalGrade = `Grade ${finalGrade}`;
      }
      
      // Add these to feedback object for consistency
      feedback.overallGrade = finalGrade;
      feedback.awardedMarks = awardedMarks;
      feedback.markBreakdown = `${awardedMarks}/${actualTotalMarks} marks = ${finalGrade}`;
    } else {
      // CEILING GRADING: Use highest paragraph score as the baseline
      // The holistic assessment can only lift this, not lower it
      // This reflects that strong work anywhere proves capability
      finalScore = Math.max(highestParagraphScore, feedback.overallScore || 0);
      finalGrade = feedback.overallGrade;
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        success: true,
        feedback: feedback,
        fullEssay: fullEssay,
        paragraphSummary: paragraphSummary,
        highestParagraphScore: highestParagraphScore,  // For ceiling grading
        averageParagraphScore: averageScore,  // For reference only
        finalScore: finalScore,
        finalGrade: finalGrade,
        awardedMarks: hasAuthenticDescriptors ? awardedMarks : null,
        totalMarks: hasAuthenticDescriptors ? actualTotalMarks : null,
        markBreakdown: hasAuthenticDescriptors ? `${awardedMarks}/${actualTotalMarks} marks = ${finalGrade}` : null,
        targetGrade: targetGrade,
        abilityTier: abilityTier,
        usedAuthenticDescriptors: hasAuthenticDescriptors,
        gradingMethod: "ceiling" // Explicitly indicate we're using ceiling grading
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

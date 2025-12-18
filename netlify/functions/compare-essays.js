// Compare original vs improved essay - grades both versions
const Anthropic = require("@anthropic-ai/sdk").default;

const client = new Anthropic();

// Define grade systems
const GRADE_SYSTEMS = {
  gcse: {
    name: "GCSE",
    grades: ["9", "8", "7", "6", "5", "4", "3", "2", "1"]
  },
  alevel: {
    name: "A-Level",
    grades: ["A*", "A", "B", "C", "D", "E"]
  }
};

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

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  try {
    const requestBody = JSON.parse(event.body);
    const {
      studentName,
      essayTitle,
      originalParagraphs,  // Array of {title, type, text} - original first attempts
      improvedParagraphs,  // Array of {title, type, text} - final improved versions
      gradeBoundaries,
      totalMarks,
      targetGrade,
      gradeSystem
    } = requestBody;

    const systemName = GRADE_SYSTEMS[gradeSystem]?.name || "GCSE";
    const actualTotalMarks = totalMarks || 40;
    
    // Check if we have authentic grade descriptors
    const hasAuthenticDescriptors = gradeBoundaries && 
      Array.isArray(gradeBoundaries) && 
      gradeBoundaries.length > 0 &&
      gradeBoundaries[0]?.grade &&
      gradeBoundaries[0]?.descriptor;
    
    const gradeDescriptorsText = hasAuthenticDescriptors 
      ? buildGradeDescriptorsText(gradeBoundaries, actualTotalMarks)
      : null;

    // Compile essays
    const originalEssay = originalParagraphs.map(p => `### ${p.title}\n${p.text}`).join('\n\n');
    const improvedEssay = improvedParagraphs.map(p => `### ${p.title}\n${p.text}`).join('\n\n');
    
    // Check if they're actually different
    const essaysAreDifferent = originalEssay.trim() !== improvedEssay.trim();

    const systemPrompt = `You are an expert ${systemName} examiner comparing two versions of a student's essay to show the impact of their improvements.

${hasAuthenticDescriptors ? `## OFFICIAL GRADE DESCRIPTORS
Use these authentic exam board descriptors to assess both versions:

${gradeDescriptorsText}` : `## GRADING CRITERIA
Grade both essays on a percentage scale (0-100) considering content, analysis, expression, and technical accuracy.`}

## YOUR TASK
1. Grade the ORIGINAL essay (the student's first raw attempt, before any corrections)
2. Grade the IMPROVED essay (the final version after corrections and revisions)
3. Highlight the specific improvements that led to any grade difference
4. Be encouraging about progress while being accurate about grades

## RESPONSE FORMAT
Return valid JSON:
{
  "originalGrade": "<grade for original essay, e.g., '5' or 'B'>",
  "originalMarks": <marks out of ${actualTotalMarks} for original>,
  "originalStrengths": ["<strength 1>", "<strength 2>"],
  "originalWeaknesses": ["<key issue 1>", "<key issue 2>"],
  
  "improvedGrade": "<grade for improved essay>",
  "improvedMarks": <marks out of ${actualTotalMarks} for improved>,
  "improvedStrengths": ["<strength 1>", "<strength 2>", "<new strength from improvements>"],
  
  "gradeImprovement": "<description of grade change, e.g., 'Grade 5 → Grade 6' or 'No change'>",
  "marksGained": <number of additional marks earned through improvements>,
  "percentageImprovement": <percentage point improvement>,
  
  "keyImprovements": [
    {
      "area": "<what improved, e.g., 'Technical Accuracy', 'Expression', 'Analysis'>",
      "before": "<brief description of issue in original>",
      "after": "<how it was improved>",
      "impact": "<how this affected the grade>"
    }
  ],
  
  "overallProgressComment": "<encouraging 2-3 sentence summary of the student's progress, celebrating their improvements while noting areas for future growth>",
  
  "wouldHaveBeenGrade": "<what grade the original would have received if submitted as final - be honest but kind>"
}

## GRADING PRINCIPLES
- Be ACCURATE with grades - don't inflate either version
- The original essay shows the student's RAW ability before help
- The improved essay shows what they can achieve with guidance
- Even small improvements (1-2 marks) are worth celebrating
- If essays are identical, acknowledge this honestly
- Technical corrections (spelling, punctuation) typically add 1-3 marks
- Structural improvements can add more`;

    const userPrompt = `## Student: ${studentName}
## Essay Question: "${essayTitle}"
## Target Grade: ${targetGrade} (${systemName})
## Total Marks Available: ${actualTotalMarks}

${essaysAreDifferent ? '' : '⚠️ NOTE: The original and improved essays appear to be identical (no corrections were made).\n'}

---

## ORIGINAL ESSAY (First Attempt - Before Any Corrections)

${originalEssay}

---

## IMPROVED ESSAY (Final Version - After Corrections and Revisions)

${improvedEssay}

---

Please grade both versions and provide a detailed comparison showing the impact of the student's improvements.`;

    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2000,
      messages: [{ role: "user", content: userPrompt }],
      system: systemPrompt
    });

    const content = response.content[0].text;
    
    // Parse JSON response
    let comparison;
    try {
      comparison = JSON.parse(content);
    } catch {
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        comparison = JSON.parse(jsonMatch[1].trim());
      } else {
        const jsonStart = content.indexOf('{');
        const jsonEnd = content.lastIndexOf('}');
        if (jsonStart !== -1 && jsonEnd !== -1) {
          comparison = JSON.parse(content.slice(jsonStart, jsonEnd + 1));
        } else {
          throw new Error("Could not parse comparison JSON");
        }
      }
    }

    // Add computed fields
    comparison.essaysAreDifferent = essaysAreDifferent;
    comparison.totalMarks = actualTotalMarks;
    comparison.targetGrade = targetGrade;
    comparison.gradeSystem = gradeSystem;

    console.log('[compare-essays] Comparison complete:', {
      originalGrade: comparison.originalGrade,
      improvedGrade: comparison.improvedGrade,
      marksGained: comparison.marksGained,
      essaysAreDifferent
    });

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        success: true,
        comparison: comparison
      })
    };

  } catch (error) {
    console.error("Essay comparison error:", error);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        success: false,
        error: "Failed to compare essays",
        details: error.message
      })
    };
  }
};

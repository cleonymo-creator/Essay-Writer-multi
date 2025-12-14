// Grade essay using official mark scheme with initial vs improved comparison
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
      paragraphs, // Array of { config, finalText, initialText, attempts }
      officialMarkScheme,
      examBoard
    } = JSON.parse(event.body);

    if (!officialMarkScheme) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          success: false,
          error: "No official mark scheme provided"
        })
      };
    }

    // Compile essays
    const initialEssay = paragraphs.map(p => p.initialText || p.finalText).join("\n\n");
    const improvedEssay = paragraphs.map(p => p.finalText).join("\n\n");
    
    // Build level descriptors text
    const levelDescriptorsText = officialMarkScheme.levelDescriptors
      .map(level => {
        const aoDescriptors = Object.entries(level.descriptors)
          .map(([ao, desc]) => `  - ${ao}: ${desc}`)
          .join('\n');
        return `### Level ${level.level} (${level.marks} marks) - Grade ${level.grade}\n${aoDescriptors}`;
      })
      .join('\n\n');
    
    // Build AO descriptions
    const aoDescriptions = Object.entries(officialMarkScheme.assessmentObjectives)
      .map(([ao, details]) => `**${ao}** (${details.marks} marks, ${details.weight}%): ${details.description}`)
      .join('\n\n');

    const systemPrompt = `You are an experienced ${examBoard || officialMarkScheme.examBoard} examiner marking GCSE English essays according to the official mark scheme.

## Your Task
Grade TWO versions of the same essay:
1. **Initial Version**: The student's first attempt at each paragraph
2. **Improved Version**: After AI-guided revision

For each version, you must:
- Assess against each Assessment Objective (AO)
- Determine the appropriate Level (1-6)
- Award a specific mark within that level's range
- Provide detailed justification

## Exam Details
- **Board**: ${examBoard || officialMarkScheme.examBoard}
- **Qualification**: ${officialMarkScheme.qualification}
- **Paper**: ${officialMarkScheme.paper}
- **Total Marks**: ${officialMarkScheme.totalMarks}

## Assessment Objectives
${aoDescriptions}

## Level Descriptors
${levelDescriptorsText}

## Grade Boundaries
${officialMarkScheme.gradeBoundaries.map(gb => `Grade ${gb.grade}: ${gb.minMark}+ marks`).join('\n')}

## Important Guidelines - Ceiling Grading Principle
Real GCSE examiners apply the "Best Achievement" principle - you must too:
- **Credit the HIGHEST level of skill demonstrated** - if ONE paragraph shows Level 5 analysis, they CAN work at Level 5
- **Don't average quality** - inconsistency is normal in developing writers, not evidence of lower ability  
- **Look for the ceiling** - what's the best they achieved anywhere in the essay?
- **Partial mastery counts** - attempting sophisticated techniques (even imperfectly) shows more promise than simple competence
- **Don't penalize twice** - note weaknesses for feedback, but don't let them drag down marks across multiple AOs

Assessment Process:
1. Look for evidence of each AO in the student's writing
2. For each AO, identify the HIGHEST level demonstrated anywhere in the essay
3. Award the mark that best fits their STRONGEST work in that AO
4. Provide specific evidence from the text to justify your marks
5. Consider the whole essay, recognizing that strong work in any section proves capability

Example: If AO2 shows one paragraph with sophisticated language analysis (Level 5) and others at Level 3, award Level 4-5 marks because they've proven the higher capability.

## Response Format
You must respond with valid JSON in this exact format:
{
  "initialVersion": {
    "totalMark": <number>,
    "grade": "<grade 1-9>",
    "level": <number 1-6>,
    "aoBreakdown": {
      "AO1": {
        "mark": <number>,
        "level": <number>,
        "justification": "<specific evidence and reasoning>"
      },
      "AO2": {
        "mark": <number>,
        "level": <number>,
        "justification": "<specific evidence and reasoning>"
      },
      "AO3": {
        "mark": <number>,
        "level": <number>,
        "justification": "<specific evidence and reasoning>"
      }
    },
    "overallComment": "<2-3 sentence summary of this version's quality>",
    "keyStrengths": ["<strength 1>", "<strength 2>"],
    "keyWeaknesses": ["<weakness 1>", "<weakness 2>"]
  },
  "improvedVersion": {
    "totalMark": <number>,
    "grade": "<grade 1-9>",
    "level": <number 1-6>,
    "aoBreakdown": {
      "AO1": {
        "mark": <number>,
        "level": <number>,
        "justification": "<specific evidence and reasoning>"
      },
      "AO2": {
        "mark": <number>,
        "level": <number>,
        "justification": "<specific evidence and reasoning>"
      },
      "AO3": {
        "mark": <number>,
        "level": <number>,
        "justification": "<specific evidence and reasoning>"
      }
    },
    "overallComment": "<2-3 sentence summary of this version's quality>",
    "keyStrengths": ["<strength 1>", "<strength 2>"],
    "keyWeaknesses": ["<weakness 1>", "<weakness 2>"]
  },
  "comparison": {
    "marksImproved": <number>,
    "gradeChange": "<e.g. '4 Ã¢â€ â€™ 6' or 'No change'>",
    "mostImprovedArea": "<which AO showed most improvement>",
    "improvementSummary": "<2-3 sentences describing what improved and how>",
    "remainingTargets": ["<target 1 for further improvement>", "<target 2>"]
  },
  "examinerComment": "<final encouraging comment from the examiner's perspective>"
}`;

    const userPrompt = `## Question
"${essayTitle}"

## Student: ${studentName}

---

## INITIAL VERSION (First Attempt)

${paragraphs.map((p, i) => `### ${p.config.title}
${p.initialText || '[No initial version recorded - using final version]'}
${p.initialText ? '' : p.finalText}`).join('\n\n')}

---

## IMPROVED VERSION (After AI-Guided Revision)

${paragraphs.map((p, i) => `### ${p.config.title}
${p.finalText}`).join('\n\n')}

---

Please grade both versions according to the official ${examBoard || officialMarkScheme.examBoard} mark scheme, providing detailed AO-by-AO assessment and comparison.`;

    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4000,
      messages: [{ role: "user", content: userPrompt }],
      system: systemPrompt
    });

    const content = response.content[0].text;
    
    // Extract JSON from response
    let grading;
    try {
      grading = JSON.parse(content);
    } catch {
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        grading = JSON.parse(jsonMatch[1].trim());
      } else {
        const jsonStart = content.indexOf('{');
        const jsonEnd = content.lastIndexOf('}');
        if (jsonStart !== -1 && jsonEnd !== -1) {
          grading = JSON.parse(content.slice(jsonStart, jsonEnd + 1));
        } else {
          throw new Error("Could not parse official grading JSON");
        }
      }
    }

    // Add percentage scores for display
    const totalMarks = officialMarkScheme.totalMarks;
    grading.initialVersion.percentage = Math.round((grading.initialVersion.totalMark / totalMarks) * 100);
    grading.improvedVersion.percentage = Math.round((grading.improvedVersion.totalMark / totalMarks) * 100);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        success: true,
        grading: grading,
        initialEssay: initialEssay,
        improvedEssay: improvedEssay,
        markSchemeUsed: {
          examBoard: officialMarkScheme.examBoard,
          qualification: officialMarkScheme.qualification,
          totalMarks: totalMarks
        }
      })
    };

  } catch (error) {
    console.error("Official grading error:", error);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        success: false,
        error: "Failed to grade essay officially",
        details: error.message
      })
    };
  }
};

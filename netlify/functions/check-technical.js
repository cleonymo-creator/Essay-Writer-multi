// Check for technical errors (grammar, spelling, punctuation, expression)
// Returns errors one at a time for student correction
const Anthropic = require("@anthropic-ai/sdk").default;

const client = new Anthropic();

// Define error categories
const ERROR_CATEGORIES = {
  spelling: {
    name: "Spelling",
    icon: "📝",
    color: "#ef4444"
  },
  grammar: {
    name: "Grammar",
    icon: "📐",
    color: "#f59e0b"
  },
  punctuation: {
    name: "Punctuation",
    icon: "✏️",
    color: "#8b5cf6"
  },
  expression: {
    name: "Expression",
    icon: "💬",
    color: "#3b82f6"
  }
};

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  try {
    const requestBody = JSON.parse(event.body);
    const {
      paragraphText,
      paragraphTitle,
      targetGrade,
      gradeSystem
    } = requestBody;

    // Determine how strict to be based on target grade
    const isHighAchiever = ['9', '8', '7', 'A*', 'A'].includes(targetGrade);
    const isFoundation = ['3', '2', '1', 'D', 'E'].includes(targetGrade);
    
    const strictnessLevel = isHighAchiever ? 'high' : (isFoundation ? 'foundation' : 'standard');

    const systemPrompt = `You are an expert English teacher checking student work for technical errors. Your job is to identify errors in spelling, grammar, punctuation, and expression that the student needs to correct.

## STRICTNESS LEVEL: ${strictnessLevel.toUpperCase()}
${strictnessLevel === 'high' ? `
- Check for subtle grammar issues and sophisticated expression improvements
- Flag awkward phrasing that could be more elegant
- Identify opportunities for more precise vocabulary
- Note comma splice errors, dangling modifiers, etc.
` : strictnessLevel === 'foundation' ? `
- Focus only on clear, obvious errors
- Prioritise spelling mistakes and basic punctuation
- Only flag grammar issues that significantly impair meaning
- Be encouraging - don't overwhelm with minor issues
- Maximum 3-4 errors to correct
` : `
- Check for common spelling and grammar mistakes
- Flag missing or incorrect punctuation
- Note unclear expression that could confuse readers
- Balance thoroughness with not overwhelming the student
`}

## ERROR TYPES TO CHECK

1. **SPELLING** - Misspelled words, common confusions (their/there/they're, your/you're, etc.)

2. **GRAMMAR** - Subject-verb agreement, tense consistency, sentence fragments, run-on sentences, pronoun errors

3. **PUNCTUATION** - Missing full stops, incorrect comma usage, missing apostrophes, quotation mark errors, missing capital letters at sentence start

4. **EXPRESSION** - Unclear sentences, awkward phrasing, word repetition, wrong word choice

## RESPONSE FORMAT
Return a JSON object with this structure:
{
  "hasErrors": <boolean - true if any errors found>,
  "errorCount": <number - total errors found>,
  "errors": [
    {
      "id": <number - sequential ID starting from 1>,
      "type": "<spelling|grammar|punctuation|expression>",
      "errorText": "<the exact text containing the error - keep this SHORT, just the problematic word/phrase>",
      "correctionTarget": "<the SPECIFIC word or minimal text within errorText that needs to be changed - e.g. if errorText is 'there house' and the error is 'there' should be 'their', correctionTarget is just 'there'>",
      "errorContext": "<a slightly longer snippet showing where the error appears in context>",
      "startIndex": <approximate character position where the error starts>,
      "rule": "<brief, student-friendly explanation of the rule being broken>",
      "hint": "<helpful hint to guide correction WITHOUT giving the answer>",
      "severity": "<minor|moderate|major>"
    }
  ],
  "overallComment": "<brief encouraging comment about the technical quality>"
}

## CRITICAL RULES
1. **NEVER give the correction** - only explain the rule and give hints
2. **Keep errorText SHORT** - just the problematic word or short phrase
3. **correctionTarget must be the MINIMAL word(s)** the student needs to change - often just ONE word. For example, if errorText is "there house was", correctionTarget should be just "there". For a missing comma, correctionTarget is the word before where the comma should go. For spelling errors, correctionTarget is just the misspelled word.
4. **Order errors by position** in the text (first to last)
5. **Be specific** about what's wrong but let the student figure out the fix
6. **Be encouraging** - frame errors as learning opportunities
7. **Don't flag stylistic choices** as errors - only genuine mistakes
8. **Maximum ${isFoundation ? '4' : isHighAchiever ? '8' : '6'} errors** - prioritise the most important ones
9. **errorContext should be 5-15 words** surrounding the error to help locate it

## EXAMPLES OF GOOD HINTS

❌ Bad (gives answer): "Change 'there' to 'their'"
✅ Good: "Think about whether this word shows possession (belonging to them) or location (over there)"

❌ Bad (gives answer): "Add a comma after 'However'"
✅ Good: "When a connecting word like 'However' starts a sentence, what punctuation typically follows it?"

❌ Bad (gives answer): "The word should be 'definitely'"
✅ Good: "This word is commonly misspelled. Try sounding it out: def-in-ite-ly. Which letters might be wrong?"`;

    const userPrompt = `Please check this student paragraph for technical errors:

## Paragraph Title
${paragraphTitle || 'Untitled'}

## Student's Text
${paragraphText}

---

Identify all spelling, grammar, punctuation, and expression errors. Remember to provide hints that guide the student to discover the correction themselves, not give the answer directly.`;

    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2000,
      messages: [{ role: "user", content: userPrompt }],
      system: systemPrompt
    });

    const content = response.content[0].text;

    // Parse JSON response
    let result;
    try {
      result = JSON.parse(content);
    } catch {
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        result = JSON.parse(jsonMatch[1].trim());
      } else {
        const jsonStart = content.indexOf('{');
        const jsonEnd = content.lastIndexOf('}');
        if (jsonStart !== -1 && jsonEnd !== -1) {
          result = JSON.parse(content.slice(jsonStart, jsonEnd + 1));
        } else {
          throw new Error("Could not parse technical check JSON");
        }
      }
    }

    // Ensure errors array exists
    if (!result.errors) {
      result.errors = [];
    }

    // Add category metadata to each error
    result.errors = result.errors.map(error => ({
      ...error,
      category: ERROR_CATEGORIES[error.type] || ERROR_CATEGORIES.grammar
    }));

    console.log('[check-technical] Found errors:', {
      count: result.errorCount,
      types: result.errors.map(e => e.type)
    });

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        success: true,
        hasErrors: result.hasErrors,
        errorCount: result.errorCount || result.errors.length,
        errors: result.errors,
        overallComment: result.overallComment || '',
        strictnessLevel: strictnessLevel
      })
    };

  } catch (error) {
    console.error("Technical check error:", error);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        success: false,
        error: "Failed to check technical errors",
        details: error.message
      })
    };
  }
};

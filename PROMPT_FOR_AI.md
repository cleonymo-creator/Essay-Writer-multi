# Essay Template - AI Configuration Guide

Use this prompt with Claude to generate essay configurations from your actual exam questions and mark schemes.

## How to Use

1. Copy the prompt below
2. Paste your exam question (including any source texts/passages)
3. Paste or describe your mark scheme
4. The AI will generate an `essay.js` file ready to use

---

## THE PROMPT

```
I need you to create a guided essay writing configuration for students. I will provide you with:
1. The actual exam question (which may include source texts, passages, or stimulus material)
2. The mark scheme or assessment criteria

Please analyse these and create a structured essay plan that breaks the response into logical paragraphs, with appropriate learning material and guidance for each section.

## EXAM QUESTION / TASK

[PASTE YOUR EXAM QUESTION HERE - include any source texts, passages, images descriptions, or stimulus material that students would see]

## MARK SCHEME / ASSESSMENT CRITERIA

[PASTE YOUR MARK SCHEME HERE - this could be:
- Level descriptors (e.g., Level 1-4 with descriptions)
- Point-based marking (e.g., 2 marks for X, 3 marks for Y)
- Holistic criteria (e.g., AO1, AO2, AO3 weightings)
- Or just describe what you're looking for]

## ADDITIONAL CONTEXT (optional)

Subject: [e.g., GCSE English Literature, A-Level History, IB Economics]
Year Group: [e.g., Year 11, Grade 10]
Time allowed in exam: [e.g., 45 minutes]
Total marks: [e.g., 30 marks]
Any specific requirements: [e.g., must include specific terminology, must reference both sources, etc.]

---

Based on the above, please generate a complete `essay.js` configuration file that:

1. Breaks the essay into logical paragraphs (introduction, body paragraphs organised by theme/point/source, conclusion)
2. Creates learning material for each paragraph that:
   - Explains what this paragraph should achieve
   - References relevant parts of the source material (if applicable)
   - Suggests key points, quotes, or evidence to include
   - Provides vocabulary and sentence starters where helpful
3. Sets the keyPoints array based on the actual mark scheme criteria
4. Distributes marks appropriately across paragraphs based on the mark scheme

Use this format:

window.ESSAY_CONFIG = {
  title: "[Appropriate title based on the exam]",
  subject: "[Subject]",
  yearGroup: "[Year group]",
  essayTitle: "[The exam question]",
  instructions: "[Clear instructions for students]",
  
  // Original task displayed in sidebar while students write
  // Include the full exam question, source texts, mark scheme summary
  originalTask: `
## Exam Question
[The full exam question as students would see it]

## Source Material
[Any passages, extracts, data, or stimulus material - use blockquotes for extracts]

## Mark Scheme Summary
[Key mark bands or criteria so students know what to aim for]
  `,
  
  maxAttempts: 3,
  minWordsPerParagraph: [appropriate minimum],
  targetWordsPerParagraph: [appropriate target],
  teacherPassword: "teacher123",
  
  paragraphs: [
    {
      id: 1,
      title: "[Paragraph title]",
      type: "introduction|body|conclusion",
      learningMaterial: `[Detailed markdown guidance specific to this paragraph]`,
      writingPrompt: "[Specific instruction for this paragraph]",
      keyPoints: [
        // These should directly reflect the mark scheme criteria
        "[What markers are looking for - from mark scheme]",
        "[Another criterion from mark scheme]"
      ],
      exampleQuotes: ["[Relevant quotes from source if applicable]"],
      points: [marks for this paragraph based on mark scheme]
    },
    // ... more paragraphs
  ],
  
  gradingCriteria: {
    // Adapt these to match the actual mark scheme structure
    // Examples:
    // For AO-based marking:
    ao1: { weight: 40, description: "Knowledge and understanding..." },
    ao2: { weight: 40, description: "Analysis and interpretation..." },
    ao3: { weight: 20, description: "Context..." },
    
    // OR for skills-based marking:
    content: { weight: 30, description: "[From mark scheme]" },
    analysis: { weight: 30, description: "[From mark scheme]" },
    // etc.
  }
};
```

---

## EXAMPLE: Uploading a Real GCSE Question

Here's how you might use the prompt:

```
## EXAM QUESTION / TASK

**Question 5 (40 marks)**

"A magazine has asked for contributions for their special edition on the topic of technology in schools.

You have decided to write an article for this magazine, arguing your point of view on this statement:

'Mobile phones should be banned in all schools.'

Write the article for the magazine."

## MARK SCHEME / ASSESSMENT CRITERIA

**Content and Organisation (24 marks)**
- Level 4 (19-24): Compelling, convincing communication; extensive, ambitious vocabulary; sustained crafting; highly structured
- Level 3 (13-18): Clear, controlled; increasingly sophisticated vocabulary; conscious crafting; well-structured
- Level 2 (7-12): Some attempts to match purpose; some vocabulary; some structural features
- Level 1 (1-6): Simple awareness; simple vocabulary; limited structural features

**Technical Accuracy (16 marks)**
- Level 4 (13-16): Wide range of punctuation; high level of accuracy; extensive vocabulary; secure spelling; varied sentence structures
- Level 3 (9-12): Range of punctuation; accuracy of grammar; varied vocabulary; secure spelling of common words
- Level 2 (5-8): Some punctuation; control of simple sentences; some vocabulary; spelling of simple words
- Level 1 (1-4): Occasional punctuation; limited control; simple vocabulary; phonetic spelling

## ADDITIONAL CONTEXT
Subject: GCSE English Language Paper 2
Year Group: Year 11
Time allowed: 45 minutes
Total marks: 40
```

The AI will then create an essay structure appropriate for this specific question and mark scheme.

---

## Tips for Best Results

1. **Include the full source text** - If students need to reference a passage, poem, or extract, paste the whole thing
2. **Include all mark scheme levels** - The more detail you provide, the better the AI can target feedback
3. **Specify any required structure** - If the exam expects a specific format (e.g., letter, article, speech), mention it
4. **Note timing constraints** - This helps set appropriate word counts
5. **Include examiner reports** - If you have them, notes on common mistakes help the AI guide students

---

## After Generation

1. Review the generated `essay.js` - adjust paragraph count, marks allocation, or guidance as needed
2. Save as `config/essay.js`
3. Test with a student to ensure the guidance makes sense
4. Deploy to Netlify

Remember to set the `ANTHROPIC_API_KEY` environment variable in Netlify for AI grading to work.

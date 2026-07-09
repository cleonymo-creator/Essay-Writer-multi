# Generating Essay Configurations

There are two ways to create essays for the app:

1. **In-app AI generation (recommended).** The teacher dashboard has an essay
   generator that turns an exam question + mark scheme (and optionally an
   uploaded PDF) into a ready essay stored in Firestore. Use this first.
2. **Manual authoring / import.** Generate an essay config with the prompt below
   (or by hand) and paste it into the dashboard's **essay import** dialog. The
   app stores it in the Firestore `essays` collection.

> There is no `config/essay.js` file — essays live in Firestore and are loaded
> via the `manage-essays` function. Do not save generated essays to disk.

## Schema

Essays use the `window.ESSAYS` registration format (the import dialog also
accepts the older single-object `window.ESSAY_CONFIG` shape and adapts it):

```js
window.ESSAYS = window.ESSAYS || {};
window.ESSAYS['unique-essay-id'] = {
  id: "unique-essay-id",
  title: "Short display title",
  subject: "e.g. GCSE English Literature",
  yearGroup: "e.g. Year 11",
  totalMarks: 30,
  essayTitle: "The full exam question as students see it",
  instructions: "Clear instructions for students",

  // Shown in the sidebar while writing: full question, sources, mark-scheme summary
  originalTask: `## Exam Question\n...\n## Mark Scheme Summary\n...`,

  // Optional stimulus material and images (data URIs or URLs)
  sourceMaterial: "Passages / extracts students must reference (markdown)",
  sourceImages: [],

  maxAttempts: 3,
  minWordsPerParagraph: 40,
  targetWordsPerParagraph: 120,

  paragraphs: [
    {
      id: 1,
      title: "Introduction",
      type: "introduction",            // introduction | body | conclusion
      // Tiered guidance drives the differentiation feature:
      learningMaterial: {
        foundation: "Heavily scaffolded guidance (markdown)",
        intermediate: "Standard guidance (markdown)",
        advanced: "Stretch guidance (markdown)"
      },
      writingPrompt: "Specific instruction for this paragraph",
      keyPoints: ["What markers look for — from the mark scheme"],
      exampleQuotes: ["Relevant quotes from the source, if applicable"]
    }
    // ... more paragraphs
  ],

  // Grade bands used for feedback and mark → grade mapping:
  gradeBoundaries: [
    { grade: "9", minMarks: 27, maxMarks: 30, descriptor: "..." },
    { grade: "7", minMarks: 21, maxMarks: 26, descriptor: "..." }
    // ...
  ]
};
```

Notes:
- Use `gradeBoundaries` (array of bands), **not** a `gradingCriteria` object.
- `learningMaterial` should be the tiered `{ foundation, intermediate, advanced }`
  object so differentiated feedback works; a plain string is accepted but loses
  differentiation.
- Do **not** include a `teacherPassword` field — access is handled by teacher
  accounts, not per-essay passwords.

## The prompt

Paste the following into Claude, then add your exam question and mark scheme:

```
Create a guided essay-writing configuration for students. I will provide an exam
question (with any source texts) and a mark scheme. Break the response into
logical paragraphs (introduction, body paragraphs by theme/point/source,
conclusion). For each paragraph, write tiered learning material
(foundation / intermediate / advanced), a specific writing prompt, keyPoints
drawn from the mark scheme, and relevant exampleQuotes. Set gradeBoundaries from
the mark scheme's bands and distribute the marks appropriately.

Output a single `window.ESSAYS['<id>'] = { ... }` object using this schema:
[paste the Schema section above]

## EXAM QUESTION / TASK
[paste the exam question, including any source texts or stimulus material]

## MARK SCHEME / ASSESSMENT CRITERIA
[paste the mark scheme — level descriptors, mark bands, or AO weightings]

## CONTEXT (optional)
Subject / year group / time allowed / total marks / any required format.
```

## After generation

1. Review the generated config (paragraph count, marks, guidance).
2. In the teacher dashboard, open the essay **import** dialog and paste it.
3. Assign the essay to a class and test it as a student.

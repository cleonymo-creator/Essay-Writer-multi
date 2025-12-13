window.ESSAYS = window.ESSAYS || {};
window.ESSAYS['christmas-carol'] = {
  id: 'christmas-carol',
  title: "A Christmas Carol - Character Analysis",
  subject: "English Literature",
  yearGroup: "Year 10/11",
  description: "Analyse how Dickens presents the character of Scrooge and his transformation throughout the novella.",
  icon: "📚",
  essayTitle: "How does Dickens present the character of Scrooge in 'A Christmas Carol'?",
  instructions: "Write a structured essay analysing Scrooge's character. You'll write one paragraph at a time, receiving feedback after each section.",
  originalTask: `## Exam Question

**How does Dickens present the character of Scrooge in 'A Christmas Carol'?**

Write about:
- How Dickens presents Scrooge at different points in the novella
- How Dickens uses language and structure to show Scrooge's character

*(30 marks for content, 4 marks for SPaG)*`,
  maxAttempts: 3,
  minWordsPerParagraph: 80,
  targetWordsPerParagraph: 150,
  paragraphs: [
    {
      id: "intro",
      title: "Introduction",
      type: "introduction",
      learningMaterial: `## Writing an Effective Introduction

Your introduction should:
- **Hook** the reader with an interesting opening
- Provide **context** about the text and character
- Present your **thesis** (main argument)
- **Signpost** what your essay will cover`,
      writingPrompt: "Write an introduction that establishes context about 'A Christmas Carol' and presents your argument about how Dickens presents Scrooge.",
      keyPoints: ["Context about Dickens and Victorian era", "Clear thesis statement", "Brief mention of transformation arc"],
      exampleQuotes: [],
      points: 6
    },
    {
      id: "para1",
      title: "Scrooge at the Beginning",
      type: "body",
      learningMaterial: `## Analysing Scrooge's Initial Presentation

In Stave One, Dickens presents Scrooge as cold, miserly, and isolated.

### Key Quotations:
- **"Hard and sharp as flint"** - semantic field of hardness
- **"Solitary as an oyster"** - simile suggesting isolation
- **"The cold within him froze his old features"** - internal coldness manifests externally`,
      writingPrompt: "Analyse how Dickens presents Scrooge at the beginning of the novella. Use quotations and analyse Dickens' language choices.",
      keyPoints: ["Topic sentence about initial presentation", "Quotations with analysis", "Effect on reader"],
      exampleQuotes: ["Hard and sharp as flint", "Solitary as an oyster", "The cold within him froze his old features"],
      points: 8
    },
    {
      id: "para2",
      title: "Scrooge's Transformation",
      type: "body",
      learningMaterial: `## Analysing Scrooge's Change

Through the visits of the three spirits, Scrooge undergoes a moral transformation.

### Key Quotations:
- **"I will honour Christmas in my heart"** - commitment to change
- **"I am as light as a feather, I am as happy as an angel"** - contrasts with earlier descriptions`,
      writingPrompt: "Analyse how Dickens presents Scrooge's transformation. Show how he changes and what message Dickens conveys.",
      keyPoints: ["Clear contrast with earlier presentation", "Evidence of transformation", "Theme of redemption"],
      exampleQuotes: ["I will honour Christmas in my heart", "I am as light as a feather, I am as happy as an angel"],
      points: 8
    },
    {
      id: "conclusion",
      title: "Conclusion",
      type: "conclusion",
      learningMaterial: `## Writing an Effective Conclusion

Your conclusion should:
- **Summarise** your main argument
- **Synthesise** your key points
- End with a **final thought** about Dickens' purpose`,
      writingPrompt: "Write a conclusion that summarises your argument and reflects on Dickens' purpose in presenting Scrooge's transformation.",
      keyPoints: ["Summary of main argument", "Dickens' social message", "Memorable final thought"],
      exampleQuotes: [],
      points: 6
    }
  ],
  gradingCriteria: {
    content: { weight: 30, description: "Understanding of character and themes, use of evidence" },
    analysis: { weight: 30, description: "Analysis of language, structure, and Dickens' methods" },
    structure: { weight: 20, description: "Clear topic sentences, logical flow, effective paragraphing" },
    expression: { weight: 20, description: "Academic vocabulary, spelling, grammar, punctuation" }
  }
};

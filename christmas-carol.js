window.ESSAYS = window.ESSAYS || {};
window.ESSAYS['christmas-carol'] = {
  id: 'christmas-carol',
  title: "A Christmas Carol - Character Analysis",
  subject: "English Literature",
  yearGroup: "Year 10/11",
  description: "Analyse how Dickens presents the character of Scrooge and his transformation throughout the novella.",
  icon: "ðŸ“š",
  essayTitle: "How does Dickens present the character of Scrooge in 'A Christmas Carol'?",
  instructions: "Write a structured essay analysing Scrooge's character. You'll write one paragraph at a time, receiving feedback after each section.",
  originalTask: `## Exam Question

**How does Dickens present the character of Scrooge in 'A Christmas Carol'?**

Write about:
- How Dickens presents Scrooge at different points in the novella
- How Dickens uses language and structure to show Scrooge's character

*(30 marks for content, 4 marks for SPaG)*`,,
  sourceMaterial: `## Key Context: Victorian England & Social Reform

Charles Dickens wrote *A Christmas Carol* in 1843 during a period of significant social change in Victorian England. The novella was written partly as a response to the harsh treatment of the poor and the widespread indifference of the wealthy.

### Social Context:
- **The Poor Law of 1834**: Established workhouses where the poor were forced to work in terrible conditions
- **Child Labour**: Children as young as 5 worked in factories and mines
- **Social Inequality**: Vast gap between rich and poor, with little social mobility
- **Christmas Revival**: Dickens helped revive Christmas traditions and the spirit of charity

### Dickens' Purpose:
Dickens aimed to:
1. Highlight the suffering of the poor
2. Critique the selfishness and greed of the wealthy
3. Promote the values of compassion, generosity, and social responsibility
4. Show that personal transformation is possible

This context is crucial for understanding Scrooge as a character who embodies Victorian greed and indifference, and whose transformation represents Dickens' hope for social change.`
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
      exampleQuotes: []
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
      sourceMaterial: `## Extract from Stave One

> "Oh! But he was a tight-fisted hand at the grindstone, Scrooge! a squeezing, wrenching, grasping, scraping, clutching, covetous, old sinner! Hard and sharp as flint, from which no steel had ever struck out generous fire; secret, and self-contained, and solitary as an oyster. The cold within him froze his old features, nipped his pointed nose, shrivelled his cheek, stiffened his gait; made his eyes red, his thin lips blue; and spoke out shrewdly in his grating voice."

### Analysis Points:
- **Repetitive verbs**: "squeezing, wrenching, grasping..." creates a cumulative effect showing obsessive greed
- **Simile "hard and sharp as flint"**: Suggests Scrooge cannot produce warmth or kindness (no "generous fire")
- **"Solitary as an oyster"**: Implies self-imposed isolation, shut away from others
- **Physical description**: Cold personality manifests in his appearance - shows how inner character shapes outer being`,
      keyPoints: ["Topic sentence about initial presentation", "Quotations with analysis", "Effect on reader"],
      exampleQuotes: ["Hard and sharp as flint", "Solitary as an oyster", "The cold within him froze his old features"]
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
      exampleQuotes: ["I will honour Christmas in my heart", "I am as light as a feather, I am as happy as an angel"]
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
      exampleQuotes: []
    }
  ],
  gradingCriteria: {
    content: { weight: 30, description: "Understanding of character and themes, use of evidence" },
    analysis: { weight: 30, description: "Analysis of language, structure, and Dickens' methods" },
    structure: { weight: 20, description: "Clear topic sentences, logical flow, effective paragraphing" },
    expression: { weight: 20, description: "Academic vocabulary, spelling, grammar, punctuation" }
  }
};

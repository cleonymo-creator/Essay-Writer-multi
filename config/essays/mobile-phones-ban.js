// ============================================
// ESSAY CONFIGURATION: Mobile Phones in Schools
// ============================================

window.ESSAYS = window.ESSAYS || {};
window.ESSAYS['mobile-phones-ban'] = {
  id: 'mobile-phones-ban',
  
  title: "Mobile Phones in Schools - Argumentative Writing",
  subject: "English Language",
  yearGroup: "Year 11",
  
  essayTitle: "Should mobile phones be banned in all schools?",
  
  instructions: "Write an article for a magazine arguing your point of view on whether mobile phones should be banned in schools. You should present a clear argument with evidence and consider counterarguments.",
  
  originalTask: `
## Exam Question

**A magazine has asked for contributions for their special edition on technology in schools.**

You have decided to write an article arguing your point of view on this statement:

**'Mobile phones should be banned in all schools.'**

Write the article for the magazine.

**(40 marks)**
- Content and Organisation: 24 marks
- Technical Accuracy: 16 marks

---

## Mark Scheme Summary

### Content and Organisation (24 marks)

**Level 4 (19-24):** Compelling, convincing communication; extensive and ambitious vocabulary; sustained crafting of linguistic devices; highly structured and developed writing

**Level 3 (13-18):** Clear, controlled communication; increasingly sophisticated vocabulary; conscious crafting; clear structure with connected ideas

**Level 2 (7-12):** Attempts to match purpose; some appropriate vocabulary; some structural features; some linked ideas

**Level 1 (1-6):** Simple awareness of purpose; simple vocabulary; limited structural features

### Technical Accuracy (16 marks)

**Level 4 (13-16):** Wide range of punctuation used accurately; high level of accuracy in spelling and grammar; extensive and varied vocabulary

**Level 3 (9-12):** Range of punctuation; mostly accurate spelling; varied vocabulary

**Level 2 (5-8):** Some punctuation; some accurate spelling of common words

**Level 1 (1-4):** Occasional punctuation; limited vocabulary
  `,
  
  maxAttempts: 3,
  minWordsPerParagraph: 60,
  targetWordsPerParagraph: 100,
  teacherPassword: "teacher123",
  
  paragraphs: [
    {
      id: 1,
      title: "Engaging Opening",
      type: "introduction",
      learningMaterial: `
## Crafting Your Opening

Your opening needs to **grab the reader's attention** immediately. This is an article for a magazine, so think about what would make someone want to keep reading.

### Techniques to Consider

- **Rhetorical question**: "Have you ever wondered what life was like before smartphones controlled our every waking moment?"
- **Surprising statistic**: "The average teenager checks their phone 150 times per day..."
- **Bold statement**: "Mobile phones are destroying education as we know it." OR "Banning mobile phones would set education back decades."
- **Anecdote**: A brief story that illustrates the issue

### Your Position

Decide NOW whether you are **for** or **against** the ban. Your entire article must consistently argue this position.

### Structure of Introduction

1. Hook (attention-grabbing opening)
2. Context (briefly introduce the debate)
3. Thesis (your clear position)
      `,
      writingPrompt: "Write an engaging opening paragraph that hooks the reader and clearly states your position on whether mobile phones should be banned in schools.",
      keyPoints: [
        "Opens with an attention-grabbing hook",
        "Establishes the context of the debate",
        "Clearly states their position (for or against the ban)",
        "Uses appropriate tone for magazine article",
        "Engages the reader to continue"
      ],
      exampleQuotes: [],
      points: 8
    },
    {
      id: 2,
      title: "First Main Argument",
      type: "body",
      learningMaterial: `
## Your Strongest Argument

This paragraph should present your **most compelling reason** for your position.

### If arguing FOR the ban:
- Distraction from learning
- Cyberbullying during school hours
- Mental health impacts
- Inequality (not all students have expensive phones)
- Exam cheating concerns

### If arguing AGAINST the ban:
- Educational apps and resources
- Safety (contacting parents)
- Digital literacy preparation
- Research tool
- Accommodation for learning differences

### Paragraph Structure (PEEL)

- **Point**: State your argument clearly
- **Evidence**: Facts, statistics, examples
- **Explain**: Why this matters
- **Link**: Connect back to your main argument
      `,
      writingPrompt: "Present your first and strongest argument. Use evidence and explain why this point supports your position.",
      keyPoints: [
        "Clear topic sentence stating the argument",
        "Includes specific evidence or examples",
        "Explains the significance of the point",
        "Maintains consistent position",
        "Uses persuasive language"
      ],
      exampleQuotes: [],
      points: 8
    },
    {
      id: 3,
      title: "Second Main Argument",
      type: "body",
      learningMaterial: `
## Building Your Case

Now add a **second strong argument** that supports your position from a different angle.

### Persuasive Techniques to Include

- **Emotive language**: Words that create an emotional response
- **Triplets/Rule of three**: "Phones distract, disturb, and damage learning"
- **Direct address**: "You might think..." or "Consider this..."
- **Expert opinion**: "Teachers across the country report that..."

### Varying Your Evidence

If your first argument used statistics, try using:
- An anecdote or example
- Expert testimony
- Logical reasoning
- Comparison to other situations
      `,
      writingPrompt: "Present your second argument with different evidence. Use at least one persuasive technique.",
      keyPoints: [
        "Introduces a new, distinct argument",
        "Uses different type of evidence from paragraph 2",
        "Employs persuasive techniques",
        "Maintains article tone and style",
        "Builds on the overall argument"
      ],
      exampleQuotes: [],
      points: 8
    },
    {
      id: 4,
      title: "Counterargument",
      type: "body",
      learningMaterial: `
## Addressing the Opposition

A strong argument **acknowledges and refutes** opposing viewpoints. This shows you've considered both sides and strengthens your credibility.

### Structure

1. **Acknowledge**: "Some argue that..." / "Critics claim..."
2. **Counter**: "However..." / "Yet this overlooks..."
3. **Reinforce**: Return to your position stronger

### Common Counterarguments

**If you're FOR the ban**, address:
- "But phones are educational tools"
- "Students need them for safety"

**If you're AGAINST the ban**, address:
- "But phones are distracting"
- "But they enable cyberbullying"

### Tone

Be respectful of opposing views while firmly dismissing them. Don't be aggressive or dismissive.
      `,
      writingPrompt: "Acknowledge a counterargument and then refute it, explaining why your position is still correct.",
      keyPoints: [
        "Fairly presents an opposing viewpoint",
        "Effectively counters the argument",
        "Uses appropriate language (however, yet, nevertheless)",
        "Returns to reinforce main position",
        "Maintains respectful but firm tone"
      ],
      exampleQuotes: [],
      points: 8
    },
    {
      id: 5,
      title: "Powerful Conclusion",
      type: "conclusion",
      learningMaterial: `
## Ending with Impact

Your conclusion should leave the reader convinced and inspired to agree with you.

### What to Include

- **Summarise** your key arguments (briefly - don't just repeat)
- **Reinforce** your position
- **Call to action** or thought-provoking ending

### Techniques for Memorable Endings

- **Circular structure**: Return to your opening hook
- **Call to action**: "It's time for schools to..."
- **Rhetorical question**: "Can we really afford to ignore this issue?"
- **Powerful statement**: End with your strongest, most quotable line

### What to Avoid

- Introducing new arguments
- Weakening your position ("but I could be wrong")
- Simply repeating the introduction
- Ending abruptly
      `,
      writingPrompt: "Write a powerful conclusion that summarises your argument and leaves a lasting impression on the reader.",
      keyPoints: [
        "Summarises main arguments without repetition",
        "Reinforces the central position",
        "Includes call to action or thought-provoking ending",
        "Uses memorable/quotable final line",
        "Appropriate length - concise but complete"
      ],
      exampleQuotes: [],
      points: 8
    }
  ],
  
  gradingCriteria: {
    content: {
      weight: 30,
      description: "Clear argument, relevant evidence, addresses counterarguments"
    },
    organisation: {
      weight: 30,
      description: "Logical structure, clear paragraphs, cohesive flow"
    },
    language: {
      weight: 20,
      description: "Persuasive techniques, varied vocabulary, appropriate tone"
    },
    accuracy: {
      weight: 20,
      description: "Spelling, punctuation, grammar, sentence variety"
    }
  }
};

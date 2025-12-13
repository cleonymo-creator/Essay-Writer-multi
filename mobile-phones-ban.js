window.ESSAYS = window.ESSAYS || {};
window.ESSAYS['mobile-phones-ban'] = {
  id: 'mobile-phones-ban',
  title: "Mobile Phones in Schools",
  subject: "English Language",
  yearGroup: "Year 10/11",
  description: "Write an argumentative essay discussing whether mobile phones should be banned in schools.",
  icon: "📱",
  essayTitle: "Should mobile phones be banned in schools?",
  instructions: "Write a persuasive argumentative essay. Present arguments for and against, then reach a clear conclusion.",
  originalTask: `## Writing Task

**"Mobile phones should be completely banned in all schools."**

Write an article for your school newspaper in which you argue **for or against** this statement.

*(40 marks)*`,
  maxAttempts: 3,
  minWordsPerParagraph: 80,
  targetWordsPerParagraph: 150,
  paragraphs: [
    {
      id: "intro",
      title: "Introduction",
      type: "introduction",
      learningMaterial: `## Writing an Argumentative Introduction

Your introduction should:
- **Hook** the reader - a striking fact, question, or statement
- Establish the **debate** - what are the two sides?
- Present your **position** - what do you think?`,
      writingPrompt: "Write an engaging introduction that presents the mobile phone debate and establishes your position.",
      keyPoints: ["Engaging hook", "Context about the debate", "Clear thesis/position"],
      exampleQuotes: [],
      points: 8
    },
    {
      id: "para1",
      title: "Arguments For a Ban",
      type: "body",
      learningMaterial: `## Arguments Supporting a Ban

Consider these points:
- **Distraction** - phones disrupt learning
- **Cyberbullying** - can happen during school
- **Inequality** - not all students can afford expensive phones
- **Mental health** - social media anxiety`,
      writingPrompt: "Present and explain the strongest arguments in favour of banning mobile phones in schools.",
      keyPoints: ["Clear topic sentence", "Multiple arguments with evidence", "Persuasive language"],
      exampleQuotes: [],
      points: 10
    },
    {
      id: "para2",
      title: "Arguments Against a Ban",
      type: "body",
      learningMaterial: `## Arguments Against a Ban

Consider these counterarguments:
- **Safety** - parents need to contact children
- **Educational tools** - apps, research, calculators
- **Digital literacy** - students need tech skills
- **Responsibility** - teach self-control instead`,
      writingPrompt: "Present the arguments against a ban, then explain why these don't outweigh the arguments for (or vice versa).",
      keyPoints: ["Fair presentation of counterarguments", "Refutation or acknowledgment", "Balanced reasoning"],
      exampleQuotes: [],
      points: 10
    },
    {
      id: "conclusion",
      title: "Conclusion",
      type: "conclusion",
      learningMaterial: `## Writing a Persuasive Conclusion

Your conclusion should:
- **Restate** your position clearly
- **Summarise** your strongest arguments
- End with a **call to action** or memorable statement`,
      writingPrompt: "Write a powerful conclusion that reinforces your argument and leaves a lasting impression.",
      keyPoints: ["Clear restatement of position", "Summary of key points", "Memorable final sentence"],
      exampleQuotes: [],
      points: 12
    }
  ],
  gradingCriteria: {
    content: { weight: 30, description: "Quality of arguments, use of evidence and examples" },
    analysis: { weight: 25, description: "Depth of reasoning, consideration of counterarguments" },
    structure: { weight: 25, description: "Clear organisation, effective use of discourse markers" },
    expression: { weight: 20, description: "Persuasive techniques, vocabulary, accuracy" }
  }
};

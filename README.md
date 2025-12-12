# Guided Essay Writing Template

An interactive essay writing assistant that guides students through composing structured essays paragraph by paragraph, with AI feedback at each stage.

## Features

- **Paragraph-by-paragraph guidance** - Learning material and writing prompts for each section
- **Multiple revision attempts** - Students get 2-3 chances to improve each paragraph
- **AI-powered feedback** - Detailed, criteria-based feedback after each submission
- **Progress tracking** - Visual tracker showing completion status
- **Essay compilation** - Final essay assembled with holistic feedback
- **Print-ready output** - Print essay and feedback together
- **Teacher dashboard** - View all submitted essays and scores

## How It Works

1. **Student enters name** and begins the essay
2. **For each paragraph:**
   - Read the learning material (context, quotes, techniques)
   - Write the paragraph based on the prompt
   - Submit for AI feedback
   - Revise if needed (up to 3 attempts)
   - Accept and continue to next section
3. **After all paragraphs:**
   - View compiled essay
   - Request holistic feedback
   - Print essay with feedback

## Setup

### 1. Configure Your Essay

Edit `config/essay.js` to define your essay structure. See `PROMPT_FOR_AI.md` for a prompt to generate this automatically.

### 2. Deploy to Netlify

1. Push to GitHub
2. Connect to Netlify
3. Set environment variable: `ANTHROPIC_API_KEY`
4. Deploy

### 3. Share with Students

Share your Netlify URL with students.

## File Structure

```
essay-template/
├── index.html              # Main application
├── config/
│   ├── essay.js            # Essay configuration (edit this!)
│   └── theme.js            # Visual theme settings
├── netlify/functions/      # Serverless functions
├── PROMPT_FOR_AI.md        # Guide for generating essays
└── README.md
```

## Teacher Dashboard

Access via "Teacher Login" on the entry screen.
Default password: `teacher123` (change in `essay.js`)

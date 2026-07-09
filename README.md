# Guided Essay Writing Platform

An interactive web app that guides students through writing essays paragraph by
paragraph, with AI feedback (Claude) at each stage. Teachers manage classes,
students, and essays from a dashboard, and review submissions and progress.

## Features

- **Paragraph-by-paragraph writing** with per-section learning material and prompts
- **AI feedback** on each paragraph, with multiple revision attempts
- **Technical-error correction** step (spelling / grammar / punctuation)
- **Compiled essay** with holistic feedback and a printable report
- **Differentiated guidance** (foundation / intermediate / advanced tiers) and
  target-grade–aware feedback
- **Teacher/admin dashboard**: classes, students, essays, submissions, and
  in-progress tracking
- **AI essay generation** from an exam question + mark scheme (optionally a PDF)
- **Accounts & auth**: teacher and student accounts with sessions and password
  reset (Firebase Auth), not a shared password

## Architecture

- **Frontend:** a single `index.html` — React 18 (via CDN) with in-browser Babel.
  (A build step + module split is planned; see `IMPROVEMENT_PLAN.md` Phase 3.)
- **Backend:** Netlify Functions in `netlify/functions/` (Node). Shared helpers
  live in `netlify/functions/_lib/`.
- **Data:** Firestore (via the Firebase Admin SDK, server-side). Collections:
  `teachers`, `teacherSessions`, `students`, `sessions`, `classes`, `essays`,
  `submissions`, `progress`, `rateLimits`.
- **AI:** Anthropic Claude (Sonnet for grading/generation, Haiku for lighter
  tasks like hint expansion and technical checks).
- **Security rules:** `firestore.rules` (see `FIREBASE_SETUP.md`), auto-deployed
  by `.github/workflows/deploy-firestore-rules.yml`.

## Setup

### 1. Configure environment variables

Copy `.env.example` and set the values in your Netlify site
(Site settings → Environment variables). At minimum you need:

- `ANTHROPIC_API_KEY`
- Firebase Admin SDK: `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`,
  `FIREBASE_PRIVATE_KEY`
- Firebase web config: `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`,
  `FIREBASE_STORAGE_BUCKET`, `FIREBASE_MESSAGING_SENDER_ID`, `FIREBASE_APP_ID`

See `FIREBASE_SETUP.md` for the full Firebase setup and security rules.

### 2. Deploy to Netlify

Push to GitHub and connect the repo to Netlify. No build command is required
(the site is static; functions are bundled by Netlify). `netlify.toml` holds the
function and header configuration.

### 3. Create the first teacher/admin account

Teacher and student accounts live in Firestore, not in a config file. Create the
first admin account through the app's teacher sign-up / management flow (see
`TEACHER_PASSWORD.md`), then use the dashboard to add classes, students, and
essays.

## Creating essays

Two ways:

1. **In-app AI generation** — the teacher dashboard's essay generator builds an
   essay from an exam question and mark scheme (and can extract a PDF).
2. **Manual authoring / import** — paste a `window.ESSAYS['id'] = { ... }` config
   into the essay-import dialog. See `PROMPT_FOR_AI.md` for the schema and a
   prompt that generates one.

Essays are stored in the Firestore `essays` collection and loaded by the app via
the `manage-essays` function.

## Local development

`netlify dev` runs the site and functions locally using the environment
variables above. There is no separate build step yet.

## Project layout

```
index.html                     # entire frontend (React via CDN)
netlify/functions/             # serverless backend
  _lib/                        # shared helpers (session, rate-limit, cors)
firestore.rules                # Firestore security rules (deployed via CI)
firebase.json / .firebaserc    # Firebase CLI config for rules deploy
.github/workflows/             # CI (Firestore rules auto-deploy)
IMPROVEMENT_PLAN.md            # roadmap: security, refactor, UX, hygiene
```

See `IMPROVEMENT_PLAN.md` for the current roadmap and known issues.

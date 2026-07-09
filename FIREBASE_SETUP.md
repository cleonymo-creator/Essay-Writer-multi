# Firebase Setup Guide

This app uses **Firestore** as its datastore and **Firebase Authentication** for
teacher/student passwords and reset emails. All privileged access happens
server-side in the Netlify functions via the **Firebase Admin SDK**; the browser
only talks to Firestore for a limited set of authenticated reads/writes.

> Do NOT use "test mode" / `allow read, write: if true` rules in production.
> This repo ships a proper `firestore.rules` file (see step 4).

## 1. Create a Firebase project

1. [Firebase Console](https://console.firebase.google.com/) → **Add project**.
2. Name it (e.g. `student-essay-assistant`), analytics optional.

## 2. Enable Firestore and Authentication

1. **Build → Firestore Database → Create database.** Choose a location near your
   users (e.g. `europe-west2` for the UK). Start in production mode — the rules
   from this repo will be deployed to it.
2. **Build → Authentication → Get started → Email/Password** (used for password
   reset and account credentials).
3. **Authentication → Settings → Authorized domains**: add your Netlify domain.

## 3. Credentials — two separate sets

The functions need **both** a server-side service account and the public web
config. Set all of these as environment variables in Netlify
(Site settings → Environment variables). See `.env.example` for the full list.

**Service account (server-side, secret):**
Project settings → Service accounts → *Generate new private key*. From the JSON:

- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY` (keep the literal `\n` escapes; the code un-escapes them)

**Web config (served to the browser by the `firebase-config` function):**
Project settings → Your apps → Web app. These are public-by-design identifiers:

- `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_STORAGE_BUCKET`,
  `FIREBASE_MESSAGING_SENDER_ID`, `FIREBASE_APP_ID`
  (each also accepts an `ENV_`-prefixed fallback name)

The browser fetches this config from `/.netlify/functions/firebase-config` at
runtime — there is no `config/firebase-config.js` file (that legacy file was
removed).

## 4. Security rules

The rules live in **`firestore.rules`** in this repo (version-controlled) and
deploy automatically via `.github/workflows/deploy-firestore-rules.yml` whenever
they change on `main`. To deploy manually:

```
firebase deploy --only firestore:rules
```

The current (interim) rules require an authenticated Firebase session for the
collections the browser reads directly (`students`, `classes`, `essays`,
`submissions`, `progress`) and fully deny client access to server-only
collections (`sessions`, `teacherSessions`, `teachers`, `rateLimits`). See the
comments in `firestore.rules` for the residual risks and the Phase 3 end state
(per-document ownership rules).

For the CI deploy, add the service-account JSON as a GitHub Actions secret named
`FIREBASE_SERVICE_ACCOUNT` (see the workflow file header).

## 5. Deploy and test

1. Deploy to Netlify with the env vars set.
2. Create the first teacher/admin account (see `TEACHER_PASSWORD.md`).
3. Log in to the teacher dashboard; add a class, a student, and an essay.
4. As a student, start an essay — they should appear under in-progress tracking.

## Data model (Firestore collections)

- `teachers` — teacher/admin accounts (email doc id, PBKDF2 `passwordHash`, role)
- `teacherSessions` / `sessions` — teacher / student session tokens (server-only)
- `students` — student accounts and class membership (`classIds[]`, etc.)
- `classes` — class rosters and assigned essays
- `essays` — essay configs (served via the `manage-essays` function)
- `submissions` — completed essays with scores and feedback
- `progress` — in-progress essays (for resume + the in-progress dashboard)
- `rateLimits` — internal per-identity counters for AI endpoints (server-only)

## Notes

- **Costs:** Firestore's free tier (roughly 50k reads / 20k writes per day) is
  ample for typical class sizes.
- **Legacy Netlify Blobs fallback:** some functions still contain a Blobs
  fallback path from an earlier storage generation. Firestore is the source of
  truth; collapsing the dual backend is a Phase 2 task in `IMPROVEMENT_PLAN.md`.

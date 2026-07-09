# Tests

## Smoke test (`smoke.mjs`)

A headless-browser boot check for `index.html`. It serves the real page, loads
it in headless Chromium (Playwright), and asserts the app **boots without
uncaught/console errors and renders an interactive screen** (the login form).
This catches the "white screen" class of failure — syntax errors, bad
references, broken JSX — which is the main risk when refactoring the large
single-file frontend (see `IMPROVEMENT_PLAN.md`, Phase 3).

### Run

```bash
npm install          # first time (installs playwright-core + vendored libs)
npm run test:smoke   # or: npm test
```

Expected output on success:

```
SMOKE PASS — app booted and rendered 6 controls (text: "Essay Writing Assistant...")
```

### How it stays hermetic

- The app's CDN `<script>` tags (React, ReactDOM, Babel, marked, DOMPurify,
  Firebase compat, pdf.js) are mapped to npm-installed copies of the same
  libraries via Playwright request interception — no CDN access needed.
- The two functions the app calls on boot (`firebase-config`, `manage-essays`)
  are stubbed by a tiny local server. Firebase is left disabled (the stub omits
  the API key), so no real backend is contacted. This is a **boot** smoke test,
  not an end-to-end test of the authenticated flows.

### CI

```bash
npm ci
npx playwright install chromium   # provides the headless_shell build
npm run test:smoke
```

The runner auto-detects the Chromium under `PLAYWRIGHT_BROWSERS_PATH`
(preferring the `headless_shell` build, since the full Chromium binary has
removed the legacy headless mode). Override with `SMOKE_CHROME=/path/to/binary`.

### Extending

As the frontend is split into modules (Phase 3), keep this green after every
step. Add deeper assertions (navigate to the teacher login, fill the form, etc.)
as needed — the harness already captures console/page errors, so most
regressions show up without extra assertions.

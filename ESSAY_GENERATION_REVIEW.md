# "Generate New Essay" — Deep Review & Improvement Plan

A complete review of the essay-generation feature: the `EssayGeneratorPanel` wizard
(`src/main.jsx:10098-12293`) and its backend (`generate-essay-start.js`,
`generate-essay-background.js`, `generate-essay-check.js`, `extract-pdf-content.js`).

Line references are to the current state of `src/main.jsx` and `netlify/functions/*`.

---

## 1. How it works today (baseline)

The teacher walks a 6-step wizard: **Details → Question → Mark Scheme → Generate →
Review & Edit → Save**.

1. **Details** (`main.jsx:11658`): subject (hard-coded dropdown of 5 English options),
   free-text year group, exam board (AQA/Edexcel/Eduqas), exam series, total marks, time.
   If subject + board match the hard-coded `examPaperData` catalogue
   (`main.jsx:10142-10784`, ~640 lines), a paper/question picker appears and an
   "Apply Selection" button back-fills paper name, marks, and proportional time.
2. **Question** (`main.jsx:11819`): upload question-paper PDFs/images. PDFs are
   text-scraped client-side with pdf.js (`index.html:33-44`), then
   `extract-pdf-content` has Claude pull out the question, source material, marks and
   series, which auto-fill empty fields.
3. **Mark Scheme** (`main.jsx:11930`): paste text or upload one PDF/image; free-text
   AI notes.
4. **Generate** (`main.jsx:11966`): `generate-essay-start` creates a job in Netlify
   Blobs; `generate-essay-background` calls Claude Sonnet, which returns a
   **JavaScript** `window.ESSAYS[...] = {...}` config; the client polls every 3s for
   up to 6 minutes. The pending jobId is persisted to localStorage so a refresh
   resumes polling.
5. **Review & Edit** (`main.jsx:12057`): a structured editor over the parsed essay
   (title, source material, paragraphs, per-tier learning material, key points).
6. **Save** (`main.jsx:12240`): POST to `manage-essays` (Firestore), with a
   409/overwrite path and a JSON download.

This is already a solid pipeline — the durable-job pattern, the resume-on-refresh,
the structured review editor, and the three-strategy config parser show real defensive
work. The problems below are about (a) how much manual hunting/typing the teacher
still does, (b) how much of their input evaporates, and (c) fragility that the
defensive code papers over rather than removes.

---

## 2. Theme A — Make past papers and mark schemes first-class citizens

Today the app *assumes* the teacher has already found, downloaded and saved the right
question paper and mark scheme PDFs before opening the wizard. That's the single
biggest friction point: the hunting happens outside the app, every time, for every
teacher, even for the same paper.

### A1. Build a past-paper picker on top of the existing catalogue

`examPaperData` already knows every paper, section, question, mark count and duration
for 4 qualifications × 3 boards. Extend each question entry with **links to the
board's official past-paper page** (AQA, Pearson/Edexcel and Eduqas all publish past
papers + mark schemes openly on fixed URLs once the exam-lock period ends, typically
after ~1 year for locked papers and immediately for older series):

```js
{ id: 'q5', name: 'Question 5', marks: 40,
  resources: [
    { series: 'June 2023', paper: 'https://.../june-2023-qp.pdf',
      insert: 'https://.../june-2023-insert.pdf',
      markScheme: 'https://.../june-2023-ms.pdf' }
  ] }
```

In Step 1, after the teacher picks paper + question, show a **series picker**
("June 2023, November 2022, …") with *Open question paper / Open mark scheme*
buttons. Even as pure link-outs this removes the Google-hunting step. Copyright
note: linking out to the boards' own hosted PDFs is safe; re-hosting board PDFs
inside the app is what the boards' terms restrict, so link-first is the right
default.

### A2. Fetch-by-URL: paste a link instead of download-then-upload

The upload flow forces: find PDF → download → find in Downloads → upload. Add a
"Paste a link to the paper" input next to the dropzone: a small serverless function
fetches the PDF server-side and pipes it into the same extraction path. Combined
with A1's catalogue links, "pick paper → pick series → auto-fetch QP + MS + insert"
collapses steps 2 and 3 into two clicks.

### A3. A reusable paper/mark-scheme library (upload once, ever)

Everything the teacher uploads today is **thrown away** after generation: the
extracted text lives only in component state and the job blob; the mark scheme
isn't even stored on the saved essay. If two teachers (or the same teacher next
term) use AQA June 2023 Paper 1, they re-upload and re-extract from scratch —
paying the Claude extraction cost again too.

Add a `paperResources` Firestore collection keyed by
`board/subject/paper/series`: `{ examQuestion, sourceMaterial, markSchemeText,
totalMarks, extractedAt, uploadedBy }`. On upload, offer "Save to library"; in
Step 2, offer "Choose from library" listing previously extracted papers. This makes
the app *accumulate* value: the tenth essay generated from a paper costs nothing to
set up.

### A4. Use Claude's native PDF support instead of pdf.js text scraping

`extractPdfText` (`index.html:33`) concatenates pdf.js text items with spaces. This:

- **Fails silently on scanned papers** (very common for older series): pdf.js
  returns empty text, `autoExtractFromPdf` is skipped (guarded at `main.jsx:10957`),
  and the teacher gets no explanation — the dropzone just doesn't do anything.
- **Destroys layout** (columns, tables, source/question boundaries), which the
  extraction prompt then has to guess back.

The Claude API accepts PDFs natively as `document` content blocks (Sonnet reads
them page-by-page with vision). Send the base64 PDF to `extract-pdf-content`
instead of client-scraped text: scanned papers start working, layout survives, and
the pdf.js CDN dependency can go. Keep pdf.js only as an offline fallback if
desired. At minimum, detect the empty-text case and tell the teacher "this looks
like a scanned PDF" instead of failing silently.

### A5. Extract the mark scheme too — and light up the dead grade-boundaries feature

Two asymmetries in Step 3:

- The question paper gets AI extraction; the mark scheme is passed through raw.
  Mark schemes are the most structured documents boards publish (AO breakdowns,
  level descriptors, indicative content). Run them through an extraction pass into
  `{ assessmentObjectives, levels: [{level, marks, descriptor}], indicativeContent }`
  and show the teacher the structured result to confirm.
- **`gradeBoundaries` is a dead feature end-to-end**: the generation prompt
  supports teacher-provided boundaries (`generate-essay-background.js:160-182`) and
  the *student grading flow already consumes them* (`main.jsx:6401,6546` passes
  "authentic grade descriptors" to grading when present) — but the wizard has no
  boundaries UI and `handleGenerate`'s payload (`main.jsx:11148-11154`) never sends
  them, so generated essays always fall back to generic `gradingCriteria`. Boards
  publish grade boundaries per series as simple tables; add a small
  boundaries editor in Step 3 (or auto-extract from an uploaded boundaries
  PDF/level descriptors) and students immediately get authentic-descriptor grading.

### A6. Persist paper metadata onto the saved essay

The generated config template (`generate-essay-background.js:224-273`) keeps
`subject` and `yearGroup` but **drops examBoard, examSeries, paperName and the mark
scheme text**. Consequences: the essay list can't be filtered by board/series,
"regenerate/adapt this essay" is impossible later, and the grading functions can't
see the actual mark scheme. Store all wizard inputs on the essay document
(`examBoard`, `examSeries`, `paperName`, `markScheme`, `selectedQuestions`) — cheap
now, enabling for everything above.

---

## 3. Theme B — Persistence of selections (text, board, level)

### B1. The wizard forgets everything on a tab switch (the core complaint)

`EssayGeneratorPanel` is conditionally rendered
(`main.jsx:9862`: `{activeView === 'generate' && <EssayGeneratorPanel/>}`), so
clicking "Manage Essays" mid-wizard — e.g. to check an existing essay's wording —
**unmounts the component and destroys every field**: subject, board, pasted
question, extracted source material, uploaded files, mark scheme. Only a pending
generation jobId survives (via `PENDING_JOB_KEY`). A teacher who has spent ten
minutes assembling a paper loses it all to one misclick.

Fixes, in increasing order of effort:

1. **Keep it mounted**: render both panels and toggle `display:none`
   (`<div style={{display: activeView === 'generate' ? 'block' : 'none'}}>`). One-line
   class of fix, immediately solves tab-switch loss.
2. **Draft autosave**: the codebase already has the pattern twice
   (`PENDING_JOB_KEY`, `main.jsx:11032`; pending-submission queue, `main.jsx:1257`).
   Serialize the form state (minus large base64 file payloads) to
   `essayGenDraft:<teacherEmail>` on change (debounced), restore on mount, clear on
   save. Survives refresh, session expiry re-login, and browser crashes — which
   matter, because teacher sessions do expire mid-task.
3. **Lift the state** into the dashboard parent or a context, which 1) makes
   explicit and is where a future module split (IMPROVEMENT_PLAN Phase 3) wants it
   anyway.

### B2. Remember the teacher's defaults across sessions

A teacher's subject, board, and level barely change between essays — an English
teacher at an AQA school will pick "GCSE English Language / AQA" every single time,
yet starts from blank dropdowns on every visit. Two layers:

- **Last-used defaults** (cheap): on successful save, write
  `essayGenDefaults:<email>` = `{subject, examBoard, yearGroup, minWords,
  targetWords, maxAttempts}` to localStorage; prefill Step 1 from it. The student
  side already does exactly this for target grades (`main.jsx:5555-5558`).
- **Teacher profile** (better): store the same on the teacher's Firestore document
  (settable in the dashboard, "My defaults"), so it follows them across devices and
  new teachers can be provisioned with school-wide defaults (board, standard word
  counts). The `teachers` collection and management UI already exist.

Also **don't reset the form after save** (`main.jsx:11507-11515` wipes all 15
fields). Teachers typically generate several essays in a row from the *same* paper
(Q2, Q4, Q5…). Keep Step-1 details and ask "Generate another from this paper?"
instead of dumping them back to a blank Step 1.

### B3. Separate "level" from subject, and make both data-driven

"Level" currently only exists smeared across a hard-coded subject string
("GCSE English Language") plus a free-text year group. Restructure into
**Level (KS3 / GCSE / A Level) × Subject × Board**, driven by a data table rather
than the hard-coded `<option>` list (`main.jsx:11669-11673`). Benefits:

- The tier descriptors in the generation prompt
  (`generate-essay-background.js:210-214` — "GCSE 1-4 / A-Level D-E") can be chosen
  per level instead of mentioning both.
- Adding subjects (History, RS, Sociology — all essay subjects the platform's
  grading already handles generically) or boards (OCR, WJEC, CCEA) becomes a data
  change, not four nested edits. Moving `examPaperData` out of the component body
  (already flagged in IMPROVEMENT_PLAN 3.5 — it's re-allocated every keystroke) is
  the first step; moving it to Firestore so an admin can maintain the catalogue
  without a deploy is the destination.
- KS3's odd UX disappears: today KS3 still shows the board dropdown, and the
  "internally set by schools" notice only appears *after* picking a meaningless
  board (`main.jsx:11798`).

### B4. Persist the paper/question selection into the payload and prompt

`selectedPaper`/`selectedQuestions` currently feed only PDF extraction and the
"Apply Selection" mark arithmetic. The generation prompt never sees which questions
were chosen — it only gets the free-text `paperName`. Send
`getSelectedQuestionDescriptions()` (`main.jsx:10853`) in the generation payload so
the model knows it is scaffolding, say, "AQA Paper 1 Question 5: descriptive or
narrative writing (40 marks)" — that's a materially better prompt than "Paper 1".
Save the selection on the essay document too (see A6).

---

## 4. Theme C — Generation pipeline: correctness and robustness

### C1. Ask Claude for JSON, not JavaScript (removes the whole parser problem)

The single largest source of fragility: the model is asked to emit a **JavaScript
program** (`window.ESSAYS['id'] = { … }` with nested template literals), which then
has to be parsed back — via `new Function()` on the server
(`generate-essay-background.js:284-312`), and on the client through a cascade of
three strategies including a hand-written character-walking template-literal
converter and a manual bracket-matching field extractor
(`main.jsx:11222-11441`, ~220 lines). When all three fail the teacher is told to
regenerate; when strategy 2/3 half-succeed they get "please verify the content"
alerts. `injectSourceContent` then patches the source material back in with regex
replaces on the generated code (`generate-essay-background.js:322-355`).

All of this exists only because the output format is code. Switch to **structured
output via tool use**: define one `create_essay_config` tool whose input schema *is*
the essay config schema, call with `tool_choice: {type: "tool"}`, and the API
returns validated JSON — no fences, no backticks, no eval, no fallback strategies.
Concretely deletable afterwards: `extractJavaScript`, `parseEssayConfig`'s
`new Function` (an eval of model output — also a code-injection surface),
`injectSourceContent`'s regexes, and the entire 3-strategy client parser. The
"Step 5 fallback: raw config you can't edit" screen (`main.jsx:12039`) disappears
as a possibility. This is the highest-leverage single change in the feature.

### C2. Handle truncation and errors from the model call

`makeRequest` never checks `stop_reason` (`generate-essay-background.js:90-128`).
With `max_tokens: 12000` and 4-6 paragraphs × 3 tiers of learning material, long
essays can hit the cap; a truncated config is what sends teachers into the
fallback-parser mess with a *plausible-looking but incomplete* essay. Check
`stop_reason === 'max_tokens'` and either continue the generation or fail with an
explicit "output too long — try fewer paragraphs" error. Add one retry with backoff
for 429/5xx (the grading functions already suffered a model-retirement outage —
commit `fca8890` — so centralising the model call + error handling in `_lib/` for
all six AI functions would prevent the next one requiring six edits).

### C3. Secure and tidy the job pipeline

- **`generate-essay-background` has no auth** — anyone can POST
  `{jobId}` and re-trigger Claude runs. JobIds are guessable-ish
  (`essay_<timestamp>_<9 chars>`, `generate-essay-start.js:99`). Since the client
  fires it immediately after `start`, fold the trigger into `start` itself (invoke
  the background function server-side) or verify the session like its siblings.
- **Jobs never expire**: completed job blobs (with full base64 file payloads in
  `input`) sit in the `essay-generation-jobs` store forever. Set a TTL/cleanup.
- **No rate limit on generation** despite a `rateLimits` collection existing —
  each run is a large paid Sonnet call; a stuck client retry loop or a malicious
  admin session shouldn't be able to fire unbounded generations.
- The "job not found → report `processing`" choice in `generate-essay-check.js:103`
  means a *deleted/never-created* job polls as "processing" for the full 6 minutes
  before a vague timeout. Distinguish "not found yet (just started)" from "unknown
  job" (e.g. after N polls, report it).

### C4. Don't inline base64 images into the Firestore essay document

`injectSourceContent` embeds uploaded images as base64 in `sourceImages`
(`generate-essay-background.js:338-352`), which is saved to Firestore via
`manage-essays`. Firestore documents cap at ~1 MiB — two photos of a source text
will exceed it and the save fails at the very last wizard step, after generation
has already been paid for. Upload images to Firebase Storage and store URLs, or at
minimum validate payload size at Step 2 with a clear message, not at save time.

### C5. Word-count and numeric sanity checks

`minWords`/`targetWords`/`maxAttempts` are free numeric inputs with no relationship
validation (`main.jsx:11993-12008`): `min > target`, `0`, negative or absurd values
all pass straight into the prompt and the student experience. Validate before
generate.

---

## 5. Theme D — Wizard UX

### D1. Step order fights the auto-extraction feature

Step 1 *requires* Total Marks (`main.jsx:11001`) — but the PDF auto-extraction that
can fill Total Marks (and series, and question) only happens in Step 2. So the
teacher must manually look up the mark count that the app is about to extract for
them anyway. Either make the upload the *first* thing in the wizard ("Start from a
paper: upload/pick it and we'll fill in the details"), or defer the marks
requirement to generate-time. The most natural shape given A1-A4 is an entry
choice: **"Start from a past paper"** (pick/upload → everything auto-fills) vs
**"Start from scratch"** (current manual path).

### D2. Make the step indicator navigable and honest

- The step circles (`main.jsx:11636-11651`) are display-only; completed steps
  should be clickable to jump back (state is preserved — only the buttons don't
  exist).
- Guard against losing a generated-but-unsaved essay: "Back to Generate" from the
  editor, or regenerating, silently discards teacher edits from Step 5; the tab
  itself can also be closed with no `beforeunload` warning while an unsaved essay
  sits in state. Add a confirm on destructive navigation and a draft save (B1)
  for the rest.
- 17 `alert()`/`confirm()` calls in this component alone (validation, file errors,
  overwrite, parse warnings) — replace with inline field errors and non-blocking
  banners, consistent with IMPROVEMENT_PLAN Phase 4's app-wide goal.

### D3. Selection niceties

- Auto-apply the paper/question selection (marks + time + name) as it's toggled —
  the separate "Apply Selection" button (`main.jsx:11783`) is an extra step nobody
  needs, and today nothing tells the teacher whether they applied it before
  continuing.
- Question picker supports multi-select, but generation produces a single essay
  config; either scope to one question (radio) or generate one essay per selected
  question (a genuinely useful batch feature for "set the whole of Section A").
- Mark scheme upload accepts exactly one file (`main.jsx:11944`), while sources
  accept many — mark schemes are frequently photographed page-by-page; accept
  multiple.

### D4. During generation

- The status line is a generic spinner for up to 6 minutes. With the job pattern
  already in place, write progress stages to the job blob ("Reading mark scheme…",
  "Writing paragraph guidance 3/5…" via streaming or coarse checkpoints) and
  surface them in the poll. Perceived time drops dramatically with real stages.
- "Stop waiting" abandons the poll but the teacher can't discover the finished
  result later except by re-entering the tab (resume effect, `main.jsx:11121`).
  Consider a small "generation in progress/ready" badge on the Generate tab.

### D5. After generation

- **Student-view preview**: the Review & Edit step shows form fields, but the
  teacher never sees what the *student* will see (learning material rendered as
  markdown, the reference panel, tier switching) until they save and hunt the
  essay down as a preview. `previewMode` already exists in `ParagraphScreen`
  (`main.jsx:6354`) — add a "Preview as student" toggle in Step 5.
- **Per-paragraph regeneration**: if one paragraph's guidance is weak the only
  options are hand-editing or regenerating everything (losing all edits). A
  "Regenerate this paragraph" (optionally with a short instruction) is a cheap,
  high-value Haiku/Sonnet call reusing the stored wizard context.
- **Word-count sanity display**: show per-tier learning-material lengths in the
  editor so truncated/thin tiers (the classic failure mode) are visible at a
  glance instead of discovered by students.

---

## 6. Prioritised roadmap

**Quick wins (hours each, no schema changes)** — ✅ all implemented
1. ✅ Keep the panel mounted on tab switch + draft autosave to localStorage (B1).
2. ✅ Last-used defaults prefill; don't wipe the form after save (B2).
3. ✅ Auth on `generate-essay-background`; check `stop_reason`; one retry (C2, C3).
4. ✅ Send selected-question descriptions + board/series into the generation prompt
   and persist them on the essay (A6, B4).
5. ✅ Detect scanned/empty-text PDFs and say so (A4, minimal version).
6. ✅ Auto-apply paper selection; clickable step indicator; numeric validation
   (D3, D2, C5).

**Medium (a day or two each)**
7. ✅ Structured output via tool use — delete the parser cascade (C1). *Implemented:
   generation now forces a `create_essay_config` tool call with a full JSON schema;
   the generator's client-side multi-strategy parser was reduced to a single direct
   parse (the import dialog keeps its tolerant parser for hand-pasted configs).*
8. ✅ Grade-boundaries UI in Step 3 → activates existing student-side authentic
   descriptors (A5). *Boundaries are also auto-detected from uploaded mark
   schemes and pre-filled.*
9. ✅ Mark-scheme AI extraction + store mark scheme on the essay (A5, A6).
   *Uploaded mark schemes get an AI structuring pass (level descriptors into
   the text field, grade boundaries detected); storage landed with item 4.*
10. ✅ Native PDF `document` blocks for extraction (A4 full version). *Scanned
    question papers and mark schemes under ~3MB are now sent as base64 PDFs
    and read with Claude's document support; larger scans get a clear warning.*
11. ✅ Teacher profile defaults in Firestore (B2); Level/Subject/Board restructure
    with data-driven catalogue (B3). *Defaults roam via a `teacher-preferences`
    function (localStorage still wins locally); Step 1 now has separate Level /
    Subject / Board selectors driven by a `QUALIFICATION_LEVELS` table, the
    composed subject string keeps existing essays compatible, KS3 no longer
    shows a meaningless board picker, and generation phrases the three tiers
    for the chosen level. Remaining from B3: hosting the catalogue in
    Firestore so admins can extend it without a deploy.*
12. ✅ Student-view preview + per-paragraph regenerate (D5). *Step 5 renders
    each tier's learning material as students see it, and any paragraph can be
    regenerated with an optional instruction without losing edits elsewhere.*

**Larger (the step-change in user-friendliness)**
13. Past-paper picker with official board links per series (A1) + fetch-by-URL (A2).
14. Shared paper/mark-scheme library in Firestore — upload once, reuse forever (A3).
15. "Start from a past paper" wizard entry path unifying 13/14 with extraction:
    pick board → paper → series → question(s); QP, insert and MS fetched and
    extracted automatically; teacher reviews and hits Generate (D1).
16. Images to Firebase Storage instead of inline base64 (C4); job TTL + generation
    rate limiting (C3).

Items 1-6 alone fix the concrete complaints (lost selections, inaccessible
papers-adjacent friction); item 7 removes the feature's biggest reliability risk;
items 13-15 turn "a form that accepts exam papers" into "an app that knows the
exam system".

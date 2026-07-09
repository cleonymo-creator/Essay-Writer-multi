# UI & Design Review — Guided Essay Writing Platform

**Date:** 9 July 2026
**Method:** Full read of the frontend (`src/main.jsx`, 13,452 lines; `index.html` CSS, ~4,500 lines), a production Vite build rendered headlessly and screenshotted at desktop (1440×900) and mobile (390×844) viewports, and contrast ratios computed from the actual theme hex values. Every finding below carries a `file:line` reference so it can be actioned directly.

---

## Executive summary

The app has a real, distinctive visual identity — the Victorian gold-on-dark theme is memorable and the design-token layer in `index.html:135-216` is a genuinely good foundation. Several interaction ideas are excellent: text-to-speech with grade-adjusted speech rate, the original-vs-improved essay comparison ("+N marks gained through improvements!"), the one-error-at-a-time technical correction step, and the grades table with sticky columns and grouped headers.

But the execution has drifted badly from that foundation, and the seams show in the highest-stakes moments:

1. **Students see broken text at the emotional peak of the product.** The two primary feedback buttons literally render as `? Revise My Paragraph` and `? Accept & Continue` (lost emoji → `?`), and grade-tier titles render raw HTML entity codes (`&#128640; Aiming High!`) instead of emoji.
2. **Three CSS tokens are used but never defined** (`--color-danger`, `--color-gold`, `--color-bg-secondary`), silently stripping the warning colour from exactly the students who most need attention.
3. **Accessibility is close to zero.** Two `aria-` attributes in 13,452 lines; no `:focus-visible` rule anywhere; no `prefers-reduced-motion`; the app's primary actions (essay cards, dashboard sidebar, paragraph tracker) are clickable `<div>`s a keyboard user cannot reach. Multiple text/background pairs fail WCAG AA, one at 1.5:1.
4. **Students can silently lose work.** Unsubmitted draft text lives only in component state; tapping a paragraph-tracker number unmounts the editor and discards it, with no warning and no `beforeunload` guard — and paste is blocked, so retyping is expensive.
5. **The browser Back button exits the site from anywhere** — mid-essay, or at step 5 of a six-minute AI generation job — because there is zero History API usage.
6. **The design system exists but isn't used**: 1,059 `parseStyle("...")` inline-style strings, the student essay textarea class (`.paragraph-editor`) repurposed as the universal form input, four different loading-state patterns, three delete-confirmation patterns, and passwords handed to teachers via `alert()`.

The radical opportunity (§5–§7) is to reorganise both halves of the product around their core emotional jobs: for students, *seeing feedback and their own writing at the same time and feeling progress*; for teachers, *knowing who needs help today* instead of reading database tables.

---

## 1. What's working — keep and amplify

- **The Victorian identity.** Cinzel/Crimson Text, gold glow, inner-border "frame" treatment (`.victorian-border`, index.html:285-298). No other ed-tech product looks like this. The theme should be kept — and enforced.
- **A real token system** (index.html:135-216): full colour/spacing/radius/shadow/transition scales. The problems below are drift *from* it, not absence *of* it.
- **TextToSpeech** (main.jsx:1197) — including slower speech for lower target grades (main.jsx:1209-1216). Genuinely inclusive design.
- **Growth-framed comparison**: "+N marks gained through improvements!" and "without your improvements you'd have received Grade X" (main.jsx:6485-6544). This is the best emotional design in the app.
- **Technical-error correction** (main.jsx:5181-5470): rule + hint + type-the-fix, progress dots, celebration with fixed-error count. Strong pedagogy.
- **Strengths listed before improvements** in feedback (main.jsx:4505 vs 4514).
- **The grades table** (main.jsx:2694): sticky student column, grouped 1st-Draft/Final header, legend, no-attempt row tinting. The best table in the app.
- **Student progress durability**: localStorage-immediately + debounced server save, three-tier resume (main.jsx:12687-12747, 12499-12584).
- **The generator's exam-paper picker** auto-filling marks and timing from board data (main.jsx:10319-10401), and the structured Review & Edit step (main.jsx:10660-10839).
- **Mobile writing layout**: task panel becomes a full-screen sheet with a FAB (index.html:4350-4386) — right pattern, broken execution (the FAB is empty, see §2).

---

## 2. Ship-this-week fixes (P0)

Small, high-visibility, low-risk. Roughly in order of user-facing severity.

### 2.1 Broken visible text
- **Mojibake CTAs**: `? Revise My Paragraph` / `? Accept & Continue` — main.jsx:4548, 4551. These are the two most important buttons in the student loop.
- **Raw HTML entities shown to students**: tier titles are JS strings containing `&#128640;` etc., which JSX escapes — students see the literal code (main.jsx:4879-4881).
- **Empty mobile FAB**: `TaskToggleButton` renders a gold circle with no icon or text (main.jsx:4209; CSS index.html:4320-4347).
- **Empty comparison arrow** div (main.jsx:6310) and headings with orphaned leading spaces where emoji were lost (`" Feedback"`, `" Essay"` — main.jsx:7395, 7470, 6293, 6553).

### 2.2 Dead / broken tokens
- `var(--color-danger)` used at main.jsx:2476, 7279 — **never defined** (the token is `--color-error`, index.html:171). Effect: paragraph scores below 60% lose their warning colour in both teacher views.
- `var(--color-gold)` used at main.jsx:4824-4825 and index.html:2973, 2989, 2999 — never defined. The "Saved progress found!" resume box loses its emphasis.
- `var(--color-bg-secondary)` used 13× in the generator (main.jsx:10320, 10405, 10478, 10668, 10741…) — never defined; resolves to transparent.
- `--color-text-secondary: #e8e8e8` is **identical** to `--color-text` (index.html:161-162), flattening the entire text hierarchy.

### 2.3 Worst contrast failures (computed)
- **Expanded paragraph header in the generator**: `var(--color-primary-light, #f0f4ff)` background — the fallback betrays a light-theme assumption, but the token is gold `#daa520`. Text `#e8e8e8` on gold ≈ **1.8:1**; the gold paragraph number on it ≈ **1.5:1** (main.jsx:10741-10743).
- White on `--color-success` `#22c55e` "Done" chips ≈ **2.3:1** (main.jsx:2513, 7315).
- `#ef4444` error text on its 15-20% tint ≈ **2.6-3.7:1** — authenticity chips (main.jsx:4380-4415) and every error banner (main.jsx:1570, 2031, 4891).
- White on `#b8860b`: step-indicator circles ≈ 3.3:1 at 0.8rem bold (main.jsx:10246-10248) and "Current" chips (main.jsx:2484).
- `#b8860b` "(you)" badge on `rgba(184,134,11,0.4)` ≈ **1.9:1** (main.jsx:11166).

### 2.4 Silent draft loss
Unsubmitted textarea content exists only in `ParagraphScreen` state (main.jsx:5472); `currentText` is written only on submit (main.jsx:12829), and the screen is keyed by paragraph id (main.jsx:13410) — navigating via the tracker discards typed work. No `beforeunload` guard exists anywhere (grep-verified). Fix: debounce-save the live draft into `paragraphStates[id].currentText` (already read on mount), show a "Saved ✓" chip near the word count, and guard dirty navigation.

### 2.5 Shared-device privacy leak
`EssaySelectionScreen` cards display the previous user's name and progress from localStorage (`{savedProgress.studentName} — 2/5 paragraphs`, main.jsx:4101, 4127-4128) and clicking resumes into their state. On shared school machines this is a real safeguarding/privacy problem.

### 2.6 Passwords in `alert()`
Student password resets (main.jsx:2949, 10953, 11524) and "Student created" (main.jsx:3178, 11693) show a one-time password in a native alert — dismiss it and it's gone, no copy button. AddTeacherModal already has the right pattern (success screen with `<code>` block and warning card, main.jsx:11309-11343); generalise it, add copy-to-clipboard, and add a **download credentials CSV** button to the CSV-import results (main.jsx:3573-3580).

### 2.7 Miscellaneous correctness-with-UX-impact
- `getGradeColor` checks `g.includes('A')` — "Ungraded" and "N/A" contain "A" and render success-green (main.jsx:2198-2205, fallback set at 2160).
- Submissions table hardcodes every score green regardless of value (main.jsx:7392) while the Performance tab colours the same score red — one 25% essay, two colours.
- `text.replace(targetText, correction)` fixes only the **first occurrence** — correcting a repeated word can edit the wrong instance of a student's essay (main.jsx:5206-5209).
- Grades-table sticky column uses `background: inherit` over a transparent row — scores scroll through the "sticky" student names (main.jsx:2742).
- "Skipped - you can review this later" in the technical check is a false promise; skipped errors never resurface (main.jsx:5259).
- Two different greens on the login screen: hardcoded `#2ea043` (main.jsx:1576) vs token `#22c55e`.

---

## 3. Design-system foundations (the enabler for everything else)

**The core problem: 1,059 `parseStyle("...")` calls** — CSS strings parsed at render time — plus dozens of hardcoded rgba/hex values that duplicate existing tokens (`rgba(239,68,68,0.15)` instead of `--color-error-bg`, etc., e.g. main.jsx:4338, 4470, 6212, 6302, 7491). Nothing above can be fixed *once* while every table, modal, and field is a bespoke string.

Extract six primitives and migrate screen by screen:

| Primitive | Replaces | Must include |
|---|---|---|
| `<Field>` | ~40 hand-rolled label+input pairs (none has `htmlFor`/`id`) | auto id association, error slot, hint slot |
| `<Modal>` | 10 divergent modals (overlays 0.6/0.7/0.8; some close on backdrop, most don't; h2 vs h3 titles) | `role="dialog"`, `aria-modal`, focus trap, initial focus, focus return, Esc-to-close, one scrim |
| `<Table>` | 7+ hand-copied table markups with drifting padding/fonts (main.jsx:2383, 2564, 2694, 3110, 7215, 8720, 11152, 11619) | sortable headers, `scope="col"`, caption, compact density mode |
| `<Button>` | `.btn` variants + one-off inline buttons | visible `:focus-visible` ring, loading state, destructive variant |
| `<ScoreBadge>` / `<GradeChip>` | 4 divergent score→colour mappings (incl. the always-green bug and dead `--color-danger`) | single mapping, colour + icon/text (never colour alone) |
| `<Toast>` + `<ConfirmDialog>` | 30+ `alert()`/`confirm()` calls | replaces native dialogs app-wide |

**Also at this layer:**
- **One input style.** `.paragraph-editor` (the student essay textarea, index.html:3206) is the app-wide input via `min-height:auto` overrides in dozens of places (main.jsx:1538, 1996, 8582, 11361, 12178…). `.form-input` (index.html:2038) already exists — use it, or a new `.input` class.
- **One icon system.** Three coexist: HTML entities, literal emoji, and the Lucide SVG `Icon` component (main.jsx:88). Standardise on `Icon` (with `aria-hidden="true"` added to its wrapper) — this also permanently fixes the mojibake class of bug, which will recur as long as emoji live in source strings.
- **Global a11y CSS**: a `:focus-visible` rule (there are currently none; all input `:focus` styles start `outline: none`, and several substitute rings use `rgba(30,58,95,0.1)` — an invisible leftover from a light theme, index.html:1535, 1857, 2042); and a `prefers-reduced-motion` block disabling `ghostAppear`, `candleFlicker`, `pulse-speaking`, spinners' scale transforms, and hover `translateY`s.
- **Fix the token layer**: define the three missing tokens, give `--color-text-secondary` a real value (e.g. `#c8c8d0`), replace the off-palette cyan `#22d3ee` grade colour (main.jsx:2202, 2851) with a token, and audit every gold-family text/background pair against 4.5:1.

---

## 4. Accessibility (currently a blocker for school procurement)

Schools increasingly require WCAG 2.1 AA. The app is far from it, but the failures are concentrated and fixable:

1. **Keyboard operability** — the biggest blocker. Clickable `<div>`s with no role/tabIndex/key handler: essay cards (main.jsx:1767, 4103), the entire dashboard sidebar including Logout (main.jsx:6922-6991), paragraph tracker items (main.jsx:4242-4255), expandable table rows (main.jsx:2436, 7234), accordion headers (main.jsx:1888, 2323, 7201, 8706, 10740), click-to-expand hint `<li>`s (main.jsx:5072-5080), and the generator's exam-question checkboxes hidden with `display:none` (main.jsx:10370) — question selection is mouse-only and invisible to assistive tech. Rule: *everything clickable becomes a `<button>`*.
2. **Screen-reader silence.** After a 10-30s grading wait, feedback just appears (main.jsx:5846) — no `aria-live` region, no focus move; `LoadingSpinner` has no `role="status"`. Progress bars are bare divs (main.jsx:1805, 2450, 7256). Tables have no `scope`/`caption`; the grades table's two-row grouped header (main.jsx:2696-2718) can't be navigated non-visually.
3. **Labels.** No `<label htmlFor>`/`id` association on any form in the app (login main.jsx:1530-1558; change-password 1989-2027; entry 4782-4808; every admin form, e.g. 11352, 12171). Search fields are placeholder-only (main.jsx:3091, 7112, 11596).
4. **Colour-only meaning.** Grades-table cell colour is the sole good/bad signal (main.jsx:2790, 2811) and its legend is colour-only squares; tier selection is colour-banded (index.html:4570-4586). Pair every colour with an icon or text.
5. **Touch targets.** Show/Hide password (main.jsx:1559-1565), TTS controls at `padding: 2px 4px` (index.html:3130), 0.65-0.7rem metadata text throughout — small for a school-iPad audience. (The 48px grade buttons, index.html:4542, show the team knows the right size.)
6. **Reading level.** "Indicative Mark Assessment", "Sophistication Mismatch", "Cumulative (N paragraphs)", "holistic" (main.jsx:4389-4472, 6239) — aimed at students targeting GCSE grades 1-3. Rewrite student-facing strings at the audience's reading age.

---

## 5. The student experience — radical redesign

The current writing loop is pedagogically strong but emotionally and ergonomically inverted: reference material dominates the screen while the editor hides below the fold; feedback replaces the student's text instead of sitting beside it; the grade lands before the encouragement; and revision is framed as a depleting resource ("2 revisions remaining", main.jsx:5765-5772).

### 5.1 Split-view revise mode ⭐ highest impact-to-effort in this review
Feedback and editor are mutually exclusive (`!showFeedback && …`, main.jsx:5793), and clicking "Revise" **destroys the feedback** (`setCurrentFeedback(null)`, main.jsx:5705-5712) before restoring the editor — students must memorise the advice and revise blind. Show them side by side (two columns ≥1024px; tab/sheet on mobile). This is nearly a render-condition change.

### 5.2 Inline annotations on the student's own text
The single most "spectacular" upgrade available. The machinery already exists — TechnicalErrorCorrection highlights error spans in context (main.jsx:5293-5311). Extend the grading response to anchor each strength/improvement to a quoted span, then render the student's paragraph with gold underlines (strengths) and dashed underlines (improvements) with popover comments. Feedback about "your topic sentence" should point *at* the topic sentence. This transforms the product from "essay grader" to "writing coach".

### 5.3 Make the editor the hero
On ParagraphScreen the editor sits below the type badge, the fully-expanded source material, the learning material block, the prompt, and the attempt indicator — hundreds of pixels below the fold at `min-height: 250px` (main.jsx:5722-5772; index.html:3206). Meanwhile source material is *duplicated* in the TaskPanel sidebar (main.jsx:4186). Collapse source/learning material by default after first view, move hints behind "Need help?", let the sidebar own reference material, and give the editor full height — a genuine focus mode. Reconsider `spellCheck={false}` + paste-blocked-by-`alert()` (main.jsx:5800-5816): anti-cheating is legitimate, but the authenticity checker already exists; punishing every student with no spellcheck and hostile alerts is the wrong trade.

### 5.4 Reverse the emotional arc of feedback
The grade badge is the largest element and is seen first (main.jsx:4431; 3rem mark at 6223-6229). Reveal strengths → improvements → *then* an animated grade (the `scoreReveal` keyframes at index.html:312-316 exist and are barely used). Reframe "Attempt 1 of 3" as growth ("Draft 1 — you can improve this twice more"). And soften the authenticity warning (main.jsx:4335-4423): today it's a red-glowing box with accusatory chips ("AI Writing Patterns") and shouting copy *above* the student's strengths — a false positive is the most hostile moment in the app. Make it a neutral, private check-in in amber, below strengths: "Some of this doesn't sound like your usual writing — want to put it in your own words?"

### 5.5 Humanise the long waits
Submission runs two sequential AI calls behind bare spinners (main.jsx:5788, 5826); compilation auto-fires up to three more (main.jsx:5884-5899); failure after 30 seconds is `alert('Failed to submit. Please try again.')` (main.jsx:5693). Stage the wait ("Reading your paragraph… Checking against grade descriptors… Writing your feedback…"), show a time expectation, and replace alert-failures with inline retry that reassures the draft is safe.

### 5.6 Dashboard as a progress home, not a file list
The data (percent complete, grades, submissions — main.jsx:1740-1744) renders as 4px progress bars and small text. Rethink: a hero "next action" card ("Continue *An Inspector Calls* — you're 60% through"), a visible weekly stat ("3 paragraphs written this week"), and celebration states for submitted work (grade-reveal animation, teacher-comment teaser) instead of a green border and the word "Submitted" (main.jsx:1788-1796). "Explore Other Essays" — the one intrinsically-motivating feature — is hidden behind a literal `[+]` text toggle (main.jsx:1896); surface it as "Extra challenges". Finishing the final paragraph currently dumps straight into a grading spinner (main.jsx:5884-5890) — that moment deserves the app's biggest celebratory beat.

### 5.7 Delete the EntryScreen for logged-in students
Name and email are already known (main.jsx:4767-4778), yet students re-enter a target grade *every session* (main.jsx:4728-4731). Persist target grade on the profile, and let the app *suggest* stretch targets after the first graded essay. Also remove the visible ability banding — tier colours (green=high, blue=foundation, index.html:4570-4586) let classmates read ability level at a glance; keep tier framing neutral and private. Dashboard tap → straight into the essay, auto-resuming; "start over" lives inside, undoable. This deletes an entire screen (and the confusing "Start fresh instead" ambiguity at main.jsx:4685-4692) from the daily loop.

### 5.8 Consider class-code login for younger students
Email+password+inbox-based reset is heavy for Year 7s who often can't reach email in class (the reset copy even says "Check your inbox", main.jsx:1492). A teacher-issued class code + name picker + PIN with teacher-side reset removes the forgot-password problem and the shared-device leak in one move.

---

## 6. The teacher experience — radical redesign

Today's dashboard is a set of database-table viewers with overlapping content: student results appear in four different tables (Submissions ×2, Performance by-essay, by-student, grades table) with no cross-links, separate class filters that don't persist across tabs (main.jsx:2060, 2883, 6617), duplicate "Students" nav items with the same icon (main.jsx:6941 vs 6967), and a sidebar badge that counts every submission ever (main.jsx:6926). No table is sortable. A teacher's real questions — *Who needs help today? Did the class get the skill? What do I do next lesson?* — have no home.

### 6.1 One "Class Health" home
Merge Submissions + Performance into a single class-scoped overview with one persistent class switcher and an attention-first triage strip: "3 students stuck on the same paragraph for 20+ min", "5 haven't started — due Friday", "Class average dropped 12% on analysis paragraphs". The raw counts currently shown (Total/Completed/In Progress, main.jsx:2288-2303) are inventory, not insight.

### 6.2 Student drill-down as the core object
A student's name appears in seven tables and none clicks through. Every name should open a profile: score-trajectory sparkline, current in-progress essay with live paragraph status, and their actual writing one click away. The data already exists (`getStudentStats` main.jsx:2178, `paragraphScores` 2472, the rich submission viewer 7413-7557) — it just isn't connected.

### 6.3 Read the writing, not just the number
Chips show "P2: 45%" but never the paragraph. The real-time Firebase subscription (main.jsx:6697-6712) makes a live "over-the-shoulder" view of a stuck student feasible — the highest-value teacher moment in the product. Aggregate the stored AI feedback across the class ("8 students got 'add evidence' as their top improvement") and you've produced next-lesson planning material no competitor surfaces.

### 6.4 Assignments as a workflow with due dates
Replace per-essay Assign/Remove toggles (main.jsx:3885-3891) with: pick essay → pick class/students → **set due date** → track completion per assignment → one-click "remind non-starters". Due dates don't exist in the model yet are the organising unit of real teaching. Currently assign/unassign actions swallow errors into `console.error` with zero UI feedback (main.jsx:3806-3808, 3840-3842).

### 6.5 Roster operations that respect a 30-student class
- Checkbox multi-select with bulk actions (move class, assign, delete-with-undo); sortable columns everywhere.
- CSV import as a wizard: upload → parsed preview ("32 rows found, 2 invalid — here's why") → commit → **download credentials CSV**. Today's import naively `split(',')`s (quoted Excel fields corrupt, main.jsx:3383), silently drops invalid rows (main.jsx:3400), and shows 30 one-time passwords in a scrolling div with "They will not be shown again" (main.jsx:3580).
- "Email Reset to Class" fires N sequential fetches with no progress UI and reports via alert (main.jsx:3003-3032) — batch it, show progress, summarise in a toast.
- Default to emailed set-your-own-password links (endpoint exists, main.jsx:2964) over teacher-transcribed plaintext.

---

## 7. Admin & essay generator

### 7.1 Make generation a durable, detachable job
The generator is conditionally mounted (`{activeView === 'generate' && …}`, main.jsx:8533) — switching tabs mid-generation unmounts it, kills polling, and orphans a 5-minute AI job whose `jobId` (main.jsx:9719) was never persisted. One dropped poll request aborts the whole run (main.jsx:9731-9747); "Back" is disabled so the teacher is captive; the only status is a minute counter. Fix: persist `jobId` + form payload to localStorage, resume polling on mount, surface status as a global banner so teachers can navigate away, add cancel + retry-with-backoff, and stage the progress narrative ("Parsing mark scheme → Drafting paragraph 3/5 → Formatting").

### 7.2 Kill the client-side `new Function()` parsing pipeline
~440 lines of triple-strategy JS-eval of AI output, duplicated across import and save paths (main.jsx:8181-8381, 9822-10043), ending in a fallback that **fabricates empty placeholder paragraphs** when parsing fails (main.jsx:10033-10039) — silent data loss dressed as success. Have the backend return validated JSON (it already returns `parsedEssay`), reject invalid output server-side with a "regenerate" affordance, and delete the eval strategies. (This is also a security-hygiene win.)

### 7.3 Wizard ergonomics
Clickable completed steps (currently `nextStep()` caps at 4 and circles aren't clickable, main.jsx:9685, 10240-10251); inline field validation instead of `alert('Subject is required')` (main.jsx:9668-9679); per-paragraph tier-tab state (one shared `editExpandedTier` changes every paragraph's visible tab, main.jsx:8798); dirty-state guard on leaving Review & Edit (main.jsx:10831); un-truncate the 3000-char raw-config preview (main.jsx:10649). Move the ~640-line hardcoded exam-board dataset (main.jsx:8811-9453) out of the component into data/config.

### 7.4 Consolidate the four admin dialects
Four loading-state patterns, three table-header treatments, three delete flows, two credential-handoff patterns, modals that inconsistently close on backdrop click — all catalogued in §3's primitives. One `<AdminTable>` + `<Modal>` + `<Field>` + `<ConfirmDialog>` pass ends it.

---

## 8. App architecture that blocks good UX

- **Add a router.** Zero History API usage (grep-verified): Back exits the site from mid-essay; nothing is deep-linkable; refresh loses the admin tab, wizard state, and compilation feedback. Even a 30-line hash router (`#/admin/essays`, `#/essay/:id/write`) mapped onto the existing `screen` state (main.jsx:12393) fixes Back, deep links, and refresh amnesia in one move. Modals should push a history entry so Back closes them.
- **Unblock first paint.** The React root mounts only after `loadEssays()` resolves (main.jsx:13448-13452) — a blank page for the duration of a cold Netlify function start. Render a themed loading shell immediately.
- **De-duplicate grading logic.** `requestEssayFeedbackWithStates` vs `handleRequestEssayFeedback` are ~130 duplicated lines that have already drifted (a null-guard exists at main.jsx:12960 but not at 13097).
- **Share dashboard data.** Each teacher panel refetches the same collections (main.jsx:6731, 2066, 2889, 3746); "Refresh Data" only refreshes some of them. A single data context ends the stale-data class of bugs and enables the persistent class filter (§6.1).
- **Proceed with the planned module split** (IMPROVEMENT_PLAN.md Phase 3). The single 13k-line file is the root cause of the copy-paste divergence documented throughout this review.

---

## 9. Prioritized roadmap

### Week 1 — visible-quality and safety (no redesign required)
1. Fix mojibake CTAs, entity-literal tier titles, empty FAB/arrow, orphaned-space headings (§2.1)
2. Define/repoint the four broken tokens; fix the gold-on-gold generator header (§2.2, §2.3)
3. Draft autosave + "Saved ✓" chip + dirty-navigation guard (§2.4)
4. Clear per-student localStorage on logout / scope it per account (§2.5)
5. Copyable credential dialogs + credentials-CSV download; retire password-in-alert (§2.6)
6. Global `:focus-visible` and `prefers-reduced-motion` CSS (§3)
7. Correctness fixes: "Ungraded"-is-green, always-green submissions column, first-occurrence replace, sticky-column bleed-through (§2.7)

### Weeks 2-4 — foundations
8. Extract `<Field>`, `<Modal>`, `<Button>`, `<Table>`, `<ScoreBadge>`, `<Toast>`/`<ConfirmDialog>`; migrate screen-by-screen; one input class; one icon system (§3)
9. Keyboard/AT pass riding on those primitives: buttons-not-divs, labels, `aria-live` for feedback and spinners, table semantics (§4)
10. Hash router + loading shell (§8)
11. Durable generation jobs; retire `new Function()` parsing (§7.1, §7.2)

### The radical quarter — the product leap
12. **Split-view revise mode** (§5.1) — do this first; it's small
13. **Inline annotations on student writing** (§5.2)
14. Editor-as-hero focus mode + progressive disclosure of scaffolding (§5.3)
15. Feedback-before-grade reveal + authenticity-warning reframe + staged waits (§5.4, §5.5)
16. Student progress home with celebration moments; delete EntryScreen; private goals (§5.6, §5.7)
17. Teacher "Class Health" home + student drill-down + live in-progress view (§6.1-§6.3)
18. Assignments with due dates; roster bulk ops; CSV wizard (§6.4, §6.5)

---

*Compiled from four parallel deep-read reviews (student entry surfaces; core writing loop; teacher dashboard; admin & generator) plus direct verification of every P0 claim and rendered-app screenshots. Line numbers reference the repo state at commit `8ebbe2b`.*

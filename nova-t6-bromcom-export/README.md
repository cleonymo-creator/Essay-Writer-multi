# Nova-T6 → Bromcom Class Allocator

A **fully offline, single-file app** for exporting your timetable structure from
Nova-T6 and allocating student class lists ready to import into Bromcom for the
new academic year.

Everything runs in your web browser from one local HTML file. **No server, no
installation, no internet connection, no uploads** — student data never leaves
your computer.

## How to use it

1. Copy `index.html` to any folder on your computer (e.g. alongside your
   timetable files) and double-click it — it opens in your browser.
2. **Step 1 – Timetable:** load your Nova-T6 export (CSV/TSV/text file, or just
   copy-and-paste the grid from Nova-T6/Excel). Confirm the column mapping —
   the app pre-selects its best guesses. Only the *class code* column is
   required; Nova-style codes such as `10A/Ma1` are split automatically into
   year (10), band (A), subject (Ma → Mathematics) and set (1).
3. **Step 2 – Structure:** review the classes that will be created in Bromcom.
   Teacher/room clashes, missing subjects and unknown subject codes are
   flagged. The subject-code mapping (`Ma=Mathematics`, …) is editable.
4. **Step 3 – Students (optional):** load a CSV of students with the class
   codes they should be in (e.g. an export from SIMS or your current MIS).
   A student's classes can be spread over several columns or listed in one cell
   separated by `;` `,` or `|`.
5. **Step 4 – Match:** student codes are matched to the timetable classes
   automatically (exact first, then ignoring case/spaces/punctuation). Anything
   unmatched is listed with ranked suggestions to pick from, and there's a
   find-and-replace for systematic renames (e.g. every `9A/` → `10A/`).
6. **Step 5 – Export:** download the Bromcom-ready CSVs:
   - **Classes** — one row per teaching group (name, subject, year, block/band,
     teacher, room, periods per cycle, student count)
   - **Timetable** — one row per scheduled lesson (class, day, period, teacher,
     room), if your export included day/period columns
   - **Class lists** — one row per student-per-class (UPN, admission number,
     name, year, class, subject) — this is the file that allocates students
   - **Exceptions report** — unmatched codes, students with no classes or no
     identifier, empty classes, and timetable clashes to chase before import day

Import the CSVs into Bromcom via **Data Import** (or hand them to your Bromcom
onboarding contact). The headers are standard, but check them against your
Bromcom import template — column names occasionally differ between Bromcom
versions.

There's a **Load sample data** button on steps 1 and 3 so you can try the whole
workflow before using real data.

## Privacy

- The page makes no network requests at all; it works with the internet
  disconnected.
- Nothing is stored unless you press **Save session**, which keeps a copy in
  this browser only (localStorage on this computer). **Clear saved session**
  removes it. On a shared machine, prefer not saving.

## Development

The parsing/matching logic lives between the `LOGIC-START`/`LOGIC-END` markers
in `index.html` and is exported for Node-based tests. Unit tests and a
Playwright end-to-end walkthrough were run against the sample data during
development.

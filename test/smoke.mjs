// Headless smoke test for index.html.
//
// Purpose: catch the "white screen" class of failure — syntax errors, bad
// references, broken JSX — before they ship. It serves the real index.html,
// loads it in headless Chromium, and asserts the app boots without uncaught
// errors and renders an interactive screen. This is the safety net that makes
// the Phase 3 frontend refactor (IMPROVEMENT_PLAN.md) doable incrementally.
//
// Hermetic: the CDN <script> tags are mapped to npm-installed copies of the
// same libraries (the agent proxy blocks CDNs but allows the npm registry), and
// the two functions the app calls on boot are stubbed. No network is required.
//
// Run:  npm run test:smoke
// CI:   npm ci && npx playwright install chromium && npm run test:smoke

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// Locate the Chromium that Playwright manages (pinned dir in this environment,
// or discovered under PLAYWRIGHT_BROWSERS_PATH in CI).
function findChrome() {
  if (process.env.SMOKE_CHROME) return process.env.SMOKE_CHROME;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  // Prefer the headless_shell build: the full chromium binary has removed the
  // "old headless" mode that playwright-core launches by default.
  const candidates = [];
  try {
    for (const d of fs.readdirSync(base)) {
      if (d.startsWith('chromium_headless_shell-')) {
        candidates.push(path.join(base, d, 'chrome-linux', 'headless_shell'));
      }
    }
    for (const d of fs.readdirSync(base)) {
      if (d.startsWith('chromium-')) {
        candidates.push(path.join(base, d, 'chrome-linux', 'chrome'));
      }
    }
  } catch { /* fall through */ }
  return candidates.find(p => fs.existsSync(p)); // undefined -> playwright default
}

// CDN URL substring -> local vendored file for the libraries still loaded via
// <script> in index.html (React/Babel are now bundled by Vite, so they are not
// requested from a CDN and not listed here). Order: more specific first.
const VENDOR = [
  ['marked.min.js', 'node_modules/marked/marked.min.js'],
  ['purify.min.js', 'node_modules/dompurify/dist/purify.min.js'],
  ['firebase-app-compat.js', 'node_modules/firebase/firebase-app-compat.js'],
  ['firebase-firestore-compat.js', 'node_modules/firebase/firebase-firestore-compat.js'],
  ['firebase-auth-compat.js', 'node_modules/firebase/firebase-auth-compat.js'],
  ['pdf.worker.min.js', 'node_modules/pdfjs-dist/build/pdf.worker.min.js'],
  ['pdf.min.js', 'node_modules/pdfjs-dist/build/pdf.min.js'],
];

function vendorFor(url) {
  for (const [needle, file] of VENDOR) {
    if (url.includes(needle)) return path.join(ROOT, file);
  }
  return null;
}

// Serve the built app from dist/ (run `vite build` first) plus stubs for the
// two functions the app calls on boot.
const SERVE_DIR = path.join(ROOT, 'dist');
const CTYPES = {
  '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.map': 'application/json',
};

const server = http.createServer((req, res) => {
  const u = decodeURIComponent((req.url || '/').split('?')[0]);
  if (u === '/.netlify/functions/firebase-config') {
    // No apiKey -> the app leaves Firebase disabled and takes the functions
    // path, so no real Firebase connection is attempted.
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ projectId: 'smoke-test' }));
    return;
  }
  if (u === '/.netlify/functions/manage-essays') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, essays: [] }));
    return;
  }
  // Static file from dist/
  const rel = u === '/' ? '/index.html' : u;
  const filePath = path.join(SERVE_DIR, rel);
  if (!filePath.startsWith(SERVE_DIR)) {
    res.writeHead(403); res.end('forbidden'); return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end('{"error":"not found (smoke server)"}');
      return;
    }
    res.writeHead(200, { 'Content-Type': CTYPES[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
});

// console.error lines that are expected in the stubbed environment (backend
// absent) and must not fail the test.
const ALLOWED_CONSOLE = [
  /firebase/i,
  /essays/i,
  /Failed to load/i,
  /Could not load/i,
  /\[BABEL\] Note:/,      // benign in-browser Babel deopt NOTE (large inline script); real Babel errors are not matched
];

async function main() {
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  const pageErrors = [];
  const consoleErrors = [];

  const browser = await chromium.launch({ executablePath: findChrome(), args: ['--no-sandbox'] });
  try {
    const page = await (await browser.newContext()).newPage();
    page.on('pageerror', e => pageErrors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });

    // Serve vendored libs for CDN requests; keep everything else hermetic.
    await page.route('**/*', route => {
      const url = route.request().url();
      if (url.startsWith(base) || url.startsWith('data:') || url.startsWith('blob:')) {
        return route.continue();
      }
      const local = vendorFor(url);
      if (local) {
        try {
          return route.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(local) });
        } catch {
          return route.abort();
        }
      }
      return route.abort(); // no other external calls allowed
    });

    await page.goto(base + '/', { waitUntil: 'load', timeout: 60000 });

    // Wait for the app to render an interactive control (past any loading
    // spinner), but fail fast if an uncaught error fires first.
    const firstPageError = new Promise((_, reject) =>
      page.once('pageerror', e => reject(new Error('uncaught error during boot: ' + e.message)))
    );
    await Promise.race([
      // Clean boot renders in ~6s; 30s is generous margin while keeping the
      // failure signal (nothing rendered) reasonably fast.
      page.waitForSelector('#root input, #root button, #root a', { timeout: 30000 }),
      firstPageError,
    ]);

    const rendered = await page.evaluate(() => {
      const r = document.getElementById('root');
      return {
        textLen: r ? r.textContent.trim().length : 0,
        controls: document.querySelectorAll('#root input, #root button').length,
        sample: r ? r.textContent.trim().slice(0, 120).replace(/\s+/g, ' ') : ''
      };
    });

    const realConsoleErrors = consoleErrors.filter(t => !ALLOWED_CONSOLE.some(re => re.test(t)));

    const problems = [];
    if (pageErrors.length) problems.push(`uncaught errors:\n  - ${pageErrors.join('\n  - ')}`);
    if (realConsoleErrors.length) problems.push(`console errors:\n  - ${realConsoleErrors.join('\n  - ')}`);
    if (rendered.textLen < 30 || rendered.controls < 1) {
      problems.push(`app did not render an interactive screen: ${JSON.stringify(rendered)}`);
    }

    if (problems.length) {
      console.error('SMOKE FAIL\n' + problems.join('\n'));
      process.exitCode = 1;
    } else {
      console.log(`SMOKE PASS — app booted and rendered ${rendered.controls} controls (text: "${rendered.sample}...")`);
    }
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch(e => { console.error('SMOKE ERROR:', e); process.exit(1); });

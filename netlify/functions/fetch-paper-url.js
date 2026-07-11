// Fetch a past paper / mark scheme PDF from a URL - Admin only.
// Lets teachers paste a link to an exam board's openly published PDF instead
// of downloading it and re-uploading. The file is fetched server-side and
// returned as base64 for the normal extraction pipeline.
const { connectLambda } = require('@netlify/blobs');
const { getSessionToken, verifyAdminSession } = require('./_lib/session');

const MAX_BYTES = 8 * 1024 * 1024;

// Basic SSRF guard: only public https hosts. (Admin-only endpoint, but the
// function runs inside Netlify's network, so don't let it probe internals.)
function isBlockedHost(hostname) {
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return true;
  // IP literals: block private/loopback/link-local ranges
  const ipv4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [parseInt(ipv4[1]), parseInt(ipv4[2])];
    if (a === 10 || a === 127 || a === 0 || (a === 192 && b === 168) ||
        (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254)) return true;
  }
  if (h.includes(':')) return true; // IPv6 literals: not needed for board sites
  return false;
}

exports.handler = async (event, context) => {
  connectLambda(event);

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const authResult = await verifyAdminSession(getSessionToken(event));
  if (!authResult.valid) {
    return { statusCode: 403, headers, body: JSON.stringify({ success: false, error: authResult.error }) };
  }

  try {
    const { url } = JSON.parse(event.body);
    let parsed;
    try {
      parsed = new URL(url);
    } catch (e) {
      return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'That does not look like a valid link.' }) };
    }
    if (parsed.protocol !== 'https:' || isBlockedHost(parsed.hostname)) {
      return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Only public https links are supported.' }) };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    let response;
    try {
      response = await fetch(parsed.toString(), {
        signal: controller.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; EssayWriter/1.0)' }
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: `The site returned ${response.status} for that link.` }) };
    }

    const contentLength = parseInt(response.headers.get('content-length') || '0');
    if (contentLength > MAX_BYTES) {
      return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'That file is too large (max 8MB).' }) };
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_BYTES) {
      return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'That file is too large (max 8MB).' }) };
    }

    // Accept only PDFs (by magic bytes - content-type headers lie)
    if (buffer.slice(0, 5).toString() !== '%PDF-') {
      return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'That link is not a PDF. Link directly to the question paper or mark scheme PDF.' }) };
    }

    const pathName = parsed.pathname.split('/').pop() || 'paper.pdf';
    const fileName = decodeURIComponent(pathName).replace(/[^a-zA-Z0-9 ._-]/g, '') || 'paper.pdf';

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        fileName: fileName.endsWith('.pdf') ? fileName : fileName + '.pdf',
        base64: buffer.toString('base64')
      })
    };

  } catch (error) {
    console.error('Fetch paper URL error:', error);
    const msg = error.name === 'AbortError' ? 'The site took too long to respond.' : error.message;
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: msg }) };
  }
};

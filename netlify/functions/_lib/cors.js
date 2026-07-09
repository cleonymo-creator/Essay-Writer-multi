// Centralised CORS handling.
//
// Previously every function hard-coded `Access-Control-Allow-Origin: *`.
// These endpoints are called same-origin by the app, so the permissive
// wildcard was unnecessary. Lock the origin via the ALLOWED_ORIGINS env var
// (comma-separated). If it is unset we fall back to '*' so behaviour is
// unchanged until an origin is configured in Netlify.
//
// Set ALLOWED_ORIGINS to your production origin(s), e.g.
//   ALLOWED_ORIGINS=https://your-site.netlify.app

function resolveOrigin(event) {
  const configured = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (configured.length === 0) return '*';

  const requestOrigin = event.headers.origin || event.headers.Origin;
  if (requestOrigin && configured.includes(requestOrigin)) return requestOrigin;

  // Not an allowed origin — return the first configured origin so the browser
  // blocks the cross-origin response rather than silently allowing it.
  return configured[0];
}

function corsHeaders(event, extra = {}) {
  return {
    'Access-Control-Allow-Origin': resolveOrigin(event),
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Content-Type': 'application/json',
    ...extra
  };
}

// Standard preflight response, or null if this isn't an OPTIONS request.
function preflight(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(event), body: '' };
  }
  return null;
}

module.exports = { corsHeaders, preflight, resolveOrigin };

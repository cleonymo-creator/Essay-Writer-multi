// One-time migration function to move static essays to database
// Run this once via: /.netlify/functions/migrate-essays?key=YOUR_MIGRATION_KEY
// After migration, this function can be deleted

const { getStore, connectLambda } = require("@netlify/blobs");
const https = require('https');
const http = require('http');

// Static essay IDs to migrate
const STATIC_ESSAYS = [
  "child-directed-speech-analysis18",
  "dickens-fezziwig-party",
  "public-transport-speech",
  "dickens-scrooge-nephew-contrast",
  "comment-threads-contextual-factors",
  "macbeth-banquo-attitude",
  "persuasive-language-analysis",
  "kindness-christmas-carol"
];

// Fetch a URL and return the content
function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

exports.handler = async (event, context) => {
  connectLambda(event);

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  // Simple security - require a migration key
  const migrationKey = event.queryStringParameters?.key;
  const expectedKey = process.env.MIGRATION_KEY || 'migrate-essays-2024';

  if (migrationKey !== expectedKey) {
    return {
      statusCode: 403,
      headers,
      body: JSON.stringify({
        error: 'Invalid migration key',
        hint: 'Add ?key=YOUR_MIGRATION_KEY to the URL'
      })
    };
  }

  try {
    const essaysStore = getStore("custom-essays");
    const results = [];

    // Get the base URL from the request
    const host = event.headers.host;
    const protocol = host.includes('localhost') ? 'http' : 'https';
    const baseUrl = `${protocol}://${host}`;

    for (const essayId of STATIC_ESSAYS) {
      try {
        // Check if already exists in database
        const existing = await essaysStore.get(essayId, { type: 'json' }).catch(() => null);
        if (existing) {
          results.push({ id: essayId, status: 'skipped', reason: 'Already exists in database' });
          continue;
        }

        // Fetch the JS file via HTTP
        const jsUrl = `${baseUrl}/${essayId}.js`;
        let fileContent;
        try {
          fileContent = await fetchUrl(jsUrl);
        } catch (fetchErr) {
          results.push({ id: essayId, status: 'skipped', reason: 'File not found: ' + fetchErr.message });
          continue;
        }

        // Extract the essay object using regex
        const match = fileContent.match(/window\.ESSAYS\s*\[\s*['"]([^'"]+)['"]\s*\]\s*=\s*(\{[\s\S]*\})\s*;?\s*$/);

        if (!match) {
          results.push({ id: essayId, status: 'failed', reason: 'Could not parse essay object' });
          continue;
        }

        // Parse the JavaScript object
        let essayData;
        try {
          const evalFunc = new Function('return (' + match[2] + ')');
          essayData = evalFunc();
        } catch (parseError) {
          results.push({ id: essayId, status: 'failed', reason: 'Parse error: ' + parseError.message });
          continue;
        }

        // Add metadata
        essayData.id = essayId;
        essayData.migratedAt = new Date().toISOString();
        essayData.migratedFrom = 'static-js-file';
        essayData.isCustom = false; // Mark as system essay, not user-created
        essayData.createdAt = new Date().toISOString();

        // Save to database
        await essaysStore.setJSON(essayId, essayData);
        results.push({ id: essayId, status: 'migrated' });

      } catch (err) {
        results.push({ id: essayId, status: 'error', reason: err.message });
      }
    }

    const migrated = results.filter(r => r.status === 'migrated').length;
    const skipped = results.filter(r => r.status === 'skipped').length;
    const failed = results.filter(r => r.status === 'failed' || r.status === 'error').length;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        summary: { migrated, skipped, failed, total: STATIC_ESSAYS.length },
        results
      }, null, 2)
    };

  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message })
    };
  }
};

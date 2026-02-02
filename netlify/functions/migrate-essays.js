// One-time migration function to move static essays to database
// Run this once via: /.netlify/functions/migrate-essays?key=YOUR_MIGRATION_KEY
// After migration, this function can be deleted

const { getStore, connectLambda } = require("@netlify/blobs");
const fs = require('fs');
const path = require('path');

// Static essay data - extracted from the JS files
// This avoids needing to parse JavaScript at runtime
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

    for (const essayId of STATIC_ESSAYS) {
      try {
        // Read the JS file
        const filePath = path.join(process.cwd(), `${essayId}.js`);

        if (!fs.existsSync(filePath)) {
          results.push({ id: essayId, status: 'skipped', reason: 'File not found' });
          continue;
        }

        const fileContent = fs.readFileSync(filePath, 'utf8');

        // Extract the essay object using regex
        const match = fileContent.match(/window\.ESSAYS\s*\[\s*['"]([^'"]+)['"]\s*\]\s*=\s*(\{[\s\S]*\})\s*;?\s*$/);

        if (!match) {
          results.push({ id: essayId, status: 'failed', reason: 'Could not parse essay object' });
          continue;
        }

        // Parse the JavaScript object
        // We need to handle template literals, so we'll use Function constructor
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

        // Check if already exists
        const existing = await essaysStore.get(essayId, { type: 'json' }).catch(() => null);
        if (existing) {
          results.push({ id: essayId, status: 'skipped', reason: 'Already exists in database' });
          continue;
        }

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

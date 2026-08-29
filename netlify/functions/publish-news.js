/**
 * publish-news.js — POST /.netlify/functions/publish-news  (alias /api/news-publish)
 *
 * Triggers a production rebuild via the village's Netlify build hook so
 * freshly published Notion news appears on the site.
 *
 * Multi-village: the hook is resolved from the VF Villages registry
 * ("News Build Hook" property). Smiths Lake falls back to the
 * NEWS_BUILD_HOOK_URL env var, so the original setup keeps working.
 *
 * Body (optional): { village: "Smiths Lake" }
 */

import { getVillageRecord } from './_villages.js';
import { requireRole } from './_auth.js';

export const handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'POST only' }) };
  }

  let village = process.env.VILLAGE_NAME || 'Smiths Lake';
  try {
    const body = JSON.parse(event.body || '{}');
    if (body.village) village = body.village;
  } catch (_) { /* empty body is fine */ }

  // Publishing rebuilds the live site — gate it to the village's admins/stewards
  // (server-side, via the verified Identity JWT). Prevents anonymous rebuild abuse.
  const auth = requireRole(context, { village, anyOf: ['admin', 'steward'] });
  if (!auth.ok) {
    return { statusCode: auth.status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: auth.error }) };
  }

  let hookUrl = null;
  try {
    const rec = await getVillageRecord(village);
    hookUrl = rec.newsBuildHook;
  } catch (_) { /* fall through to env */ }
  if (!hookUrl && village === (process.env.VILLAGE_NAME || 'Smiths Lake')) hookUrl = process.env.NEWS_BUILD_HOOK_URL;

  if (!hookUrl) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: `Publishing isn't set up for ${village} yet (no build hook in the Villages registry).` }),
    };
  }

  try {
    const res = await fetch(hookUrl, { method: 'POST' });
    if (!res.ok) throw new Error(`Hook responded ${res.status}`);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, message: 'Rebuild started — the site will update in a few minutes.' }),
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: `Could not trigger rebuild: ${err.message}` }),
    };
  }
};

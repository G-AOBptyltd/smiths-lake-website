/**
 * profile-admin.js — the Village Profile endpoint (community resilience profile).
 *
 * GET  /api/profile-admin?village=            → { profile, version, updatedBy } (admin | steward)
 * POST /api/profile-admin { village?, action:'save', data, version? }           (admin | steward)
 *
 * One row per village in the "📇 VF Village Profiles" Notion DB; the whole
 * profile (fields, checks, hazard ratings, tables — Tier 1 aggregate data
 * only) is stored as JSON chunked into the "Data" rich_text property.
 * DB resolution: NOTION_VF_PROFILES_DB_ID env var → Notion search by title →
 * auto-create next to the Contributions DB.
 */

import { requireRole } from './_auth.js';

const NOTION_VERSION = '2022-06-28';
const DB_TITLE = '📇 VF Village Profiles';
const CONTRIB_DB_ID = process.env.NOTION_CONTRIB_DB_ID || '6d182a0d4f0c42c2879f13753e355861';
const MAX_JSON = 150000;   // chunk budget: 90 chunks × 1900 chars

function nh() {
  return { Authorization: `Bearer ${process.env.NOTION_API_KEY}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' };
}
function jsonResp(statusCode, obj) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}
function rtChunks(s) {
  const out = [];
  s = String(s || '');
  for (let i = 0; i < s.length && out.length < 90; i += 1900) out.push({ text: { content: s.slice(i, i + 1900) } });
  return out;
}
const rtJoin = (arr) => (arr || []).map((t) => t.plain_text).join('');

let cachedDbId = process.env.NOTION_VF_PROFILES_DB_ID || null;

async function findDbByTitle() {
  const res = await fetch('https://api.notion.com/v1/search', {
    method: 'POST', headers: nh(),
    body: JSON.stringify({ query: 'VF Village Profiles', filter: { property: 'object', value: 'database' }, page_size: 20 }),
  });
  if (!res.ok) return null;
  const hits = (await res.json()).results || [];
  const hit = hits.find((d) => ((d.title || []).map((t) => t.plain_text).join('') === DB_TITLE) && !d.archived);
  return hit ? hit.id : null;
}

async function createDb() {
  const pRes = await fetch(`https://api.notion.com/v1/databases/${CONTRIB_DB_ID}`, { headers: nh() });
  if (!pRes.ok) throw new Error('Could not resolve a parent page for the Village Profiles register');
  const parent = (await pRes.json()).parent || {};
  if (parent.type !== 'page_id') throw new Error('Contributions DB has no page parent — set NOTION_VF_PROFILES_DB_ID instead');
  const res = await fetch('https://api.notion.com/v1/databases', {
    method: 'POST', headers: nh(),
    body: JSON.stringify({
      parent: { type: 'page_id', page_id: parent.page_id },
      title: [{ text: { content: DB_TITLE } }],
      properties: {
        'Village': { title: {} },
        'Data': { rich_text: {} },
        'Version': { rich_text: {} },
        'Updated By': { rich_text: {} },
      },
    }),
  });
  if (!res.ok) throw new Error(`Could not create the Village Profiles register (Notion ${res.status})`);
  return (await res.json()).id;
}

async function profilesDbId() {
  if (cachedDbId) return cachedDbId;
  cachedDbId = await findDbByTitle();
  if (!cachedDbId) cachedDbId = await createDb();
  return cachedDbId;
}

async function getVillageRow(dbId, village) {
  const res = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
    method: 'POST', headers: nh(),
    body: JSON.stringify({ filter: { property: 'Village', title: { equals: village } }, page_size: 1 }),
  });
  if (!res.ok) throw new Error(`Notion responded ${res.status}`);
  return ((await res.json()).results || [])[0] || null;
}

export const handler = async (event, context) => {
  // ── LOAD ──
  if (event.httpMethod === 'GET') {
    const village = event.queryStringParameters?.village || 'Smiths Lake';
    const auth = requireRole(context, { village, anyOf: ['admin', 'steward'] });
    if (!auth.ok) return jsonResp(auth.status, { error: auth.error });
    try {
      const dbId = await profilesDbId();
      const row = await getVillageRow(dbId, village);
      if (!row) return jsonResp(200, { profile: null });
      let profile = null;
      try { profile = JSON.parse(rtJoin(row.properties['Data']?.rich_text)); } catch (_) { /* corrupt/empty → null */ }
      return jsonResp(200, {
        profile,
        version: rtJoin(row.properties['Version']?.rich_text),
        updatedBy: rtJoin(row.properties['Updated By']?.rich_text),
      });
    } catch (err) {
      return jsonResp(502, { error: err.message });
    }
  }

  if (event.httpMethod !== 'POST') return jsonResp(405, { error: 'GET or POST only' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch {
    return jsonResp(400, { error: 'Invalid JSON' });
  }

  const village = body.village || 'Smiths Lake';
  const auth = requireRole(context, { village, anyOf: ['admin', 'steward'] });
  if (!auth.ok) return jsonResp(auth.status, { error: auth.error });

  if (body.action !== 'save') return jsonResp(400, { error: 'Unknown action' });
  if (!body.data || typeof body.data !== 'object') return jsonResp(400, { error: 'Missing profile data' });
  const json = JSON.stringify(body.data);
  if (json.length > MAX_JSON) return jsonResp(400, { error: 'Profile too large — trim long free-text entries' });

  try {
    const dbId = await profilesDbId();
    const properties = {
      'Village': { title: [{ text: { content: village.slice(0, 100) } }] },
      'Data': { rich_text: rtChunks(json) },
      'Version': { rich_text: rtChunks((body.version || '').trim().slice(0, 200)) },
      'Updated By': { rich_text: rtChunks(`${auth.user.email || 'admin'} · ${new Date().toISOString().slice(0, 10)}`) },
    };
    const row = await getVillageRow(dbId, village);
    const res = row
      ? await fetch(`https://api.notion.com/v1/pages/${row.id}`, { method: 'PATCH', headers: nh(), body: JSON.stringify({ properties }) })
      : await fetch('https://api.notion.com/v1/pages', {
          method: 'POST', headers: nh(),
          body: JSON.stringify({ parent: { database_id: dbId }, properties }),
        });
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`Notion responded ${res.status}: ${detail.slice(0, 200)}`);
    }
    return jsonResp(200, { ok: true });
  } catch (err) {
    return jsonResp(502, { error: err.message });
  }
};

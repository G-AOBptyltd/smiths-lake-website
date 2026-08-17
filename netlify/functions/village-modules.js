/**
 * village-modules.js — POST /api/village-modules   (village admin)
 *
 * The admin-hub "Public page ON/OFF" toggle for gated modules (events,
 * bookings). Body: { village?, module, public: true|false }
 *
 * Flips the module in the village's "Public Modules" multi-select on the VF
 * Villages registry. OFF = the module's public pages show a friendly
 * "not switched on yet" notice and its public APIs refuse writes; the admin
 * console keeps working either way.
 */

import { requireRole } from './_auth.js';

const NOTION_VERSION = '2022-06-28';
const VILLAGES_DB_ID = process.env.NOTION_VF_VILLAGES_DB_ID || '2c6272ccd9174103a077087c5de250d0';
const TOGGLABLE = ['events', 'bookings'];

function nh() {
  return { Authorization: `Bearer ${process.env.NOTION_API_KEY}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' };
}

function resp(statusCode, obj) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}

export const handler = async (event, context) => {
  if (event.httpMethod !== 'POST') return resp(405, { error: 'POST only' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch {
    return resp(400, { error: 'Invalid JSON' });
  }

  const village = body.village || 'Smiths Lake';
  const auth = requireRole(context, { village, anyOf: ['admin'] });
  if (!auth.ok) return resp(auth.status, { error: auth.error });

  const module = String(body.module || '');
  if (!TOGGLABLE.includes(module)) return resp(400, { error: 'That module has no public toggle' });
  const makePublic = body.public === true || body.public === 'true';

  try {
    const q = await fetch(`https://api.notion.com/v1/databases/${VILLAGES_DB_ID}/query`, {
      method: 'POST', headers: nh(),
      body: JSON.stringify({ filter: { property: 'Village Name', title: { equals: village } }, page_size: 1 }),
    });
    if (!q.ok) throw new Error(`Notion responded ${q.status}`);
    const row = ((await q.json()).results || [])[0];
    if (!row) return resp(404, { error: `${village} is not in the Villages registry` });

    const current = (row.properties['Public Modules']?.multi_select || []).map((o) => o.name);
    const next = makePublic
      ? [...new Set([...current, module])]
      : current.filter((m) => m !== module);

    const u = await fetch(`https://api.notion.com/v1/pages/${row.id}`, {
      method: 'PATCH', headers: nh(),
      body: JSON.stringify({ properties: { 'Public Modules': { multi_select: next.map((m) => ({ name: m })) } } }),
    });
    if (!u.ok) throw new Error(`Notion responded ${u.status}`);
    return resp(200, { ok: true, publicModules: next });
  } catch (err) {
    return resp(502, { error: err.message });
  }
};

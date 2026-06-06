/**
 * village-remove.js — POST /api/village-remove  (super-admin)
 *
 * Deletes a village. Guardrails: the village must be ARCHIVED and have no
 * surveys. Removes the VF Surveys "Village" option and archives the VF Villages
 * row. The double-confirmation is enforced client-side.
 *
 * Body: { village }
 */

import { requireRole } from './_auth.js';

const NOTION_VERSION = '2022-06-28';
const SURVEYS_DB_ID = process.env.NOTION_VF_SURVEYS_DB_ID || 'dd226ceaec144baaac9fddc63a767596';
const VILLAGES_DB_ID = process.env.NOTION_VF_VILLAGES_DB_ID || '2c6272ccd9174103a077087c5de250d0';

function nh() {
  return { Authorization: `Bearer ${process.env.NOTION_API_KEY}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' };
}

export const handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors() };
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  const auth = requireRole(context, { anyOf: ['super-admin'] });
  if (!auth.ok) return resp(auth.status, { error: auth.error });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_) { return resp(400, { error: 'Invalid JSON' }); }
  const village = (body.village || '').trim();
  if (!village) return resp(400, { error: 'Missing village name' });

  try {
    // 1. Village must exist and be archived.
    const vq = await fetch(`https://api.notion.com/v1/databases/${VILLAGES_DB_ID}/query`, {
      method: 'POST', headers: nh(), body: JSON.stringify({ filter: { property: 'Village Name', title: { equals: village } }, page_size: 1 }),
    });
    const vpage = vq.ok ? ((await vq.json()).results || [])[0] : null;
    if (!vpage) return resp(404, { error: 'Village not found' });
    if ((vpage.properties['Status']?.select?.name || '') !== 'archived') {
      return resp(409, { error: 'Archive the village first, then delete it.' });
    }

    // 2. Must have no surveys.
    const sq = await fetch(`https://api.notion.com/v1/databases/${SURVEYS_DB_ID}/query`, {
      method: 'POST', headers: nh(), body: JSON.stringify({ filter: { property: 'Village', select: { equals: village } }, page_size: 1 }),
    });
    if (sq.ok && ((await sq.json()).results || []).length > 0) {
      return resp(409, { error: `"${village}" still has surveys. Delete them first.` });
    }

    // 3. Remove the Village select option from VF Surveys.
    const dbRes = await fetch(`https://api.notion.com/v1/databases/${SURVEYS_DB_ID}`, { headers: nh() });
    if (dbRes.ok) {
      const db = await dbRes.json();
      const opts = db.properties?.['Village']?.select?.options || [];
      const remaining = opts.filter(o => o.name !== village);
      if (remaining.length && remaining.length !== opts.length) {
        await fetch(`https://api.notion.com/v1/databases/${SURVEYS_DB_ID}`, {
          method: 'PATCH', headers: nh(),
          body: JSON.stringify({ properties: { Village: { select: { options: remaining.map(o => ({ id: o.id, name: o.name })) } } } }),
        });
      }
    }

    // 4. Archive the VF Villages row.
    await fetch(`https://api.notion.com/v1/pages/${vpage.id}`, { method: 'PATCH', headers: nh(), body: JSON.stringify({ archived: true }) });
    return resp(200, { success: true });
  } catch (e) {
    console.error('village-remove error:', e);
    return resp(500, { error: 'Internal error' });
  }
};

function resp(statusCode, obj) { return { statusCode, headers: cors(), body: JSON.stringify(obj) }; }
function cors() { return { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' }; }

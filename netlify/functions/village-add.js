/**
 * village-add.js — POST /api/village-add
 *
 * Adds a new option to the VF Surveys "Village" select. Super-admin only.
 * Body: { village }
 */

import { requireRole } from './_auth.js';

const NOTION_VERSION = '2022-06-28';
const DB_ID = process.env.NOTION_VF_SURVEYS_DB_ID || 'dd226ceaec144baaac9fddc63a767596';

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
  const name = (body.village || '').trim();
  if (!name) return resp(400, { error: 'Missing village name' });

  try {
    const dbRes = await fetch(`https://api.notion.com/v1/databases/${DB_ID}`, { headers: nh() });
    if (!dbRes.ok) return resp(502, { error: 'Failed to read database' });
    const db = await dbRes.json();
    const opts = db.properties?.['Village']?.select?.options || [];
    if (opts.some(o => o.name.toLowerCase() === name.toLowerCase())) return resp(200, { success: true, message: 'Village already exists' });

    const newOpts = [...opts.map(o => ({ id: o.id, name: o.name })), { name }];
    const patch = await fetch(`https://api.notion.com/v1/databases/${DB_ID}`, {
      method: 'PATCH', headers: nh(),
      body: JSON.stringify({ properties: { Village: { select: { options: newOpts } } } }),
    });
    if (!patch.ok) { const t = await patch.text(); console.error('village-add error:', t); return resp(502, { error: 'Failed to add village' }); }
    return resp(200, { success: true });
  } catch (e) {
    console.error('village-add error:', e);
    return resp(500, { error: 'Internal error' });
  }
};

function resp(statusCode, obj) { return { statusCode, headers: cors(), body: JSON.stringify(obj) }; }
function cors() { return { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' }; }

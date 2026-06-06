/**
 * village-status.js — POST /api/village-status  (super-admin)
 * Sets a village's lifecycle status in the VF Villages DB.
 * Body: { village, status }   status ∈ live | suspended | archived
 */

import { requireRole } from './_auth.js';

const NOTION_VERSION = '2022-06-28';
const VILLAGES_DB_ID = process.env.NOTION_VF_VILLAGES_DB_ID || '2c6272ccd9174103a077087c5de250d0';
const VALID = ['live', 'suspended', 'archived'];

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
  const status = (body.status || '').trim().toLowerCase();
  if (!village || !VALID.includes(status)) return resp(400, { error: 'Missing village or invalid status' });

  try {
    const q = await fetch(`https://api.notion.com/v1/databases/${VILLAGES_DB_ID}/query`, {
      method: 'POST', headers: nh(), body: JSON.stringify({ filter: { property: 'Village Name', title: { equals: village } }, page_size: 1 }),
    });
    if (!q.ok) return resp(502, { error: 'Failed to read villages' });
    const page = ((await q.json()).results || [])[0];
    if (!page) return resp(404, { error: 'Village not found' });

    const patch = await fetch(`https://api.notion.com/v1/pages/${page.id}`, {
      method: 'PATCH', headers: nh(), body: JSON.stringify({ properties: { Status: { select: { name: status } } } }),
    });
    if (!patch.ok) { const t = await patch.text(); console.error('village-status error:', t); return resp(502, { error: 'Failed to update status' }); }
    return resp(200, { success: true, status });
  } catch (e) {
    console.error('village-status error:', e);
    return resp(500, { error: 'Internal error' });
  }
};

function resp(statusCode, obj) { return { statusCode, headers: cors(), body: JSON.stringify(obj) }; }
function cors() { return { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' }; }

/**
 * village-add.js — POST /api/village-add  (super-admin)
 * Creates a VF Villages row (status=live) AND adds the name as a Village select
 * option on VF Surveys (so surveys can be tagged to it).
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
  const name = (body.village || '').trim();
  if (!name) return resp(400, { error: 'Missing village name' });

  try {
    // 1. VF Surveys Village select option (for tagging)
    const dbRes = await fetch(`https://api.notion.com/v1/databases/${SURVEYS_DB_ID}`, { headers: nh() });
    if (dbRes.ok) {
      const db = await dbRes.json();
      const opts = db.properties?.['Village']?.select?.options || [];
      if (!opts.some(o => o.name.toLowerCase() === name.toLowerCase())) {
        await fetch(`https://api.notion.com/v1/databases/${SURVEYS_DB_ID}`, {
          method: 'PATCH', headers: nh(),
          body: JSON.stringify({ properties: { Village: { select: { options: [...opts.map(o => ({ id: o.id, name: o.name })), { name }] } } } }),
        });
      }
    }

    // 2. VF Villages row (metadata + status)
    const q = await fetch(`https://api.notion.com/v1/databases/${VILLAGES_DB_ID}/query`, {
      method: 'POST', headers: nh(), body: JSON.stringify({ filter: { property: 'Village Name', title: { equals: name } }, page_size: 1 }),
    });
    const existing = q.ok ? ((await q.json()).results || []) : [];
    if (!existing.length) {
      await fetch('https://api.notion.com/v1/pages', {
        method: 'POST', headers: nh(),
        body: JSON.stringify({ parent: { database_id: VILLAGES_DB_ID }, properties: { 'Village Name': { title: [{ text: { content: name } }] }, 'Status': { select: { name: 'live' } } } }),
      });
    }
    return resp(200, { success: true });
  } catch (e) {
    console.error('village-add error:', e);
    return resp(500, { error: 'Internal error' });
  }
};

function resp(statusCode, obj) { return { statusCode, headers: cors(), body: JSON.stringify(obj) }; }
function cors() { return { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' }; }

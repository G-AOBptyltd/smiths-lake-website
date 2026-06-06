/**
 * village-list.js — GET /api/village-list
 *
 * Returns villages (from the VF Villages DB) with their lifecycle status, scoped
 * to what the signed-in admin can access. Super-admin / allowlisted sees all.
 *
 * Response: { villages: [{ name, status }] }
 */

import { getIdentityUser, getRoles, villageKey } from './_auth.js';

const NOTION_VERSION = '2022-06-28';
const VILLAGES_DB_ID = process.env.NOTION_VF_VILLAGES_DB_ID || '2c6272ccd9174103a077087c5de250d0';

function nh() {
  return { Authorization: `Bearer ${process.env.NOTION_API_KEY}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' };
}
function isSuper(user) {
  if (getRoles(user).includes('super-admin')) return true;
  const email = (user?.email || '').toLowerCase();
  const allowed = (process.env.SURVEY_ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  return !!email && allowed.includes(email);
}

export const handler = async (event, context) => {
  if (event.httpMethod !== 'GET') return { statusCode: 405, body: 'Method Not Allowed' };
  try {
    const res = await fetch(`https://api.notion.com/v1/databases/${VILLAGES_DB_ID}/query`, {
      method: 'POST', headers: nh(), body: JSON.stringify({ sorts: [{ timestamp: 'created_time', direction: 'ascending' }] }),
    });
    if (!res.ok) return resp(502, { error: 'Failed to load villages' });
    const data = await res.json();
    let villages = (data.results || []).map(p => ({
      name: p.properties['Village Name']?.title?.[0]?.plain_text || '',
      status: p.properties['Status']?.select?.name || 'live',
    })).filter(v => v.name);

    const user = getIdentityUser(context);
    if (user && !isSuper(user)) {
      const keys = new Set(getRoles(user).map(r => r.includes(':') ? r.slice(0, r.lastIndexOf(':')) : '').filter(Boolean));
      const scoped = villages.filter(v => keys.has(villageKey(v.name)));
      if (scoped.length) villages = scoped;
    }
    if (!villages.length) villages = [{ name: 'Smiths Lake', status: 'live' }];
    return resp(200, { villages });
  } catch (e) {
    console.error('village-list error:', e);
    return resp(500, { error: 'Internal error' });
  }
};

function resp(statusCode, obj) {
  return { statusCode, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' }, body: JSON.stringify(obj) };
}

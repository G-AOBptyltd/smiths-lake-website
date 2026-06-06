/**
 * village-list.js — GET /api/village-list
 *
 * Returns the villages the signed-in admin can access (for the village switcher).
 * Super-admin (or an allowlisted email) sees all; others see only villages where
 * they hold a role. Villages are the options of the VF Surveys "Village" select.
 *
 * Response: { villages: [name], all: [name] }
 */

import { getIdentityUser, getRoles, villageKey } from './_auth.js';

const NOTION_VERSION = '2022-06-28';
const DB_ID = process.env.NOTION_VF_SURVEYS_DB_ID || 'dd226ceaec144baaac9fddc63a767596';

function nh() {
  return { Authorization: `Bearer ${process.env.NOTION_API_KEY}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' };
}

function isSuper(user) {
  const roles = getRoles(user);
  if (roles.includes('super-admin')) return true;
  const email = (user?.email || '').toLowerCase();
  const allowed = (process.env.SURVEY_ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  return !!email && allowed.includes(email);
}

export const handler = async (event, context) => {
  if (event.httpMethod !== 'GET') return { statusCode: 405, body: 'Method Not Allowed' };
  try {
    const res = await fetch(`https://api.notion.com/v1/databases/${DB_ID}`, { headers: nh() });
    if (!res.ok) return resp(502, { error: 'Failed to load villages' });
    const db = await res.json();
    const all = (db.properties?.['Village']?.select?.options || []).map(o => o.name);

    const user = getIdentityUser(context);
    let villages = all;
    if (user && !isSuper(user)) {
      const roles = getRoles(user);
      const myKeys = new Set(roles.map(r => r.includes(':') ? r.slice(0, r.lastIndexOf(':')) : '').filter(Boolean));
      villages = all.filter(v => myKeys.has(villageKey(v)));
      if (!villages.length) villages = all; // fail-open to avoid an empty switcher
    }
    return resp(200, { villages, all });
  } catch (e) {
    console.error('village-list error:', e);
    return resp(500, { error: 'Internal error' });
  }
};

function resp(statusCode, obj) {
  return { statusCode, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' }, body: JSON.stringify(obj) };
}

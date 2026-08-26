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

// Fallback: derive villages from the VF Surveys "Village" select options when the
// VF Villages DB can't be read (e.g. the integration isn't connected to it yet).
// Everything defaults to status 'live' so the admin keeps working.
async function villagesFromSurveys() {
  try {
    const r = await fetch(`https://api.notion.com/v1/databases/${process.env.NOTION_VF_SURVEYS_DB_ID || 'dd226ceaec144baaac9fddc63a767596'}`, { headers: nh() });
    if (!r.ok) return [];
    const db = await r.json();
    const opts = db.properties?.['Village']?.select?.options || [];
    return opts.map(o => ({ name: o.name, status: 'live' })).filter(v => v.name);
  } catch (_) { return []; }
}

export const handler = async (event, context) => {
  if (event.httpMethod !== 'GET') return { statusCode: 405, body: 'Method Not Allowed' };
  try {
    let villages = [];
    let warning;
    const res = await fetch(`https://api.notion.com/v1/databases/${VILLAGES_DB_ID}/query`, {
      method: 'POST', headers: nh(), body: JSON.stringify({ sorts: [{ timestamp: 'created_time', direction: 'ascending' }] }),
    });
    if (res.ok) {
      const data = await res.json();
      villages = (data.results || []).map(p => ({
        name: p.properties['Village Name']?.title?.[0]?.plain_text || '',
        status: p.properties['Status']?.select?.name || 'live',
        // Gated modules (events/bookings) whose PUBLIC pages this village has
        // switched on via the admin-hub toggle.
        publicModules: (p.properties['Public Modules']?.multi_select || []).map(o => o.name),
        // Modules a super-admin has switched OFF for this village (portal
        // tile ids). Absent property = empty = every module on (fail-open).
        disabledModules: (p.properties['Disabled Modules']?.multi_select || []).map(o => o.name),
        // Village1st package (foundation | interactive | complete).
        // Absent = 'complete' (fail-open for pre-package villages).
        package: (p.properties['Package']?.select?.name || 'complete').toLowerCase(),
      })).filter(v => v.name);
    } else {
      // VF Villages unreadable — fail open to the survey tags so the admin still loads.
      warning = 'villages-db-unreadable';
      villages = await villagesFromSurveys();
    }

    const user = getIdentityUser(context);
    if (user && !isSuper(user)) {
      const keys = new Set(getRoles(user).map(r => r.includes(':') ? r.slice(0, r.lastIndexOf(':')) : '').filter(Boolean));
      const scoped = villages.filter(v => keys.has(villageKey(v.name)));
      if (scoped.length) villages = scoped;
    }
    if (!villages.length) villages = [{ name: 'Smiths Lake', status: 'live' }];
    return resp(200, warning ? { villages, warning } : { villages });
  } catch (e) {
    console.error('village-list error:', e);
    // Last-resort fail-open so the switcher never blanks the whole admin.
    let villages = await villagesFromSurveys();
    if (!villages.length) villages = [{ name: 'Smiths Lake', status: 'live' }];
    return resp(200, { villages, warning: 'villages-list-error' });
  }
};

function resp(statusCode, obj) {
  return { statusCode, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' }, body: JSON.stringify(obj) };
}

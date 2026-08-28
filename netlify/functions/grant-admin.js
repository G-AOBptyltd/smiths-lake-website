/**
 * grant-admin.js — the Grant Portal endpoint (grant application pipeline).
 *
 * GET  /api/grant-admin?village=                → { grants }     (admin | treasurer)
 * POST /api/grant-admin { village?, action, ... }                (admin | treasurer)
 *   save    { pageId?, name, funder?, program?, amountRequested?, amountAwarded?,
 *             dueDate?, submittedDate?, outcomeDate?, project?, owner?, notes? }
 *   status  { pageId, status }   Researching | Drafting | Submitted |
 *                                Successful | Unsuccessful | Withdrawn
 *   delete  { pageId }           village ADMIN only (Notion trash)
 *
 * Storage: "🏆 VF Grants" Notion DB. Resolution order:
 *   1. NOTION_VF_GRANTS_DB_ID env var
 *   2. Notion search for a database titled "🏆 VF Grants"
 *   3. Auto-create it under the same parent page as the Contributions DB
 * The resolved ID is cached for the life of the function instance.
 */

import { requireRole } from './_auth.js';

const NOTION_VERSION = '2022-06-28';
const DB_TITLE = '🏆 VF Grants';
const CONTRIB_DB_ID = process.env.NOTION_CONTRIB_DB_ID || '6d182a0d4f0c42c2879f13753e355861';
export const GRANT_STATUSES = ['Researching', 'Drafting', 'Submitted', 'Successful', 'Unsuccessful', 'Withdrawn'];

function nh() {
  return { Authorization: `Bearer ${process.env.NOTION_API_KEY}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' };
}
function jsonResp(statusCode, obj) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}
// Notion rich_text values cap at 2000 chars per item — chunk long strings.
function rtChunks(s) {
  const out = [];
  s = String(s || '');
  for (let i = 0; i < s.length && out.length < 90; i += 1900) out.push({ text: { content: s.slice(i, i + 1900) } });
  return out;
}
const rtJoin = (arr) => (arr || []).map((t) => t.plain_text).join('');

// ── DB resolution (env → search → create) ─────────────────────────
let cachedDbId = process.env.NOTION_VF_GRANTS_DB_ID || null;

async function findDbByTitle() {
  const res = await fetch('https://api.notion.com/v1/search', {
    method: 'POST', headers: nh(),
    body: JSON.stringify({ query: 'VF Grants', filter: { property: 'object', value: 'database' }, page_size: 20 }),
  });
  if (!res.ok) return null;
  const hits = (await res.json()).results || [];
  const hit = hits.find((d) => ((d.title || []).map((t) => t.plain_text).join('') === DB_TITLE) && !d.archived);
  return hit ? hit.id : null;
}

async function parentPageOfContribDb() {
  const res = await fetch(`https://api.notion.com/v1/databases/${CONTRIB_DB_ID}`, { headers: nh() });
  if (!res.ok) throw new Error('Could not resolve a parent page for the Grants register');
  const parent = (await res.json()).parent || {};
  if (parent.type === 'page_id') return parent.page_id;
  throw new Error('Contributions DB has no page parent — set NOTION_VF_GRANTS_DB_ID instead');
}

async function createDb() {
  const parentId = await parentPageOfContribDb();
  const res = await fetch('https://api.notion.com/v1/databases', {
    method: 'POST', headers: nh(),
    body: JSON.stringify({
      parent: { type: 'page_id', page_id: parentId },
      title: [{ text: { content: DB_TITLE } }],
      properties: {
        'Grant': { title: {} },
        'Village': { rich_text: {} },
        'Funder': { rich_text: {} },
        'Program': { rich_text: {} },
        'Status': { select: { options: GRANT_STATUSES.map((s) => ({ name: s })) } },
        'Amount Requested': { number: { format: 'australian_dollar' } },
        'Amount Awarded': { number: { format: 'australian_dollar' } },
        'Due Date': { date: {} },
        'Submitted Date': { date: {} },
        'Outcome Date': { date: {} },
        'Project': { rich_text: {} },
        'Owner': { rich_text: {} },
        'Notes': { rich_text: {} },
        'Logged By': { rich_text: {} },
        'Last Updated By': { rich_text: {} },
      },
    }),
  });
  if (!res.ok) throw new Error(`Could not create the Grants register (Notion ${res.status})`);
  return (await res.json()).id;
}

async function grantsDbId() {
  if (cachedDbId) return cachedDbId;
  cachedDbId = await findDbByTitle();
  if (!cachedDbId) cachedDbId = await createDb();
  return cachedDbId;
}

// ── Row helpers ───────────────────────────────────────────────────
function parseGrant(p) {
  const props = p.properties || {};
  return {
    id: p.id,
    name: rtJoin(props['Grant']?.title),
    village: rtJoin(props['Village']?.rich_text),
    funder: rtJoin(props['Funder']?.rich_text),
    program: rtJoin(props['Program']?.rich_text),
    status: props['Status']?.select?.name || 'Researching',
    amountRequested: props['Amount Requested']?.number ?? null,
    amountAwarded: props['Amount Awarded']?.number ?? null,
    dueDate: props['Due Date']?.date?.start || '',
    submittedDate: props['Submitted Date']?.date?.start || '',
    outcomeDate: props['Outcome Date']?.date?.start || '',
    project: rtJoin(props['Project']?.rich_text),
    owner: rtJoin(props['Owner']?.rich_text),
    notes: rtJoin(props['Notes']?.rich_text),
  };
}

async function getGrant(dbId, pageId) {
  if (!pageId) return null;
  const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, { headers: nh() });
  if (!res.ok) return null;
  const page = await res.json();
  if (page.archived || page.parent?.database_id?.replace(/-/g, '') !== dbId.replace(/-/g, '')) return null;
  return parseGrant(page);
}

export const handler = async (event, context) => {
  // ── LIST ──
  if (event.httpMethod === 'GET') {
    const village = event.queryStringParameters?.village || 'Smiths Lake';
    // pm may READ the grant pipeline (to link grants to projects); editing a
    // grant still requires admin/treasurer (POST below).
    const auth = requireRole(context, { village, anyOf: ['admin', 'treasurer', 'pm'] });
    if (!auth.ok) return jsonResp(auth.status, { error: auth.error });
    try {
      const dbId = await grantsDbId();
      const grants = [];
      let cursor;
      do {
        const res = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
          method: 'POST', headers: nh(),
          body: JSON.stringify({
            filter: { property: 'Village', rich_text: { equals: village } },
            sorts: [{ property: 'Due Date', direction: 'ascending' }],
            ...(cursor ? { start_cursor: cursor } : {}),
          }),
        });
        if (!res.ok) throw new Error(`Notion responded ${res.status}`);
        const data = await res.json();
        (data.results || []).forEach((p) => grants.push(parseGrant(p)));
        cursor = data.has_more ? data.next_cursor : null;
      } while (cursor);
      return jsonResp(200, { grants });
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
  const auth = requireRole(context, { village, anyOf: ['admin', 'treasurer'] });
  if (!auth.ok) return jsonResp(auth.status, { error: auth.error });
  const stamp = { 'Last Updated By': { rich_text: rtChunks(`${auth.user.email || 'admin'} · ${new Date().toISOString().slice(0, 10)}`) } };

  try {
    const dbId = await grantsDbId();

    if (body.action === 'save') {
      const name = (body.name || '').trim().slice(0, 200);
      if (!name) return jsonResp(400, { error: 'The grant application needs a name' });
      const num = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : null; };
      const dateOrNull = (v) => (v ? { date: { start: v } } : { date: null });
      const properties = {
        'Grant': { title: [{ text: { content: name } }] },
        'Village': { rich_text: rtChunks(village.slice(0, 100)) },
        'Funder': { rich_text: rtChunks((body.funder || '').trim().slice(0, 200)) },
        'Program': { rich_text: rtChunks((body.program || '').trim().slice(0, 200)) },
        'Amount Requested': { number: num(body.amountRequested) },
        'Amount Awarded': { number: num(body.amountAwarded) },
        'Due Date': dateOrNull(body.dueDate),
        'Submitted Date': dateOrNull(body.submittedDate),
        'Outcome Date': dateOrNull(body.outcomeDate),
        'Project': { rich_text: rtChunks((body.project || '').trim().slice(0, 200)) },
        'Owner': { rich_text: rtChunks((body.owner || '').trim().slice(0, 200)) },
        'Notes': { rich_text: rtChunks((body.notes || '').trim().slice(0, 4000)) },
        ...stamp,
      };
      let res;
      if (body.pageId) {
        const existing = await getGrant(dbId, body.pageId);
        if (!existing || existing.village !== village) return jsonResp(404, { error: 'Grant application not found' });
        res = await fetch(`https://api.notion.com/v1/pages/${body.pageId}`, {
          method: 'PATCH', headers: nh(), body: JSON.stringify({ properties }),
        });
      } else {
        properties['Status'] = { select: { name: 'Researching' } };
        properties['Logged By'] = { rich_text: rtChunks(auth.user.email || 'admin') };
        res = await fetch('https://api.notion.com/v1/pages', {
          method: 'POST', headers: nh(),
          body: JSON.stringify({ parent: { database_id: dbId }, properties }),
        });
      }
      if (!res.ok) {
        const detail = await res.text();
        throw new Error(`Notion responded ${res.status}: ${detail.slice(0, 200)}`);
      }
      return jsonResp(200, { ok: true, pageId: (await res.json()).id });
    }

    if (body.action === 'status') {
      if (!GRANT_STATUSES.includes(body.status)) return jsonResp(400, { error: 'Unknown status' });
      const existing = await getGrant(dbId, body.pageId);
      if (!existing || existing.village !== village) return jsonResp(404, { error: 'Grant application not found' });
      const props = { 'Status': { select: { name: body.status } }, ...stamp };
      // Stamp workflow dates the first time a stage is reached.
      const today = new Date().toISOString().slice(0, 10);
      if (body.status === 'Submitted' && !existing.submittedDate) props['Submitted Date'] = { date: { start: today } };
      if (['Successful', 'Unsuccessful'].includes(body.status) && !existing.outcomeDate) props['Outcome Date'] = { date: { start: today } };
      const res = await fetch(`https://api.notion.com/v1/pages/${body.pageId}`, {
        method: 'PATCH', headers: nh(), body: JSON.stringify({ properties: props }),
      });
      if (!res.ok) throw new Error(`Notion responded ${res.status}`);
      return jsonResp(200, { ok: true });
    }

    if (body.action === 'delete') {
      const adminOnly = requireRole(context, { village, anyOf: ['admin'] });
      if (!adminOnly.ok) return jsonResp(403, { error: 'Only a village admin can delete — use Withdrawn instead' });
      const existing = await getGrant(dbId, body.pageId);
      if (!existing || existing.village !== village) return jsonResp(404, { error: 'Grant application not found' });
      const res = await fetch(`https://api.notion.com/v1/pages/${body.pageId}`, {
        method: 'PATCH', headers: nh(), body: JSON.stringify({ archived: true }),
      });
      if (!res.ok) throw new Error(`Notion responded ${res.status}`);
      return jsonResp(200, { ok: true });
    }

    return jsonResp(400, { error: 'Unknown action' });
  } catch (err) {
    return jsonResp(502, { error: err.message });
  }
};

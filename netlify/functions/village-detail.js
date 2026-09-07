/**
 * village-detail.js — GET /api/village-detail?village=<name>   (admin)
 *                      POST /api/village-detail  { village, notes }  (admin)
 *
 * The super-admin "open a village" view: returns everything recorded about ONE
 * village in the VF Villages registry (2c6272cc…) — the same DB the onboarding
 * flow (village1st.com.au) writes applications into, and the same DB
 * /admin/#villages lists.
 *
 * The onboarding application submission is stored as the page BODY (a paragraph
 * summary) and the applicant's uploaded documents are FILE BLOCKS appended to
 * that page (see village1st-website/netlify/functions/upload.js). The villages
 * list only reads row properties, so those never surface there — this endpoint
 * reads the page body + child blocks so the admin can see the submission,
 * download the documents, and read/edit committee notes.
 *
 * GET  → { village: { name, status, package, publicModules, disabledModules,
 *                     moduleAccess, siteUrl, contentDbId, newsBuildHook,
 *                     notifyEmails, createdTime, lastEditedTime, notionUrl },
 *          application: { text }, documents: [{ name, url, expiry }],
 *          notes: "" }
 * POST → { success: true, notes }
 *
 * Auth: admin (super-admin passes for every village; a village-scoped admin
 * passes for their own village). Contains applicant PII — never public.
 *
 * Env: NOTION_API_KEY, NOTION_VF_VILLAGES_DB_ID (baked fallback).
 */

import { requireRole } from './_auth.js';

const NOTION_VERSION = '2022-06-28';
const VILLAGES_DB_ID = process.env.NOTION_VF_VILLAGES_DB_ID || '2c6272ccd9174103a077087c5de250d0';

function nh() {
  return { Authorization: `Bearer ${process.env.NOTION_API_KEY}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' };
}
const rt = (arr) => (arr || []).map((t) => t.plain_text != null ? t.plain_text : (t.text?.content || '')).join('');

// Find the single VF Villages row whose title matches `village`.
async function findVillage(village) {
  const q = await fetch(`https://api.notion.com/v1/databases/${VILLAGES_DB_ID}/query`, {
    method: 'POST', headers: nh(),
    body: JSON.stringify({ filter: { property: 'Village Name', title: { equals: village } }, page_size: 1 }),
  });
  if (!q.ok) return { error: 502 };
  const page = ((await q.json()).results || [])[0];
  return page ? { page } : { error: 404 };
}

export const handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors() };

  const method = event.httpMethod;
  if (method !== 'GET' && method !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  // Resolve the requested village first so the auth check can be village-scoped.
  let village;
  let notes;
  if (method === 'GET') {
    village = ((event.queryStringParameters || {}).village || '').trim();
  } else {
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch (_) { return resp(400, { error: 'Invalid JSON' }); }
    village = (body.village || '').trim();
    notes = String(body.notes == null ? '' : body.notes);
  }
  if (!village) return resp(400, { error: 'Missing village' });

  // Super-admin passes for every village; a <village>:admin passes for their own.
  const auth = requireRole(context, { village, anyOf: ['admin'] });
  if (!auth.ok) return resp(auth.status, { error: auth.error });

  try {
    const found = await findVillage(village);
    if (found.error === 502) return resp(502, { error: 'Failed to read villages' });
    if (found.error === 404 || !found.page) return resp(404, { error: 'Village not found' });
    const page = found.page;

    if (method === 'POST') {
      const patch = await fetch(`https://api.notion.com/v1/pages/${page.id}`, {
        method: 'PATCH', headers: nh(),
        body: JSON.stringify({ properties: { Notes: { rich_text: [{ text: { content: notes.slice(0, 1990) } }] } } }),
      });
      if (!patch.ok) { console.error('village-detail notes save:', patch.status, (await patch.text()).slice(0, 300)); return resp(502, { error: 'Failed to save notes' }); }
      return resp(200, { success: true, notes });
    }

    // GET — assemble the full view.
    const p = page.properties || {};
    const detail = {
      name: rt(p['Village Name']?.title) || village,
      status: p['Status']?.select?.name || 'live',
      package: (p['Package']?.select?.name || 'complete').toLowerCase(),
      publicModules: (p['Public Modules']?.multi_select || []).map((o) => o.name),
      disabledModules: (p['Disabled Modules']?.multi_select || []).map((o) => o.name),
      moduleAccess: (() => { try { const j = rt(p['Module Access']?.rich_text); return j ? JSON.parse(j) : null; } catch (_) { return null; } })(),
      siteUrl: rt(p['Site URL']?.rich_text) || p['Site URL']?.url || '',
      contentDbId: rt(p['Content DB ID']?.rich_text) || '',
      newsBuildHook: rt(p['News Build Hook']?.rich_text) || '',
      notifyEmails: rt(p['Notify Emails']?.rich_text) || '',
      createdTime: page.created_time || '',
      lastEditedTime: page.last_edited_time || '',
      notionUrl: page.url || '',
    };
    const notesText = rt(p['Notes']?.rich_text);

    // Page body: the application summary paragraph(s) + uploaded document file blocks.
    const appLines = [];
    const documents = [];
    let cursor;
    for (let guard = 0; guard < 10; guard++) {
      const url = `https://api.notion.com/v1/blocks/${page.id}/children?page_size=100` + (cursor ? `&start_cursor=${cursor}` : '');
      const br = await fetch(url, { headers: nh() });
      if (!br.ok) break;
      const bd = await br.json();
      for (const b of (bd.results || [])) {
        if (b.type === 'paragraph') { const t = rt(b.paragraph?.rich_text); if (t.trim()) appLines.push(t); }
        else if (b.type === 'heading_1' || b.type === 'heading_2' || b.type === 'heading_3') { const t = rt(b[b.type]?.rich_text); if (t.trim()) appLines.push(t); }
        else if (b.type === 'file') {
          const f = b.file || {};
          const name = rt(f.caption) || f.name || 'document';
          const url2 = f.type === 'external' ? (f.external?.url || '') : (f.file?.url || '');
          documents.push({ name, url: url2, expiry: f.file?.expiry_time || null });
        }
      }
      if (!bd.has_more) break;
      cursor = bd.next_cursor;
    }

    return resp(200, {
      village: detail,
      application: { text: appLines.join('\n') },
      documents,
      notes: notesText,
    });
  } catch (e) {
    console.error('village-detail error:', e);
    return resp(500, { error: 'Internal error' });
  }
};

function resp(statusCode, obj) { return { statusCode, headers: cors(), body: JSON.stringify(obj) }; }
function cors() { return { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' }; }

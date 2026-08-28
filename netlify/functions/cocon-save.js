/**
 * cocon-save.js — POST /api/cocon-save
 *
 * Upsert a record in the Co-Contribution module. One endpoint, three entities.
 * Body: {
 *   village?: string,                 // defaults "Smiths Lake"
 *   entity: 'project' | 'schedule' | 'budget',
 *   pageId?: string,                  // present = update (PATCH), absent = create
 *   ...fields (per entity, see below)
 * }
 *
 * project  : { name, slug, grantRequestAmount?, grantProgram?, notes?, status? }
 * schedule : { name, project(slug), order?, party?, description?, type?, value?, confirmed? }
 * budget   : { name, project(slug), order?, phase?, amount? }
 *
 * Auth: village admin / steward / super-admin.
 * Sensitivity: editing a project's `grantRequestAmount` requires VILLAGE ADMIN
 * (not steward) — the grant figure is commercially sensitive. Stewards may edit
 * every other field.
 */

import { requireRole } from './_auth.js';
import { ensureProjectSchema } from './_projects.js';

const NOTION_VERSION = '2022-06-28';
const PROJECTS_DB = process.env.NOTION_COCON_PROJECTS_DB_ID || '';
const SCHEDULE_DB = process.env.NOTION_COCON_SCHEDULE_DB_ID || '';
const BUDGET_DB = process.env.NOTION_COCON_BUDGET_DB_ID || '';

const PARTY = ['Community', 'External'];
const TYPES = [
  'Cash — Prior Investment', 'Cash — Fundraising',
  'WIK — Community Labour', 'WIK — Volunteer Labour',
  'WIK — Equipment', 'WIK — Materials',
];
const CONFIRMED = ['Yes — actual cost PAID', 'Yes — completed', 'Estimated', 'Committed', 'To confirm'];
const PROJECT_STATUS = ['Draft', 'Active', 'Submitted', 'Archived'];

function corsHeaders() {
  return { 'Content-Type': 'application/json' };
}
function notionHeaders() {
  return {
    Authorization: `Bearer ${process.env.NOTION_API_KEY}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  };
}
const title = (s) => ({ title: [{ text: { content: String(s || '').slice(0, 200) } }] });
const text = (s) => ({ rich_text: s ? [{ text: { content: String(s).slice(0, 2000) } }] : [] });
// Chunked rich_text for values that can exceed Notion's 2000-char-per-item cap
// (exec narrative, the linked-groups JSON blob).
const rtChunks = (s) => {
  const out = []; s = String(s || '');
  for (let i = 0; i < s.length && out.length < 90; i += 1900) out.push({ text: { content: s.slice(i, i + 1900) } });
  return { rich_text: out };
};
const pick = (list, v, fallback) => (list.includes(v) ? v : fallback);
const money = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

function buildProps(entity, body) {
  const village = body.village || 'Smiths Lake';
  if (entity === 'schedule') {
    return {
      DB: SCHEDULE_DB,
      properties: {
        'Name': title(body.name),
        'Project': text(body.project),
        'Village': text(village),
        'Order': { number: Number(body.order) || 0 },
        'Party': { select: { name: pick(PARTY, body.party, 'Community') } },
        'Description': text(body.description),
        'Type': body.type ? { select: { name: pick(TYPES, body.type, TYPES[0]) } } : { select: null },
        'Value': { number: money(body.value) },
        'Confirmed': body.confirmed ? { select: { name: pick(CONFIRMED, body.confirmed, 'To confirm') } } : { select: null },
        'Archived': { checkbox: false },
      },
    };
  }
  if (entity === 'budget') {
    return {
      DB: BUDGET_DB,
      properties: {
        'Name': title(body.name),
        'Project': text(body.project),
        'Village': text(village),
        'Order': { number: Number(body.order) || 0 },
        'Phase': text(body.phase),
        'Amount': { number: money(body.amount) },
        'Archived': { checkbox: false },
      },
    };
  }
  // project
  const properties = {
    'Name': title(body.name),
    'Slug': text(body.slug),
    'Village': text(village),
    'Grant Program': text(body.grantProgram),
    'Notes / Rate Card': text(body.notes),
    'Status': { select: { name: pick(PROJECT_STATUS, body.status, 'Draft') } },
  };
  // New Projects-SoR fields — only written when the caller supplies them, so the
  // existing Co-Contribution page (which doesn't send them) never blanks them.
  if (body.description !== undefined) properties['Description'] = rtChunks(body.description);
  if (body.lead !== undefined) properties['Lead'] = text(body.lead);
  if (body.execSummary !== undefined) properties['Exec Summary'] = rtChunks(body.execSummary);
  if (body.volunteerGroups !== undefined) {
    const groups = Array.isArray(body.volunteerGroups) ? body.volunteerGroups : [];
    properties['Volunteer Groups'] = rtChunks(JSON.stringify(groups));
  }
  if (body.hourRate !== undefined && body.hourRate !== '') {
    properties['Volunteer Hour Rate'] = { number: money(body.hourRate) };
  }
  // Two-way link to the public Project Hub content card.
  if (body.hubSlug !== undefined) properties['Hub Slug'] = text(body.hubSlug);
  if (body.publishToHub !== undefined) properties['Publish to Hub'] = { checkbox: body.publishToHub === true || body.publishToHub === 'true' };
  return { DB: PROJECTS_DB, properties };
}

export const handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders(), body: JSON.stringify({ error: 'POST only' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch {
    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const village = body.village || 'Smiths Lake';
  const entity = body.entity;
  if (!['project', 'schedule', 'budget'].includes(entity)) {
    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'entity must be project | schedule | budget' }) };
  }

  // Project Managers may manage projects, budgets and schedule lines; the
  // grant-request figure stays gated to admin/treasurer below.
  const auth = requireRole(context, { village, anyOf: ['admin', 'treasurer', 'pm'] });
  if (!auth.ok) {
    return { statusCode: auth.status, headers: corsHeaders(), body: JSON.stringify({ error: auth.error }) };
  }

  if (!(body.name || '').trim()) {
    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'A name is required' }) };
  }

  // Make sure the new project-level columns exist before we write to them.
  if (entity === 'project') await ensureProjectSchema();

  const { DB, properties } = buildProps(entity, body);
  if (!DB) {
    return { statusCode: 503, headers: corsHeaders(), body: JSON.stringify({ error: 'Co-Contribution databases not configured' }) };
  }

  // The grant-request figure is sensitive — only a village admin may write it.
  if (entity === 'project' && body.grantRequestAmount !== undefined && body.grantRequestAmount !== '') {
    const adminOnly = requireRole(context, { village, anyOf: ['admin', 'treasurer'] });
    if (!adminOnly.ok) {
      return { statusCode: 403, headers: corsHeaders(), body: JSON.stringify({ error: 'Only a Village Admin can set the grant request amount' }) };
    }
    properties['Grant Request Amount'] = { number: money(body.grantRequestAmount) };
  }

  try {
    let res;
    if (body.pageId) {
      res = await fetch(`https://api.notion.com/v1/pages/${body.pageId}`, {
        method: 'PATCH', headers: notionHeaders(), body: JSON.stringify({ properties }),
      });
    } else {
      res = await fetch('https://api.notion.com/v1/pages', {
        method: 'POST', headers: notionHeaders(),
        body: JSON.stringify({ parent: { database_id: DB }, properties }),
      });
    }
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`Notion responded ${res.status}: ${detail.slice(0, 200)}`);
    }
    const page = await res.json();
    return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ ok: true, pageId: page.id }) };
  } catch (err) {
    return { statusCode: 502, headers: corsHeaders(), body: JSON.stringify({ error: err.message }) };
  }
};

/**
 * cocon-get.js — GET /api/cocon-get?village=Smiths Lake[&project=slug]
 *
 * Admin read for the Co-Contribution Schedule & Project Budget module.
 *   - No `project` param  → list the funding projects for the village.
 *   - With `project` slug → { project, schedule, budget, rollups } for that
 *     project, with every derived total computed server-side (single source
 *     of truth for the dashboard, print view and CSV export).
 *
 * Auth: village admin / steward / super-admin (same model as contrib-list.js).
 *
 * Multi-village: village param filters the "Village" text column; v1 stores
 * every village in one DB set. When the network grows, resolve per-village DB
 * ids from the Villages registry here (mirrors contrib-list.js / News Desk).
 */

import { requireRole } from './_auth.js';
import { computeRollups } from './_cocon-calc.js';

const NOTION_VERSION = '2022-06-28';
const PROJECTS_DB = process.env.NOTION_COCON_PROJECTS_DB_ID || '';
const SCHEDULE_DB = process.env.NOTION_COCON_SCHEDULE_DB_ID || '';
const BUDGET_DB = process.env.NOTION_COCON_BUDGET_DB_ID || '';

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

const rt = (p) => (p?.rich_text || []).map(t => t.plain_text).join('');
const sel = (p) => p?.select?.name || '';
const num = (p) => (p?.number ?? null);

async function queryAll(dbId, filter, sorts) {
  const results = [];
  let cursor;
  do {
    const res = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
      method: 'POST',
      headers: notionHeaders(),
      body: JSON.stringify({
        ...(filter ? { filter } : {}),
        ...(sorts ? { sorts } : {}),
        page_size: 100,
        ...(cursor ? { start_cursor: cursor } : {}),
      }),
    });
    if (!res.ok) throw new Error(`Notion responded ${res.status}`);
    const data = await res.json();
    results.push(...data.results);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return results;
}

function parseProject(page) {
  const p = page.properties || {};
  return {
    id: page.id,
    name: p.Name?.title?.[0]?.plain_text || '(untitled)',
    slug: rt(p.Slug),
    village: rt(p.Village),
    grantRequestAmount: num(p['Grant Request Amount']),
    grantProgram: rt(p['Grant Program']),
    notes: rt(p['Notes / Rate Card']),
    status: sel(p.Status),
  };
}

function parseSchedule(page) {
  const p = page.properties || {};
  return {
    id: page.id,
    name: p.Name?.title?.[0]?.plain_text || '(no item)',
    project: rt(p.Project),
    village: rt(p.Village),
    order: num(p.Order) ?? 0,
    party: sel(p.Party) || 'Community',
    description: rt(p.Description),
    type: sel(p.Type),
    value: num(p.Value),
    confirmed: sel(p.Confirmed),
    archived: p.Archived?.checkbox === true,
  };
}

function parseBudget(page) {
  const p = page.properties || {};
  return {
    id: page.id,
    name: p.Name?.title?.[0]?.plain_text || '(no item)',
    project: rt(p.Project),
    village: rt(p.Village),
    order: num(p.Order) ?? 0,
    phase: rt(p.Phase),
    amount: num(p.Amount),
    archived: p.Archived?.checkbox === true,
  };
}

export const handler = async (event, context) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: corsHeaders(), body: JSON.stringify({ error: 'GET only' }) };
  }

  const village = event.queryStringParameters?.village || process.env.VILLAGE_NAME || 'Smiths Lake';
  const projectSlug = event.queryStringParameters?.project || '';

  const auth = requireRole(context, { village, anyOf: ['admin', 'treasurer'] });
  if (!auth.ok) {
    return { statusCode: auth.status, headers: corsHeaders(), body: JSON.stringify({ error: auth.error }) };
  }

  if (!PROJECTS_DB || !SCHEDULE_DB || !BUDGET_DB) {
    return {
      statusCode: 503,
      headers: corsHeaders(),
      body: JSON.stringify({ error: 'Co-Contribution databases not configured. Set NOTION_COCON_PROJECTS_DB_ID, NOTION_COCON_SCHEDULE_DB_ID, NOTION_COCON_BUDGET_DB_ID.' }),
    };
  }

  try {
    const villageFilter = { property: 'Village', rich_text: { equals: village } };

    // Project list mode.
    if (!projectSlug) {
      const pages = await queryAll(PROJECTS_DB, villageFilter);
      const projects = pages.map(parseProject).sort((a, b) => a.name.localeCompare(b.name));
      return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ projects }) };
    }

    // Single-project mode: project + both tables + rollups.
    const projectFilter = {
      and: [villageFilter, { property: 'Project', rich_text: { equals: projectSlug } }],
    };

    const [projPages, schedPages, budgetPages] = await Promise.all([
      queryAll(PROJECTS_DB, {
        and: [villageFilter, { property: 'Slug', rich_text: { equals: projectSlug } }],
      }),
      queryAll(SCHEDULE_DB, projectFilter),
      queryAll(BUDGET_DB, projectFilter),
    ]);

    const project = projPages.length ? parseProject(projPages[0]) : { slug: projectSlug, village, grantRequestAmount: null };
    const schedule = schedPages.map(parseSchedule).sort((a, b) => a.order - b.order);
    const budget = budgetPages.map(parseBudget).sort((a, b) => a.order - b.order);
    const rollups = computeRollups(schedule, budget, project);

    return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ project, schedule, budget, rollups }) };
  } catch (err) {
    return { statusCode: 502, headers: corsHeaders(), body: JSON.stringify({ error: err.message }) };
  }
};

/**
 * _projects.js — shared helper for the Projects system of record.
 *
 * A "Project" IS the existing Co-Contribution project (NOTION_COCON_PROJECTS_DB_ID).
 * The Projects module elevates it into the spine that ties together:
 *   - the co-contribution SCHEDULE (Table A) and BUDGET (Table B)   [cocon DBs]
 *   - GRANTS whose `Project` field matches the project slug          [VF Grants]
 *   - VOLUNTEER GROUPS (content cards) linked to the project, and    [VF Volunteers]
 *     the confirmed working-bee HOURS logged against those groups    [VF Activities]
 *
 * New project-level fields added here (self-healing schema, idempotent):
 *   - "Volunteer Groups"    rich_text  JSON array of { path, title } cards
 *   - "Volunteer Hour Rate" number     $/hour used to value volunteer WIK hours
 *   - "Exec Summary"        rich_text  editable steering-committee narrative
 *   - "Description"         rich_text  short project description
 *   - "Lead"               rich_text  project lead / PM name
 *
 * v1 valuation is READ-ONLY: volunteer hours are read from Confirmed/Pushed
 * activities and valued at the hour rate for an INDICATIVE co-contribution
 * figure. Nothing is written back into the schedule (no double counting) — the
 * formal "push to Contributions" pipeline is a later pass.
 */

import {
  VOLUNTEERS_DB_ID, ACTIVITIES_DB_ID, queryAll as vfQueryAll,
  parseActivity, parseVolunteer, normPath,
} from './_stewards.js';

const NOTION_VERSION = '2022-06-28';

export const PROJECTS_DB = process.env.NOTION_COCON_PROJECTS_DB_ID || '';
export const SCHEDULE_DB = process.env.NOTION_COCON_SCHEDULE_DB_ID || '';
export const BUDGET_DB = process.env.NOTION_COCON_BUDGET_DB_ID || '';

export const PROJECT_STATUS = ['Draft', 'Active', 'Submitted', 'Archived'];

export function corsHeaders() { return { 'Content-Type': 'application/json' }; }
export function jsonResp(statusCode, obj) {
  return { statusCode, headers: corsHeaders(), body: JSON.stringify(obj) };
}
export function notionHeaders() {
  return {
    Authorization: `Bearer ${process.env.NOTION_API_KEY}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  };
}

const rt = (p) => (p?.rich_text || []).map((t) => t.plain_text).join('');
const sel = (p) => p?.select?.name || '';
const num = (p) => (p?.number ?? null);

/** Notion rich_text caps each item at 2000 chars — chunk long JSON blobs. */
export function rtChunks(s) {
  const out = [];
  s = String(s || '');
  for (let i = 0; i < s.length && out.length < 90; i += 1900) out.push({ text: { content: s.slice(i, i + 1900) } });
  return out;
}
function rtJson(p, fallback) {
  try { const v = JSON.parse(rt(p) || 'null'); return v == null ? fallback : v; } catch { return fallback; }
}

/** Generic paged query for the cocon DBs (same NOTION_API_KEY as everything). */
export async function queryAll(dbId, filter, sorts) {
  return vfQueryAll(dbId, filter, sorts);
}

export function parseProject(page) {
  const p = page.properties || {};
  return {
    id: page.id,
    name: p.Name?.title?.[0]?.plain_text || '(untitled)',
    slug: rt(p.Slug),
    village: rt(p.Village),
    grantRequestAmount: num(p['Grant Request Amount']),
    grantProgram: rt(p['Grant Program']),
    notes: rt(p['Notes / Rate Card']),
    status: sel(p.Status) || 'Draft',
    // New project-level fields (present after ensureProjectSchema has run once).
    volunteerGroups: rtJson(p['Volunteer Groups'], []),
    hourRate: num(p['Volunteer Hour Rate']),
    execSummary: rt(p['Exec Summary']),
    description: rt(p.Description),
    lead: rt(p.Lead),
    // Two-way link to the public Project Hub content card.
    hubSlug: rt(p['Hub Slug']),
    publishToHub: p['Publish to Hub']?.checkbox === true,
  };
}

export function parseSchedule(page) {
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

export function parseBudget(page) {
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

/**
 * Self-heal the Projects DB schema: add any of the new project-level properties
 * that don't exist yet. Idempotent, cached per function instance. Fail-open —
 * a schema error must never block a read.
 */
let schemaEnsured = false;
export async function ensureProjectSchema() {
  if (schemaEnsured || !PROJECTS_DB) return;
  try {
    const res = await fetch(`https://api.notion.com/v1/databases/${PROJECTS_DB}`, { headers: notionHeaders() });
    if (!res.ok) return;
    const props = (await res.json()).properties || {};
    const missing = {};
    if (!props['Volunteer Groups']) missing['Volunteer Groups'] = { rich_text: {} };
    if (!props['Volunteer Hour Rate']) missing['Volunteer Hour Rate'] = { number: { format: 'number' } };
    if (!props['Exec Summary']) missing['Exec Summary'] = { rich_text: {} };
    if (!props.Description) missing.Description = { rich_text: {} };
    if (!props.Lead) missing.Lead = { rich_text: {} };
    if (!props['Hub Slug']) missing['Hub Slug'] = { rich_text: {} };
    if (!props['Publish to Hub']) missing['Publish to Hub'] = { checkbox: {} };
    if (Object.keys(missing).length) {
      await fetch(`https://api.notion.com/v1/databases/${PROJECTS_DB}`, {
        method: 'PATCH', headers: notionHeaders(), body: JSON.stringify({ properties: missing }),
      });
    }
    schemaEnsured = true;
  } catch (_) { /* fail-open */ }
}

// ── Grants DB resolution (env → search) — fail-open to [] ───────────
let cachedGrantsDb = process.env.NOTION_VF_GRANTS_DB_ID || null;
async function resolveGrantsDb() {
  if (cachedGrantsDb) return cachedGrantsDb;
  try {
    const res = await fetch('https://api.notion.com/v1/search', {
      method: 'POST', headers: notionHeaders(),
      body: JSON.stringify({ query: 'VF Grants', filter: { property: 'object', value: 'database' }, page_size: 20 }),
    });
    if (!res.ok) return null;
    const hits = (await res.json()).results || [];
    const hit = hits.find((d) => ((d.title || []).map((t) => t.plain_text).join('').includes('VF Grants')) && !d.archived);
    cachedGrantsDb = hit ? hit.id : null;
  } catch (_) { cachedGrantsDb = null; }
  return cachedGrantsDb;
}

export function parseGrant(page) {
  const p = page.properties || {};
  return {
    id: page.id,
    name: p.Grant?.title?.[0]?.plain_text || '(untitled)',
    village: rt(p.Village),
    funder: rt(p.Funder),
    program: rt(p.Program),
    status: sel(p.Status) || 'Researching',
    amountRequested: num(p['Amount Requested']),
    amountAwarded: num(p['Amount Awarded']),
    dueDate: p['Due Date']?.date?.start || null,
    project: rt(p.Project),
  };
}

/** Grants for one project (by slug). Fail-open to [] if the DB isn't resolvable. */
export async function grantsForProject(village, slug) {
  const db = await resolveGrantsDb();
  if (!db) return [];
  try {
    const rows = await queryAll(db, {
      and: [
        { property: 'Village', rich_text: { equals: village } },
        { property: 'Project', rich_text: { equals: slug } },
      ],
    });
    return rows.map(parseGrant);
  } catch (_) { return []; }
}

/**
 * Aggregate confirmed volunteer effort for a set of linked groups (cards).
 * Reads VF Activities (status Confirmed | Pushed) and VF Volunteers for the
 * village, matching by normalised card path. Fail-open to zeros.
 */
export async function aggregateVolunteers(village, groups) {
  const paths = new Set((groups || []).map((g) => normPath(g.path)).filter(Boolean));
  const empty = { totalHours: 0, activityCount: 0, volunteerCount: 0, byGroup: [] };
  if (!paths.size || !ACTIVITIES_DB_ID) return empty;
  try {
    const [actRows, volRows] = await Promise.all([
      queryAll(ACTIVITIES_DB_ID, { property: 'Village', rich_text: { equals: village } }),
      VOLUNTEERS_DB_ID ? queryAll(VOLUNTEERS_DB_ID, { property: 'Village', rich_text: { equals: village } }) : Promise.resolve([]),
    ]);
    const acts = actRows.map(parseActivity)
      .filter((a) => paths.has(normPath(a.cardPath)) && (a.status === 'Confirmed' || a.status === 'Pushed'));
    const vols = volRows.map(parseVolunteer)
      .filter((v) => (v.cards || []).some((c) => paths.has(normPath(c.path))));

    const byGroup = (groups || []).map((g) => {
      const gp = normPath(g.path);
      const ga = acts.filter((a) => normPath(a.cardPath) === gp);
      return {
        path: g.path,
        title: g.title || g.path,
        hours: Math.round(ga.reduce((s, a) => s + (a.totalHours || 0), 0) * 2) / 2,
        activities: ga.length,
        volunteers: vols.filter((v) => (v.cards || []).some((c) => normPath(c.path) === gp)).length,
      };
    });
    return {
      totalHours: Math.round(acts.reduce((s, a) => s + (a.totalHours || 0), 0) * 2) / 2,
      activityCount: acts.length,
      volunteerCount: vols.length,
      byGroup,
    };
  } catch (_) { return empty; }
}

/**
 * The exec/steering-committee number set for one project. Combines the cocon
 * rollups (cash/WIK/co-contribution %), grants (requested vs awarded) and the
 * indicative volunteer valuation. Pure — pass in already-fetched pieces.
 */
export function execNumbers(project, rollups, grants, volunteers) {
  const hourRate = Number(project?.hourRate) || 0;
  const volunteerValue = Math.round((volunteers?.totalHours || 0) * hourRate);
  const grantAwarded = (grants || [])
    .filter((g) => g.status === 'Successful')
    .reduce((s, g) => s + (Number(g.amountAwarded) || 0), 0);
  const grantRequestedOpen = (grants || [])
    .filter((g) => !['Successful', 'Unsuccessful', 'Withdrawn'].includes(g.status))
    .reduce((s, g) => s + (Number(g.amountRequested) || 0), 0);
  return {
    grantRequest: project?.grantRequestAmount ?? null,
    grantAwarded,
    grantRequestedOpen,
    totalCoContribution: rollups?.totalCoContribution ?? 0,
    coContributionPct: rollups?.coContributionPct ?? 0,
    totalProjectValue: rollups?.totalProjectValue ?? 0,
    budgetTotal: rollups?.estimatedTotalProjectCost ?? 0,
    cashPaid: rollups?.paid ?? 0,
    cashAnticipated: rollups?.cashAnticipated ?? 0,
    wikPledged: rollups?.wikPledged ?? 0,
    volunteerHours: volunteers?.totalHours || 0,
    volunteerCount: volunteers?.volunteerCount || 0,
    hourRate,
    volunteerValue,
  };
}

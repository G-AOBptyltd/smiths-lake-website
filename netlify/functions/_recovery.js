/**
 * _recovery.js — shared helper for the Resilience Recovery Support module.
 *
 * The module answers one question in the weeks after a fire, flood or storm:
 * WHO NEEDS WHAT, and WHO HAS OFFERED HELP — and it keeps the paper trail that
 * turns that effort into evidence for recovery funding.
 *
 * Three registers, one Recovery Event as the spine (same shape as the Projects
 * system of record, where a Project is the spine):
 *
 *   📋 VF Recovery Events   the event header — hazard, status, dates, coordinator
 *   🌱 VF Recovery Needs    the recovery register — a need per household/site
 *   🤝 VF Recovery Offers   offers of help, equipment, accommodation, skills
 *
 * Each DB resolves env var → Notion search by title → auto-create under the
 * same parent page as the Contributions DB (the grant-admin.js pattern), so a
 * new village needs zero manual Notion setup.
 *
 * ── PRIVACY (read this before touching needs) ────────────────────────────────
 * A need row is the most sensitive data on the platform: a resident's name,
 * address, phone and, often, why they are vulnerable. So:
 *   - there is NO public surface in this phase — admin console only;
 *   - roles are admin | emergency | steward (the coordinator and the people
 *     doing the doorknocking), never viewer;
 *   - a need marked Sensitive has its contact block withheld from steward-level
 *     users by the SERVER (redactNeed below) — not merely hidden in the UI;
 *   - nothing here is ever written to a public Notion page or the built site.
 * Any future resident-facing intake must go through the fail-closed
 * isModulePublic() gate, exactly as Events and Bookings do.
 *
 * ── EVIDENCE IS READ-ONLY ────────────────────────────────────────────────────
 * Same invariant as _projects.js v1: recovery effort is READ and valued for an
 * INDICATIVE figure. Nothing is written back into Contributions or the volunteer
 * ledger, so a recovery roll-up can never double-count a contribution that has
 * already been logged through its own module.
 */

import { requireRole, hasRole } from './_auth.js';
import { ACTIVITIES_DB_ID, queryAll as vfQueryAll, parseActivity } from './_stewards.js';

const NOTION_VERSION = '2022-06-28';
const CONTRIB_DB_ID = process.env.NOTION_CONTRIB_DB_ID || '6d182a0d4f0c42c2879f13753e355861';

export const EVENTS_DB_TITLE = '📋 VF Recovery Events';
export const NEEDS_DB_TITLE = '🌱 VF Recovery Needs';
export const OFFERS_DB_TITLE = '🤝 VF Recovery Offers';

/* ── Vocabulary ─────────────────────────────────────────────────────────────
 * Deliberately plain-language and hazard-agnostic: the same register serves a
 * bushfire, a flood and a storm. Statuses read left-to-right as a workflow. */

export const EVENT_STATUSES = ['Standby', 'Active recovery', 'Monitoring', 'Closed'];
export const HAZARD_TYPES = [
  'Bushfire', 'Flood', 'Severe storm', 'Coastal erosion', 'Heatwave',
  'Landslip', 'Infrastructure failure', 'Other',
];

export const NEED_STATUSES = ['Logged', 'Triaged', 'Matched', 'In progress', 'Closed', 'Referred', 'Withdrawn'];
// Statuses that still need someone's attention (drives the console's counters).
export const NEED_OPEN = ['Logged', 'Triaged', 'Matched', 'In progress'];
export const NEED_PRIORITIES = ['Critical', 'High', 'Medium', 'Low'];
export const NEED_CATEGORIES = [
  'Property & clean-up', 'Shelter & accommodation', 'Food & water',
  'Medical & wellbeing', 'Animals & livestock', 'Transport',
  'Utilities & communications', 'Fencing & land', 'Admin, insurance & grants', 'Other',
];

export const OFFER_STATUSES = ['Offered', 'Verified', 'Allocated', 'Delivered', 'Declined', 'Withdrawn'];
export const OFFER_OPEN = ['Offered', 'Verified', 'Allocated'];
export const OFFER_TYPES = [
  'Labour & hands', 'Equipment & machinery', 'Transport & haulage',
  'Accommodation', 'Food & catering', 'Trade & professional skills',
  'Materials & supplies', 'Financial', 'Other',
];

/* ── Notion plumbing ──────────────────────────────────────────────────────── */

export function notionHeaders() {
  return {
    Authorization: `Bearer ${process.env.NOTION_API_KEY}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  };
}

export function jsonResp(statusCode, obj) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}

/** Notion caps each rich_text item at 2000 chars — chunk long strings. */
export function rtChunks(s) {
  const out = [];
  s = String(s == null ? '' : s);
  for (let i = 0; i < s.length && out.length < 90; i += 1900) out.push({ text: { content: s.slice(i, i + 1900) } });
  return out;
}

export const rtText = (prop) => (prop?.rich_text || []).map((t) => t.plain_text).join('');
export const titleText = (prop) => (prop?.title || []).map((t) => t.plain_text).join('');
const selName = (prop) => prop?.select?.name || '';
const numOf = (prop) => (prop?.number ?? null);
const dateOf = (prop) => prop?.date?.start || '';

export function rtJson(prop, fallback) {
  try { const v = JSON.parse(rtText(prop) || 'null'); return v == null ? fallback : v; } catch (_) { return fallback; }
}

/** A number when it is a sane non-negative number, else null. */
export function num(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export const dateOrNull = (v) => (v ? { date: { start: v } } : { date: null });
export const today = () => new Date().toISOString().slice(0, 10);

/** One select option list, ready for a Notion schema. */
const opts = (list) => ({ select: { options: list.map((name) => ({ name })) } });

/* ── DB resolution: env → search → create ─────────────────────────────────── */

const cache = {};   // title → id, for the life of the function instance

async function findDbByTitle(title, query) {
  const res = await fetch('https://api.notion.com/v1/search', {
    method: 'POST', headers: notionHeaders(),
    body: JSON.stringify({ query, filter: { property: 'object', value: 'database' }, page_size: 20 }),
  });
  if (!res.ok) return null;
  const hits = (await res.json()).results || [];
  const hit = hits.find((d) => titleText(d) === title && !d.archived);
  return hit ? hit.id : null;
}

/** The Contributions DB's parent page — where every VF register lives. */
async function registerParentPage(what) {
  const res = await fetch(`https://api.notion.com/v1/databases/${CONTRIB_DB_ID}`, { headers: notionHeaders() });
  if (!res.ok) throw new Error(`Could not resolve a parent page for the ${what}`);
  const parent = (await res.json()).parent || {};
  if (parent.type !== 'page_id') throw new Error(`Contributions DB has no page parent — set the ${what} DB id explicitly`);
  return parent.page_id;
}

async function createDb(title, properties) {
  const parentId = await registerParentPage(title);
  const res = await fetch('https://api.notion.com/v1/databases', {
    method: 'POST', headers: notionHeaders(),
    body: JSON.stringify({ parent: { type: 'page_id', page_id: parentId }, title: [{ text: { content: title } }], properties }),
  });
  if (!res.ok) throw new Error(`Could not create ${title} (Notion ${res.status})`);
  return (await res.json()).id;
}

const AUDIT = { 'Logged By': { rich_text: {} }, 'Last Updated By': { rich_text: {} } };

const EVENT_SCHEMA = () => ({
  'Event': { title: {} },
  'Village': { rich_text: {} },
  'Hazard': opts(HAZARD_TYPES),
  'Status': opts(EVENT_STATUSES),
  'Start Date': { date: {} },
  'Closed Date': { date: {} },
  'Declaration Ref': { rich_text: {} },     // e.g. an AGRN / disaster declaration number
  'Coordinator': { rich_text: {} },
  'Households Affected': { number: {} },
  'Hour Rate': { number: { format: 'australian_dollar' } },
  'Project': { rich_text: {} },             // slug of the Projects-SoR project, if any
  'Summary': { rich_text: {} },
  'Notes': { rich_text: {} },
  ...AUDIT,
});

const NEED_SCHEMA = () => ({
  'Need': { title: {} },
  'Village': { rich_text: {} },
  'Event': { rich_text: {} },               // the event's page id
  'Category': opts(NEED_CATEGORIES),
  'Priority': opts(NEED_PRIORITIES),
  'Status': opts(NEED_STATUSES),
  'Contact Name': { rich_text: {} },
  'Contact Phone': { rich_text: {} },
  'Contact Email': { rich_text: {} },
  'Location': { rich_text: {} },
  'Access Notes': { rich_text: {} },
  'People Affected': { number: {} },
  'Sensitive': { checkbox: {} },            // withholds the contact block from stewards
  'Logged Date': { date: {} },
  'Target Date': { date: {} },
  'Closed Date': { date: {} },
  'Assigned To': { rich_text: {} },
  'Matched Offers': { rich_text: {} },      // JSON [{ id, title }]
  'Hours Contributed': { number: {} },      // recovery effort against THIS need
  'People Helping': { number: {} },
  'Help Value': { number: { format: 'australian_dollar' } },  // donated goods/services, valued
  'Notes': { rich_text: {} },
  ...AUDIT,
});

const OFFER_SCHEMA = () => ({
  'Offer': { title: {} },
  'Village': { rich_text: {} },
  'Event': { rich_text: {} },
  'Offer Type': opts(OFFER_TYPES),
  'Status': opts(OFFER_STATUSES),
  'Offered By': { rich_text: {} },
  'Contact Phone': { rich_text: {} },
  'Contact Email': { rich_text: {} },
  'Description': { rich_text: {} },
  'Capacity': { rich_text: {} },            // "2 utes + trailer", "sleeps 4", "8 hrs/week"
  'Available From': { date: {} },
  'Available Until': { date: {} },
  'Estimated Value': { number: { format: 'australian_dollar' } },
  'Compliance Notes': { rich_text: {} },    // tickets/licences/insurance for machinery
  'Matched Needs': { rich_text: {} },       // JSON [{ id, title }]
  'Notes': { rich_text: {} },
  ...AUDIT,
});

const REGISTERS = {
  events: { title: EVENTS_DB_TITLE, query: 'VF Recovery Events', env: 'NOTION_VF_RECOVERY_EVENTS_DB_ID', schema: EVENT_SCHEMA },
  needs: { title: NEEDS_DB_TITLE, query: 'VF Recovery Needs', env: 'NOTION_VF_RECOVERY_NEEDS_DB_ID', schema: NEED_SCHEMA },
  offers: { title: OFFERS_DB_TITLE, query: 'VF Recovery Offers', env: 'NOTION_VF_RECOVERY_OFFERS_DB_ID', schema: OFFER_SCHEMA },
};

/** dbId('needs') → the Notion database id, creating the register if needed. */
export async function dbId(which) {
  const reg = REGISTERS[which];
  if (!reg) throw new Error(`Unknown recovery register "${which}"`);
  if (cache[which]) return cache[which];
  const fromEnv = process.env[reg.env];
  if (fromEnv) { cache[which] = fromEnv; return cache[which]; }
  let id = await findDbByTitle(reg.title, reg.query);
  if (!id) id = await createDb(reg.title, reg.schema());
  cache[which] = id;
  return id;
}

/* ── Parsers ──────────────────────────────────────────────────────────────── */

export function parseEvent(p) {
  const props = p.properties || {};
  return {
    id: p.id,
    name: titleText(props['Event']),
    village: rtText(props['Village']),
    hazard: selName(props['Hazard']),
    status: selName(props['Status']) || 'Standby',
    startDate: dateOf(props['Start Date']),
    closedDate: dateOf(props['Closed Date']),
    declarationRef: rtText(props['Declaration Ref']),
    coordinator: rtText(props['Coordinator']),
    householdsAffected: numOf(props['Households Affected']),
    hourRate: numOf(props['Hour Rate']),
    project: rtText(props['Project']),
    summary: rtText(props['Summary']),
    notes: rtText(props['Notes']),
    loggedBy: rtText(props['Logged By']),
    lastUpdatedBy: rtText(props['Last Updated By']),
  };
}

export function parseNeed(p) {
  const props = p.properties || {};
  return {
    id: p.id,
    name: titleText(props['Need']),
    village: rtText(props['Village']),
    event: rtText(props['Event']),
    category: selName(props['Category']),
    priority: selName(props['Priority']) || 'Medium',
    status: selName(props['Status']) || 'Logged',
    contactName: rtText(props['Contact Name']),
    contactPhone: rtText(props['Contact Phone']),
    contactEmail: rtText(props['Contact Email']),
    location: rtText(props['Location']),
    accessNotes: rtText(props['Access Notes']),
    peopleAffected: numOf(props['People Affected']),
    sensitive: props['Sensitive']?.checkbox === true,
    loggedDate: dateOf(props['Logged Date']),
    targetDate: dateOf(props['Target Date']),
    closedDate: dateOf(props['Closed Date']),
    assignedTo: rtText(props['Assigned To']),
    matchedOffers: rtJson(props['Matched Offers'], []),
    hoursContributed: numOf(props['Hours Contributed']),
    peopleHelping: numOf(props['People Helping']),
    helpValue: numOf(props['Help Value']),
    notes: rtText(props['Notes']),
    loggedBy: rtText(props['Logged By']),
    lastUpdatedBy: rtText(props['Last Updated By']),
  };
}

export function parseOffer(p) {
  const props = p.properties || {};
  return {
    id: p.id,
    name: titleText(props['Offer']),
    village: rtText(props['Village']),
    event: rtText(props['Event']),
    offerType: selName(props['Offer Type']),
    status: selName(props['Status']) || 'Offered',
    offeredBy: rtText(props['Offered By']),
    contactPhone: rtText(props['Contact Phone']),
    contactEmail: rtText(props['Contact Email']),
    description: rtText(props['Description']),
    capacity: rtText(props['Capacity']),
    availableFrom: dateOf(props['Available From']),
    availableUntil: dateOf(props['Available Until']),
    estimatedValue: numOf(props['Estimated Value']),
    complianceNotes: rtText(props['Compliance Notes']),
    matchedNeeds: rtJson(props['Matched Needs'], []),
    notes: rtText(props['Notes']),
    loggedBy: rtText(props['Logged By']),
    lastUpdatedBy: rtText(props['Last Updated By']),
  };
}

/* ── Privacy ──────────────────────────────────────────────────────────────── */

/**
 * Can this user see the contact block on a Sensitive need? Only the people who
 * carry the duty of care for it: the village admin and the Emergency
 * Coordinator (and a super-admin, via hasRole). Stewards coordinate the work
 * without needing the household's phone number.
 */
export function canSeeSensitive(user, village) {
  return hasRole(user, { village, anyOf: ['admin', 'emergency'] });
}

/**
 * Strip the contact block from a Sensitive need for users who may not see it.
 * SERVER-side: the field never reaches the browser, so no UI bug can leak it.
 */
export function redactNeed(need, allowed) {
  if (allowed || !need.sensitive) return need;
  return {
    ...need,
    contactName: need.contactName ? '(withheld)' : '',
    contactPhone: '',
    contactEmail: '',
    location: need.location ? '(withheld)' : '',
    accessNotes: '',
    redacted: true,
  };
}

/* ── Queries ──────────────────────────────────────────────────────────────── */

/** Every row of `which` for one village, oldest first, following pagination. */
export async function queryVillage(which, village, sorts) {
  const id = await dbId(which);
  const out = [];
  let cursor;
  do {
    const res = await fetch(`https://api.notion.com/v1/databases/${id}/query`, {
      method: 'POST', headers: notionHeaders(),
      body: JSON.stringify({
        filter: { property: 'Village', rich_text: { equals: village } },
        ...(sorts ? { sorts } : {}),
        ...(cursor ? { start_cursor: cursor } : {}),
      }),
    });
    if (!res.ok) throw new Error(`Notion responded ${res.status}`);
    const data = await res.json();
    (data.results || []).forEach((p) => out.push(p));
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  return out;
}

/**
 * Fetch one row and prove it belongs to `which` register AND to `village`.
 * Every write path goes through this — it is what stops one village from
 * editing another's record by guessing a page id.
 */
export async function getRow(which, pageId, village, parse) {
  if (!pageId) return null;
  const id = await dbId(which);
  const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, { headers: notionHeaders() });
  if (!res.ok) return null;
  const page = await res.json();
  if (page.archived) return null;
  if ((page.parent?.database_id || '').replace(/-/g, '') !== String(id).replace(/-/g, '')) return null;
  const row = parse(page);
  if (village && row.village !== village) return null;
  return row;
}

/** Archive (Notion trash — recoverable). */
export async function archiveRow(pageId) {
  const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: 'PATCH', headers: notionHeaders(), body: JSON.stringify({ archived: true }),
  });
  if (!res.ok) throw new Error(`Notion responded ${res.status}`);
}

export async function patchRow(pageId, properties) {
  const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: 'PATCH', headers: notionHeaders(), body: JSON.stringify({ properties }),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Notion responded ${res.status}: ${detail.slice(0, 200)}`);
  }
  return res;
}

export async function createRow(which, properties) {
  const id = await dbId(which);
  const res = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST', headers: notionHeaders(),
    body: JSON.stringify({ parent: { database_id: id }, properties }),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Notion responded ${res.status}: ${detail.slice(0, 200)}`);
  }
  return (await res.json()).id;
}

/** "someone@example.org · 2026-09-13" — the audit stamp every write carries. */
export function stampFor(user) {
  return { 'Last Updated By': { rich_text: rtChunks(`${user?.email || 'admin'} · ${today()}`) } };
}

/* ── Evidence roll-up (READ-ONLY) ─────────────────────────────────────────── */

/**
 * Volunteer-hub hours confirmed inside the recovery window, as a cross-check
 * on the effort logged against needs. Two DIFFERENT measures, deliberately
 * reported side by side and never summed:
 *   - needs effort   → hours a coordinator logged against a recovery need
 *   - ledger hours   → hours the Volunteer hub confirmed in the same window
 * A village that runs its working bees through the Volunteer hub will see the
 * work in the second figure; one that doorknocks will see it in the first.
 * Nothing is written back either way (no double counting — the same rule
 * _projects.js follows for its indicative valuation).
 */
export async function ledgerHoursInWindow(village, fromDate, toDate) {
  if (!ACTIVITIES_DB_ID || !fromDate) return { hours: 0, activities: 0, available: false };
  try {
    const pages = await vfQueryAll(ACTIVITIES_DB_ID, { property: 'Village', rich_text: { equals: village } });
    const end = toDate || today();
    let hours = 0, activities = 0;
    pages.map(parseActivity).forEach((a) => {
      if (!['Confirmed', 'Pushed'].includes(a.status)) return;
      if (!a.date || a.date < fromDate || a.date > end) return;
      hours += Number(a.totalHours || 0);
      activities += 1;
    });
    return { hours: Math.round(hours * 10) / 10, activities, available: true };
  } catch (_) {
    return { hours: 0, activities: 0, available: false };
  }
}

/**
 * Roll a recovery event's needs and offers into the figures a recovery-funding
 * acquittal actually asks for. Pure — takes rows, returns numbers, so it is
 * testable without Notion.
 */
export function rollUp(event, needs, offers, ledger) {
  const rate = Number(event?.hourRate) > 0 ? Number(event.hourRate) : 0;
  const closed = needs.filter((n) => n.status === 'Closed');
  const open = needs.filter((n) => NEED_OPEN.includes(n.status));
  const hours = needs.reduce((s, n) => s + Number(n.hoursContributed || 0), 0);
  const helpValue = needs.reduce((s, n) => s + Number(n.helpValue || 0), 0);
  const delivered = offers.filter((o) => o.status === 'Delivered');
  const deliveredValue = delivered.reduce((s, o) => s + Number(o.estimatedValue || 0), 0);
  const households = needs.reduce((s, n) => s + (Number(n.peopleAffected) > 0 ? 1 : 0), 0);
  const peopleAffected = needs.reduce((s, n) => s + Number(n.peopleAffected || 0), 0);
  return {
    needsTotal: needs.length,
    needsOpen: open.length,
    needsClosed: closed.length,
    needsCritical: open.filter((n) => n.priority === 'Critical').length,
    offersTotal: offers.length,
    offersOpen: offers.filter((o) => OFFER_OPEN.includes(o.status)).length,
    offersDelivered: delivered.length,
    households,
    peopleAffected,
    hours: Math.round(hours * 10) / 10,
    hourRate: rate,
    hoursValue: Math.round(hours * rate),
    helpValue,
    deliveredValue,
    // The single number a funding body asks for: valued volunteer effort plus
    // the value of donated goods and services. Labelled INDICATIVE everywhere
    // it is shown — it is evidence to support a claim, not an audited figure.
    indicativeTotal: Math.round(hours * rate) + helpValue + deliveredValue,
    ledger: ledger || { hours: 0, activities: 0, available: false },
  };
}

/* ── Guard ────────────────────────────────────────────────────────────────── */

/**
 * Who may work the recovery register. The Emergency Coordinator owns it, the
 * village admin oversees it, stewards do the legwork. Deliberately NOT gated by
 * plan: recovery coordination is in every Village1st plan on purpose — see
 * _entitlements.js MODULE_MIN_PLAN (no 'recovery' entry) — so a village is
 * never locked out of coordinating a recovery by its subscription tier.
 */
export function requireRecoveryRole(context, village, anyOf) {
  return requireRole(context, { village, anyOf: anyOf || ['admin', 'emergency', 'steward'] });
}

export const csvCell = (v) => {
  const s = String(v == null ? '' : v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

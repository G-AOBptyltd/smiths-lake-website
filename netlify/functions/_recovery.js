/**
 * _recovery.js — shared helper for the Resilience Recovery Support module.
 *
 * The module answers one question in the weeks after a fire, flood or storm:
 * WHO NEEDS WHAT, and WHO HAS OFFERED HELP — and it keeps the paper trail that
 * turns that effort into evidence for recovery funding.
 *
 * Three registers, one Recovery Event as the spine (the same shape as the
 * Projects system of record, where a Project is the spine):
 *
 *   recovery_events   the event header — hazard, status, dates, coordinator
 *   recovery_needs    the recovery register — a need per household/site
 *   recovery_offers   offers of help, equipment, accommodation, skills
 *
 * ── STORAGE: SUPABASE, NOT NOTION (changed 13 Sep 2026) ─────────────────────
 * This module first shipped storing its registers in Notion, to match the
 * grants/projects modules it was modelled on. That was the wrong call and was
 * reversed the same day, before any real record existed. A recovery NEED
 * carries a resident's name, address, phone and often the reason they are
 * vulnerable — the most sensitive data the platform holds — and that belongs in
 * the Sydney Supabase project behind deny-by-default RLS, alongside volunteers
 * and subscribers, not in a shared Notion workspace.
 *
 * "Build it like the grants module" was an instruction about UI and code shape.
 * It was not a reason to put a new class of data in the same store. If a future
 * module carries personal data, it goes here — see _supa.js.
 *
 * ── PRIVACY (read this before touching needs) ────────────────────────────────
 *   - there is NO public surface — admin console only;
 *   - roles are admin | emergency | steward (the coordinator and the people
 *     doing the doorknocking), never viewer;
 *   - a need marked Sensitive has its contact block withheld from steward-level
 *     users by the SERVER (redactNeed below) — not merely hidden in the UI;
 *   - the tables are RLS-enabled with no policies, so nothing but the service
 *     role can reach them, and every endpoint re-checks role + village first.
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
import {
  selectVillage, selectOne, insertRow, updateRow, archiveRowById,
  slugVillage, clean, num, money, int, dateOrNull, today, jsonResp, csvCell, stampBy,
} from './_supa.js';

export { jsonResp, csvCell, clean, num, money, int, dateOrNull, today };

export const T_EVENTS = 'recovery_events';
export const T_NEEDS = 'recovery_needs';
export const T_OFFERS = 'recovery_offers';

/* ── Vocabulary ─────────────────────────────────────────────────────────────
 * Deliberately plain-language and hazard-agnostic: the same register serves a
 * bushfire, a flood and a storm. These lists are mirrored by CHECK constraints
 * in migration 0011 — change one and you must change the other. */

export const EVENT_STATUSES = ['Standby', 'Active recovery', 'Monitoring', 'Closed'];
export const HAZARD_TYPES = [
  'Bushfire', 'Flood', 'Severe storm', 'Coastal erosion', 'Heatwave',
  'Landslip', 'Infrastructure failure', 'Other',
];

export const NEED_STATUSES = ['Logged', 'Triaged', 'Matched', 'In progress', 'Closed', 'Referred', 'Withdrawn'];
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

/* ── Row mappers (snake_case column → camelCase field) ───────────────────── */

const jsonArr = (v) => (Array.isArray(v) ? v : []);
const numOrNull = (v) => (v == null ? null : Number(v));

export function parseEvent(r) {
  return {
    id: r.id,
    name: r.name || '',
    village: r.village_id || '',
    hazard: r.hazard || '',
    status: r.status || 'Standby',
    startDate: r.start_date || '',
    closedDate: r.closed_date || '',
    declarationRef: r.declaration_ref || '',
    coordinator: r.coordinator || '',
    householdsAffected: numOrNull(r.households_affected),
    hourRate: numOrNull(r.hour_rate),
    project: r.project || '',
    summary: r.summary || '',
    notes: r.notes || '',
    loggedBy: r.logged_by || '',
    lastUpdatedBy: r.last_updated_by || '',
  };
}

export function parseNeed(r) {
  return {
    id: r.id,
    name: r.name || '',
    village: r.village_id || '',
    event: r.event_id || '',
    category: r.category || '',
    priority: r.priority || 'Medium',
    status: r.status || 'Logged',
    contactName: r.contact_name || '',
    contactPhone: r.contact_phone || '',
    contactEmail: r.contact_email || '',
    location: r.location || '',
    accessNotes: r.access_notes || '',
    peopleAffected: numOrNull(r.people_affected),
    sensitive: r.sensitive === true,
    loggedDate: r.logged_date || '',
    targetDate: r.target_date || '',
    closedDate: r.closed_date || '',
    assignedTo: r.assigned_to || '',
    matchedOffers: jsonArr(r.matched_offers),
    hoursContributed: numOrNull(r.hours_contributed),
    peopleHelping: numOrNull(r.people_helping),
    helpValue: numOrNull(r.help_value),
    notes: r.notes || '',
    loggedBy: r.logged_by || '',
    lastUpdatedBy: r.last_updated_by || '',
  };
}

export function parseOffer(r) {
  return {
    id: r.id,
    name: r.name || '',
    village: r.village_id || '',
    event: r.event_id || '',
    offerType: r.offer_type || '',
    status: r.status || 'Offered',
    offeredBy: r.offered_by || '',
    contactPhone: r.contact_phone || '',
    contactEmail: r.contact_email || '',
    description: r.description || '',
    capacity: r.capacity || '',
    availableFrom: r.available_from || '',
    availableUntil: r.available_until || '',
    estimatedValue: numOrNull(r.estimated_value),
    complianceNotes: r.compliance_notes || '',
    matchedNeeds: jsonArr(r.matched_needs),
    notes: r.notes || '',
    loggedBy: r.logged_by || '',
    lastUpdatedBy: r.last_updated_by || '',
  };
}

const PARSERS = { [T_EVENTS]: parseEvent, [T_NEEDS]: parseNeed, [T_OFFERS]: parseOffer };

/* ── Data access ─────────────────────────────────────────────────────────── */

/** Every live row of a register for one village, already parsed. */
export async function queryVillage(table, village, order) {
  const rows = await selectVillage(table, village, { order });
  return rows.map(PARSERS[table]);
}

/**
 * One row, proven to belong to this village. Every write path calls this first —
 * it is what stops one village from editing another's record by guessing a uuid.
 */
export async function getRow(table, id, village) {
  const row = await selectOne(table, id, village);
  return row ? PARSERS[table](row) : null;
}

export async function createRow(table, values) {
  return insertRow(table, values);
}

export async function patchRow(table, id, village, values) {
  return updateRow(table, id, village, values);
}

export async function archiveRow(table, id, village) {
  return archiveRowById(table, id, village);
}

export { slugVillage };

/** Audit stamp for a write. */
export function stampFor(user) {
  return { last_updated_by: stampBy(user) };
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

/* ── Evidence roll-up (READ-ONLY) ─────────────────────────────────────────── */

/**
 * Volunteer-hub hours confirmed inside the recovery window, as a cross-check on
 * the effort logged against needs. Two DIFFERENT measures, deliberately reported
 * side by side and never summed:
 *   - needs effort   → hours a coordinator logged against a recovery need
 *   - ledger hours   → hours the Volunteer hub confirmed in the same window
 * A village that runs its working bees through the Volunteer hub will see the
 * work in the second figure; one that doorknocks will see it in the first.
 * Nothing is written back either way (no double counting — the same rule
 * _projects.js follows for its indicative valuation).
 *
 * Still reads the Notion activity ledger, because that is where the volunteer
 * hub's confirmed hours live today; it carries no resident PII of its own.
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
 * testable without a database.
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
    // the value of donated goods and services. Labelled INDICATIVE everywhere it
    // is shown — evidence to support a claim, not an audited figure.
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

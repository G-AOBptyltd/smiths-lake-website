/**
 * _events.js — shared helpers for the Events & ticketing module.
 *
 * Two stores, deliberately split by data class:
 *   🎟 VF Events (NOTION)  — one row per event; Status Draft → Published →
 *                            Closed / Cancelled / Completed. Committee-authored
 *                            content, no personal data — stays in the CMS.
 *                            Shared across villages, scoped by the Village column.
 *   event_rsvps (SUPABASE) — one row per registration (a party of N seats).
 *                            Status Registered | Waitlist | Cancelled | Attended.
 *
 * ── RSVPs: SUPABASE, NOT NOTION (Phase 2 of the PII plan, 14 Sep 2026) ──────
 * An RSVP is PUBLIC INTAKE — a resident's name, email and phone typed into a
 * form on the website — so it lives in the Sydney Supabase project behind
 * deny-by-default RLS (migration 0014), not in the shared Notion workspace.
 * Cut over with NOTHING to migrate: the Notion "VF Event RSVPs" register held
 * zero rows on the day. NOTION_VF_EVENT_RSVPS_DB_ID is retired.
 *
 * parseRsvp() returns the same field names the Notion version did, so
 * /admin/events/ needed no functional change. `pageId` in request bodies is
 * now the row's uuid; rows reference their event by its dashless Notion page
 * id, exactly as the Notion register did.
 *
 * v1 is the pre-Tyro model the committee chose: RSVP + capacity + pay at the
 * door (price is display text; payments recorded at check-in). True online
 * ticket sales arrive with each village's own Tyro merchant.
 */

// Rate-limit guard for api.notion.com. Side-effect import — see the file.
import './_notion-guard.js';
import {
  selectVillage, selectOne, insertRow, updateRow, archiveRowById,
  slugVillage, clean, money, int, dateOrNull, today, jsonResp, stampBy,
} from './_supa.js';

export { slugVillage, clean, money, int, dateOrNull, today, jsonResp, stampBy };

const NOTION_VERSION = '2022-06-28';

export const EVENTS_DB_ID = process.env.NOTION_VF_EVENTS_DB_ID || '3bfd508adfc1814488d5f68e3f6e99b7';
export const T_RSVPS = 'event_rsvps';

export const EVENT_STATUSES = ['Draft', 'Published', 'Closed', 'Cancelled', 'Completed'];
// Mirrored by a CHECK constraint in migration 0014 — change one, change both.
export const RSVP_STATUSES = ['Registered', 'Waitlist', 'Cancelled', 'Attended'];
// RSVP statuses that consume capacity.
export const COUNTED = ['Registered', 'Attended'];

export function notionHeaders() {
  return {
    Authorization: `Bearer ${process.env.NOTION_API_KEY}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  };
}

export function notProvisioned() {
  return jsonResp(503, { error: 'Events is not provisioned yet — run the provisioning step and set the DB id env vars.' });
}

export const rtChunks = (str) => {
  const s = String(str || '');
  if (!s) return [];
  const out = [];
  for (let i = 0; i < s.length; i += 1900) out.push({ text: { content: s.slice(i, i + 1900) } });
  return out;
};
export const rtText = (prop) => (prop?.rich_text || []).map((t) => t.plain_text).join('');

/* ── Events (Notion) ─────────────────────────────────────────────────────── */

export async function queryAll(dbId, filter, sorts) {
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

export function parseEvent(page) {
  const p = page.properties || {};
  return {
    id: page.id,
    name: p.Event?.title?.[0]?.plain_text || '(unnamed event)',
    village: rtText(p.Village),
    description: rtText(p.Description),
    start: p.Date?.date?.start || null,
    end: p.Date?.date?.end || null,
    location: rtText(p.Location),
    capacity: p.Capacity?.number ?? null,
    price: rtText(p.Price),
    status: p.Status?.select?.name || 'Draft',
    organiser: rtText(p.Organiser),
    note: rtText(p.Note),
    createdBy: rtText(p['Created By']),
    lastUpdatedBy: rtText(p['Last Updated By']),
  };
}

export async function getEvent(pageId) {
  const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, { headers: notionHeaders() });
  if (!res.ok) return null;
  const page = await res.json();
  const parent = page.parent?.database_id?.replace(/-/g, '');
  if (parent !== EVENTS_DB_ID.replace(/-/g, '')) return null;
  return parseEvent(page);
}

/* ── RSVPs (Supabase) ────────────────────────────────────────────────────── */

const numOrNull = (v) => (v == null ? null : Number(v));
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const dashless = (id) => String(id || '').replace(/-/g, '');

/** Row → the object the console and the mailers have always received. */
export function parseRsvp(r) {
  const firstName = r.first_name || '';
  const lastName = r.last_name || '';
  const fullName = `${firstName} ${lastName}`.trim();
  const eventTitle = r.event_title || '';
  return {
    id: r.id,
    title: fullName || eventTitle ? `${fullName} — ${eventTitle}` : '(rsvp)',
    village: r.village_id || '',
    eventId: dashless(r.event_id),
    event: eventTitle,
    name: fullName,
    firstName,
    lastName,
    email: r.email || '',
    phone: r.phone || '',
    seats: r.seats ?? 1,
    status: r.status || 'Registered',
    message: r.message || '',
    amountPaid: numOrNull(r.amount_paid),
    paymentDate: r.payment_date || null,
    dateRsvpd: r.date_rsvpd || null,
    loggedBy: r.logged_by || '',
    lastUpdatedBy: r.last_updated_by || '',
    lastEmail: r.last_email || '',
  };
}

/** Seats taken (Registered + Attended) for an event from its parsed RSVP rows. */
export function seatsTaken(rsvps, eventId) {
  const key = dashless(eventId);
  return rsvps.filter((r) => r.eventId === key && COUNTED.includes(r.status))
    .reduce((s, r) => s + (r.seats || 1), 0);
}

/** Every live RSVP for one village, oldest registration first (the door-list order). */
export async function listRsvps(village) {
  const rows = await selectVillage(T_RSVPS, village, { order: 'date_rsvpd.asc,created_at.asc' });
  return rows.map(parseRsvp);
}

/** Every live RSVP for one event in one village — the capacity check's input. */
export async function listRsvpsForEvent(village, eventId) {
  const rows = await selectVillage(T_RSVPS, village, {
    order: 'date_rsvpd.asc,created_at.asc',
    extra: `event_id=eq.${encodeURIComponent(dashless(eventId))}`,
  });
  return rows.map(parseRsvp);
}

/**
 * One RSVP, proven to belong to `village`. Replaces the Notion parent-database
 * check: without the village predicate an admin JWT from one village could read
 * or patch another village's registration by guessing a uuid. Returns null
 * (→ 404) for a malformed id rather than letting PostgREST reject it as a 502.
 */
export async function getRsvp(id, village) {
  if (!UUID_RE.test(String(id || ''))) return null;
  const row = await selectOne(T_RSVPS, id, village);
  return row ? parseRsvp(row) : null;
}

export async function createRsvp(values) { return insertRow(T_RSVPS, values); }
export async function patchRsvp(id, village, values) { return updateRow(T_RSVPS, id, village, values); }
export async function archiveRsvp(id, village) { return archiveRowById(T_RSVPS, id, village); }

/**
 * _bookings.js — shared helpers for the Facility bookings module.
 *
 * Two stores, deliberately split by data class:
 *   🏛 VF Facilities (NOTION) — the hireable spaces register (v1: the community
 *     hall). Committee edits names/rates/conditions in the admin tool. Content,
 *     no personal data — stays in the CMS. Created once by /api/booking-provision.
 *   bookings (SUPABASE)       — one row per hire request, Status flow:
 *     Requested → Confirmed | Declined → Cancelled / Completed.
 *
 * ── BOOKINGS: SUPABASE, NOT NOTION (Phase 2 of the PII plan, 14 Sep 2026) ───
 * A booking is PUBLIC INTAKE — a resident's name, email and phone typed into
 * the "Hire the hall" form — so it lives in the Sydney Supabase project behind
 * deny-by-default RLS (migration 0014), not in the shared Notion workspace.
 * Cut over with NOTHING to migrate: the Notion "VF Bookings" register held zero
 * rows on the day. NOTION_VF_BOOKINGS_DB_ID is retired.
 *
 * parseBooking() returns the same field names the Notion version did, so
 * /admin/bookings/ needed no functional change. `pageId` in request bodies is
 * now the row's uuid; rows reference their facility by its dashless Notion
 * page id, exactly as the Notion register did.
 *
 * Times: start_at / end_at are LOCAL wall-clock timestamps (no time zone),
 * matching the "YYYY-MM-DDTHH:MM" strings the facilities page has always
 * sent. Postgres hands them back as "YYYY-MM-DDTHH:MM:SS"; parseBooking
 * normalises to the 16-char form so the console and the overlap check see
 * exactly what they always saw. Either form is accepted on write.
 *
 * Payments are the membership pattern: bank transfer now (instructions in the
 * confirmation email), recorded by the committee; Tyro Pay Online plugs in
 * later as a "pay online" path.
 */

// Rate-limit guard for api.notion.com. Side-effect import — see the file.
import './_notion-guard.js';
import {
  selectVillage, selectOne, insertRow, updateRow, archiveRowById,
  slugVillage, clean, money, int, dateOrNull, today, jsonResp, stampBy,
} from './_supa.js';

export { slugVillage, clean, money, int, dateOrNull, today, jsonResp, stampBy };

const NOTION_VERSION = '2022-06-28';

// Fallback = the DB provisioned under the Smiths Lake Community page (Aug 2026).
export const FACILITIES_DB_ID = process.env.NOTION_VF_FACILITIES_DB_ID || '3bfd508adfc18115882be11adc1f7c01';
export const T_BOOKINGS = 'bookings';

// Mirrored by a CHECK constraint in migration 0014 — change one, change both.
export const BOOKING_STATUSES = ['Requested', 'Confirmed', 'Declined', 'Cancelled', 'Completed'];
// Statuses that occupy the calendar (block/flag other requests).
export const OCCUPYING = ['Requested', 'Confirmed'];

export function notionHeaders() {
  return {
    Authorization: `Bearer ${process.env.NOTION_API_KEY}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  };
}

export function notProvisioned() {
  return jsonResp(503, { error: 'Facility bookings is not provisioned yet — run /api/booking-provision and set the DB id env vars.' });
}

export const rtChunks = (str) => {
  const s = String(str || '');
  if (!s) return [];
  const out = [];
  for (let i = 0; i < s.length; i += 1900) out.push({ text: { content: s.slice(i, i + 1900) } });
  return out;
};
export const rtText = (prop) => (prop?.rich_text || []).map((t) => t.plain_text).join('');

/* ── Facilities (Notion) ─────────────────────────────────────────────────── */

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

export function parseFacility(page) {
  const p = page.properties || {};
  return {
    id: page.id,
    name: p.Facility?.title?.[0]?.plain_text || '(unnamed)',
    village: rtText(p.Village),
    description: rtText(p.Description),
    rates: rtText(p.Rates),
    hourlyRate: p['Hourly Rate']?.number ?? null,
    halfDayRate: p['Half Day Rate']?.number ?? null,
    fullDayRate: p['Full Day Rate']?.number ?? null,
    bond: p.Bond?.number ?? null,
    conditions: rtText(p.Conditions),
    status: p.Status?.select?.name || 'Active',
    order: p.Order?.number ?? 99,
  };
}

export async function getFacility(pageId) {
  const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, { headers: notionHeaders() });
  if (!res.ok) return null;
  const page = await res.json();
  const parent = page.parent?.database_id?.replace(/-/g, '');
  if (parent !== FACILITIES_DB_ID.replace(/-/g, '')) return null;
  return parseFacility(page);
}

/* ── Bookings (Supabase) ─────────────────────────────────────────────────── */

const numOrNull = (v) => (v == null ? null : Number(v));
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOCAL_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const dashless = (id) => String(id || '').replace(/-/g, '');

/** Postgres "YYYY-MM-DDTHH:MM:SS" → the "YYYY-MM-DDTHH:MM" the console has always seen. */
export function localMinute(v) {
  if (!v) return null;
  const s = String(v);
  return LOCAL_RE.test(s) ? s.slice(0, 16) : s;
}

/** "YYYY-MM-DDTHH:MM" or "…:SS" → the full local timestamp Postgres stores, else null. */
export function localStamp(v) {
  if (!v) return null;
  const s = String(v);
  if (!LOCAL_RE.test(s)) return null;
  return s.length === 16 ? `${s}:00` : s.slice(0, 19);
}

/** Row → the object the console and the mailers have always received. */
export function parseBooking(r) {
  const facilityTitle = r.facility_title || '';
  const name = r.name || '';
  const start = localMinute(r.start_at);
  return {
    id: r.id,
    title: facilityTitle || name ? `${facilityTitle} — ${name} — ${(start || '').slice(0, 10)}` : '(booking)',
    village: r.village_id || '',
    facilityId: dashless(r.facility_id),
    facility: facilityTitle,
    start,
    end: localMinute(r.end_at),
    name,
    email: r.email || '',
    phone: r.phone || '',
    purpose: r.purpose || '',
    attendees: numOrNull(r.attendees),
    status: r.status || 'Requested',
    feeQuoted: numOrNull(r.fee_quoted),
    bond: numOrNull(r.bond),
    paymentDate: r.payment_date || null,
    paymentReference: r.payment_reference || '',
    amountPaid: numOrNull(r.amount_paid),
    bondReturned: r.bond_returned === true,
    note: r.note || '',
    loggedBy: r.logged_by || '',
    lastUpdatedBy: r.last_updated_by || '',
    lastEmail: r.last_email || '',
    dateRequested: r.date_requested || null,
  };
}

/** Overlap test on local ISO datetimes (string compare is safe for ISO). */
export function overlaps(aStart, aEnd, bStart, bEnd) {
  if (!aStart || !bStart) return false;
  const ae = aEnd || aStart, be = bEnd || bStart;
  return aStart < be && bStart < ae;
}

/**
 * Every live booking for one village, earliest start first. Optional window on
 * start_at: `from` (inclusive) and `before` (exclusive), each a "YYYY-MM-DD"
 * date or a local datetime — replaces the Notion Date on_or_after / before pair.
 */
export async function listBookings(village, { from, before } = {}) {
  const extra = [
    ...(from ? [`start_at=gte.${encodeURIComponent(localStamp(from) || `${dateOrNull(from)}T00:00:00`)}`] : []),
    ...(before ? [`start_at=lt.${encodeURIComponent(localStamp(before) || `${dateOrNull(before)}T00:00:00`)}`] : []),
  ].join('&');
  const rows = await selectVillage(T_BOOKINGS, village, { order: 'start_at.asc', ...(extra ? { extra } : {}) });
  return rows.map(parseBooking);
}

/**
 * One booking, proven to belong to `village`. Replaces the Notion parent-database
 * check: without the village predicate an admin JWT from one village could read
 * or patch another village's booking by guessing a uuid. Returns null (→ 404)
 * for a malformed id rather than letting PostgREST reject it as a 502.
 */
export async function getBooking(id, village) {
  if (!UUID_RE.test(String(id || ''))) return null;
  const row = await selectOne(T_BOOKINGS, id, village);
  return row ? parseBooking(row) : null;
}

export async function createBooking(values) { return insertRow(T_BOOKINGS, values); }
export async function patchBooking(id, village, values) { return updateRow(T_BOOKINGS, id, village, values); }
export async function archiveBooking(id, village) { return archiveRowById(T_BOOKINGS, id, village); }

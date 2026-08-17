/**
 * _bookings.js — shared helpers for the Facility bookings module.
 *
 * Two Notion DBs (created once by /api/booking-provision, siblings of the
 * other VF DBs under the Smiths Lake Community page):
 *   🏛 VF Facilities — the hireable spaces register (v1: the community hall).
 *     Committee edits names/rates/conditions in the admin tool.
 *   📅 VF Bookings  — one row per hire request, Status flow:
 *     Requested → Confirmed | Declined → Cancelled / Completed.
 *
 * Times: the booking's Date property holds start AND end as local ISO
 * datetimes ("2026-09-04T09:00:00") — that makes conflict checks a simple
 * interval overlap on one property.
 *
 * Payments are the membership pattern: bank transfer now (instructions in the
 * confirmation email), recorded by the committee; Tyro Pay Online plugs in
 * later as a "pay online" path.
 */

const NOTION_VERSION = '2022-06-28';

// Fallbacks = the DBs provisioned under the Smiths Lake Community page (Aug 2026).
export const FACILITIES_DB_ID = process.env.NOTION_VF_FACILITIES_DB_ID || '3bfd508adfc18115882be11adc1f7c01';
export const BOOKINGS_DB_ID = process.env.NOTION_VF_BOOKINGS_DB_ID || '3bfd508adfc1811fbdb9fc1c147a07ca';

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

export function jsonResp(statusCode, obj) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
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

export function parseBooking(page) {
  const p = page.properties || {};
  return {
    id: page.id,
    title: p.Booking?.title?.[0]?.plain_text || '(booking)',
    village: rtText(p.Village),
    facilityId: rtText(p['Facility ID']).replace(/-/g, ''),
    facility: rtText(p.Facility),
    start: p.Date?.date?.start || null,
    end: p.Date?.date?.end || null,
    name: rtText(p.Name),
    email: p.Email?.email || '',
    phone: p.Phone?.phone_number || '',
    purpose: rtText(p.Purpose),
    attendees: p.Attendees?.number ?? null,
    status: p.Status?.select?.name || 'Requested',
    feeQuoted: p['Fee Quoted']?.number ?? null,
    bond: p.Bond?.number ?? null,
    paymentDate: p['Payment Date']?.date?.start || null,
    paymentReference: rtText(p['Payment Reference']),
    amountPaid: p['Amount Paid']?.number ?? null,
    bondReturned: !!p['Bond Returned']?.checkbox,
    note: rtText(p.Note),
    loggedBy: rtText(p['Logged By']),
    lastUpdatedBy: rtText(p['Last Updated By']),
    lastEmail: rtText(p['Last Email']),
    dateRequested: p['Date Requested']?.date?.start || null,
  };
}

/** Overlap test on local ISO datetimes (string compare is safe for ISO). */
export function overlaps(aStart, aEnd, bStart, bEnd) {
  if (!aStart || !bStart) return false;
  const ae = aEnd || aStart, be = bEnd || bStart;
  return aStart < be && bStart < ae;
}

/** Fetch a booking and verify parentage. */
export async function getBooking(pageId) {
  const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, { headers: notionHeaders() });
  if (!res.ok) return null;
  const page = await res.json();
  const parent = page.parent?.database_id?.replace(/-/g, '');
  if (parent !== BOOKINGS_DB_ID.replace(/-/g, '')) return null;
  return parseBooking(page);
}

export async function getFacility(pageId) {
  const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, { headers: notionHeaders() });
  if (!res.ok) return null;
  const page = await res.json();
  const parent = page.parent?.database_id?.replace(/-/g, '');
  if (parent !== FACILITIES_DB_ID.replace(/-/g, '')) return null;
  return parseFacility(page);
}

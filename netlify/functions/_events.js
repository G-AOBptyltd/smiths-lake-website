/**
 * _events.js — shared helpers for the Events & ticketing module.
 *
 * Two Notion DBs (siblings of the other VF DBs, shared across villages and
 * scoped by the Village column — the platform pattern):
 *   🎟 VF Events      — one row per event; Status Draft → Published → Closed /
 *                       Cancelled / Completed. Only Published events appear on
 *                       the public page.
 *   🙌 VF Event RSVPs — one row per registration (a party of N seats).
 *                       Status Registered | Waitlist | Cancelled | Attended.
 *
 * v1 is the pre-Tyro model the committee chose: RSVP + capacity + pay at the
 * door (price is display text; payments recorded at check-in). True online
 * ticket sales arrive with each village's own Tyro merchant.
 */

const NOTION_VERSION = '2022-06-28';

export const EVENTS_DB_ID = process.env.NOTION_VF_EVENTS_DB_ID || '3bfd508adfc1814488d5f68e3f6e99b7';
export const RSVPS_DB_ID = process.env.NOTION_VF_EVENT_RSVPS_DB_ID || '3bfd508adfc181068154e994dfb5f285';

export const EVENT_STATUSES = ['Draft', 'Published', 'Closed', 'Cancelled', 'Completed'];
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

export function jsonResp(statusCode, obj) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
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

export function parseRsvp(page) {
  const p = page.properties || {};
  return {
    id: page.id,
    title: p.RSVP?.title?.[0]?.plain_text || '(rsvp)',
    village: rtText(p.Village),
    eventId: rtText(p['Event ID']).replace(/-/g, ''),
    event: rtText(p.Event),
    name: rtText(p.Name),
    firstName: rtText(p['First Name']),
    lastName: rtText(p['Last Name']),
    email: p.Email?.email || '',
    phone: p.Phone?.phone_number || '',
    seats: p.Seats?.number ?? 1,
    status: p.Status?.select?.name || 'Registered',
    message: rtText(p.Message),
    amountPaid: p['Amount Paid']?.number ?? null,
    paymentDate: p['Payment Date']?.date?.start || null,
    dateRsvpd: p['Date RSVPd']?.date?.start || null,
    loggedBy: rtText(p['Logged By']),
    lastUpdatedBy: rtText(p['Last Updated By']),
    lastEmail: rtText(p['Last Email']),
  };
}

/** Seats taken (Registered + Attended) for an event from its RSVP rows. */
export function seatsTaken(rsvps, eventId) {
  const key = String(eventId).replace(/-/g, '');
  return rsvps.filter((r) => r.eventId === key && COUNTED.includes(r.status))
    .reduce((s, r) => s + (r.seats || 1), 0);
}

export async function getEvent(pageId) {
  const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, { headers: notionHeaders() });
  if (!res.ok) return null;
  const page = await res.json();
  const parent = page.parent?.database_id?.replace(/-/g, '');
  if (parent !== EVENTS_DB_ID.replace(/-/g, '')) return null;
  return parseEvent(page);
}

export async function getRsvp(pageId) {
  const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, { headers: notionHeaders() });
  if (!res.ok) return null;
  const page = await res.json();
  const parent = page.parent?.database_id?.replace(/-/g, '');
  if (parent !== RSVPS_DB_ID.replace(/-/g, '')) return null;
  return parseRsvp(page);
}

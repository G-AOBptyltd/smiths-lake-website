/**
 * event-admin.js — the committee's events endpoint.
 *
 * GET  /api/event-admin?village=       → { events, rsvps }        (admin)
 * POST /api/event-admin { village?, action, ... }                 (admin)
 *   save         { pageId?, name, description?, date, startTime?, endTime?,
 *                  location?, capacity?, price?, organiser?, note? }
 *                 create (Draft) or update an event
 *   eventStatus  { pageId, status }    Draft | Published | Closed | Cancelled | Completed
 *   rsvpStatus   { pageId, status }    Registered | Waitlist | Cancelled | Attended
 *                 (promoting a waitlisted party re-checks capacity — override
 *                  with force:true)
 *   rsvpPayment  { pageId, amountPaid?, paymentDate? }   door takings
 *   delete       { pageId, kind: 'event'|'rsvp' }        SUPER-ADMIN only
 *
 * RSVP contact details are PII → village ADMIN only. Writes stamp Last Updated By.
 */

import { requireRole, getRoles } from './_auth.js';
import { requireEntitlement } from './_entitlements.js';
import {
  EVENTS_DB_ID, RSVPS_DB_ID, notionHeaders, jsonResp, notProvisioned, rtChunks,
  queryAll, parseEvent, parseRsvp, getEvent, getRsvp, seatsTaken,
  EVENT_STATUSES, RSVP_STATUSES,
} from './_events.js';

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export const handler = async (event, context) => {
  if (!EVENTS_DB_ID || !RSVPS_DB_ID) return notProvisioned();

  if (event.httpMethod === 'GET') {
    const village = event.queryStringParameters?.village || process.env.VILLAGE_NAME || 'Smiths Lake';
    const auth = requireRole(context, { village, anyOf: ['admin'] });
    if (!auth.ok) return jsonResp(auth.status, { error: auth.error });
    const ent = await requireEntitlement(village, 'events');
    if (!ent.ok) return jsonResp(ent.status, { error: ent.error });
    try {
      const [eventPages, rsvpPages] = await Promise.all([
        queryAll(EVENTS_DB_ID, { property: 'Village', rich_text: { equals: village } },
          [{ property: 'Date', direction: 'descending' }]),
        queryAll(RSVPS_DB_ID, { property: 'Village', rich_text: { equals: village } },
          [{ property: 'Date RSVPd', direction: 'ascending' }]),
      ]);
      return jsonResp(200, { events: eventPages.map(parseEvent), rsvps: rsvpPages.map(parseRsvp) });
    } catch (err) {
      return jsonResp(502, { error: err.message });
    }
  }

  if (event.httpMethod !== 'POST') return jsonResp(405, { error: 'GET or POST only' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch {
    return jsonResp(400, { error: 'Invalid JSON' });
  }

  const village = body.village || process.env.VILLAGE_NAME || 'Smiths Lake';
  const auth = requireRole(context, { village, anyOf: ['admin'] });
  if (!auth.ok) return jsonResp(auth.status, { error: auth.error });
  const stamp = { 'Last Updated By': { rich_text: rtChunks(`${auth.user.email || 'admin'} · ${new Date().toISOString().slice(0, 10)}`) } };

  try {
    if (body.action === 'save') {
      const name = (body.name || '').trim().slice(0, 200);
      if (!name) return jsonResp(400, { error: 'The event needs a name' });
      const date = body.date && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : null;
      if (!date) return jsonResp(400, { error: 'The event needs a date' });
      const startTime = TIME_RE.test(body.startTime) ? body.startTime : '18:00';
      const endTime = TIME_RE.test(body.endTime) ? body.endTime : null;
      const capacity = Number(body.capacity);
      const properties = {
        'Event': { title: [{ text: { content: name } }] },
        'Village': { rich_text: rtChunks(village.slice(0, 100)) },
        'Description': { rich_text: rtChunks((body.description || '').trim().slice(0, 2000)) },
        'Date': { date: { start: `${date}T${startTime}:00`, ...(endTime ? { end: `${date}T${endTime}:00` } : {}) } },
        'Location': { rich_text: rtChunks((body.location || '').trim().slice(0, 300)) },
        'Capacity': { number: Number.isFinite(capacity) && capacity > 0 ? Math.round(capacity) : null },
        'Price': { rich_text: rtChunks((body.price || '').trim().slice(0, 300)) },
        'Organiser': { rich_text: rtChunks((body.organiser || '').trim().slice(0, 200)) },
        'Note': { rich_text: rtChunks((body.note || '').trim().slice(0, 2000)) },
        ...stamp,
      };
      let res;
      if (body.pageId) {
        const existing = await getEvent(body.pageId);
        if (!existing || existing.village !== village) return jsonResp(404, { error: 'Event not found' });
        res = await fetch(`https://api.notion.com/v1/pages/${body.pageId}`, {
          method: 'PATCH', headers: notionHeaders(), body: JSON.stringify({ properties }),
        });
      } else {
        properties['Status'] = { select: { name: 'Draft' } };
        properties['Created By'] = { rich_text: rtChunks(auth.user.email || 'admin') };
        res = await fetch('https://api.notion.com/v1/pages', {
          method: 'POST', headers: notionHeaders(),
          body: JSON.stringify({ parent: { database_id: EVENTS_DB_ID }, properties }),
        });
      }
      if (!res.ok) {
        const detail = await res.text();
        throw new Error(`Notion responded ${res.status}: ${detail.slice(0, 200)}`);
      }
      const page = await res.json();
      return jsonResp(200, { ok: true, pageId: page.id });
    }

    if (body.action === 'eventStatus') {
      if (!EVENT_STATUSES.includes(body.status)) return jsonResp(400, { error: 'Unknown status' });
      const existing = await getEvent(body.pageId);
      if (!existing || existing.village !== village) return jsonResp(404, { error: 'Event not found' });
      const res = await fetch(`https://api.notion.com/v1/pages/${body.pageId}`, {
        method: 'PATCH', headers: notionHeaders(),
        body: JSON.stringify({ properties: { 'Status': { select: { name: body.status } }, ...stamp } }),
      });
      if (!res.ok) throw new Error(`Notion responded ${res.status}`);
      return jsonResp(200, { ok: true });
    }

    if (body.action === 'rsvpStatus') {
      if (!RSVP_STATUSES.includes(body.status)) return jsonResp(400, { error: 'Unknown status' });
      const rsvp = await getRsvp(body.pageId);
      if (!rsvp || rsvp.village !== village) return jsonResp(404, { error: 'RSVP not found' });
      // Promoting off the waitlist re-checks capacity so the door list stays honest.
      if (rsvp.status === 'Waitlist' && ['Registered', 'Attended'].includes(body.status) && body.force !== true) {
        const ev = await getEvent(rsvp.eventId).catch(() => null);
        if (ev && ev.capacity != null) {
          const rsvps = (await queryAll(RSVPS_DB_ID, {
            and: [
              { property: 'Village', rich_text: { equals: village } },
              { property: 'Event ID', rich_text: { equals: rsvp.eventId } },
            ],
          })).map(parseRsvp);
          if (seatsTaken(rsvps, rsvp.eventId) + (rsvp.seats || 1) > ev.capacity) {
            return jsonResp(409, { error: `Still full — promoting this party of ${rsvp.seats || 1} would exceed capacity. Use force to override.`, canForce: true });
          }
        }
      }
      const res = await fetch(`https://api.notion.com/v1/pages/${body.pageId}`, {
        method: 'PATCH', headers: notionHeaders(),
        body: JSON.stringify({ properties: { 'Status': { select: { name: body.status } }, ...stamp } }),
      });
      if (!res.ok) throw new Error(`Notion responded ${res.status}`);
      return jsonResp(200, { ok: true });
    }

    if (body.action === 'rsvpPayment') {
      const rsvp = await getRsvp(body.pageId);
      if (!rsvp || rsvp.village !== village) return jsonResp(404, { error: 'RSVP not found' });
      const amount = Number(body.amountPaid);
      const res = await fetch(`https://api.notion.com/v1/pages/${body.pageId}`, {
        method: 'PATCH', headers: notionHeaders(),
        body: JSON.stringify({ properties: {
          'Amount Paid': { number: Number.isFinite(amount) && amount >= 0 ? amount : null },
          'Payment Date': { date: { start: body.paymentDate || new Date().toISOString().slice(0, 10) } },
          ...stamp,
        } }),
      });
      if (!res.ok) throw new Error(`Notion responded ${res.status}`);
      return jsonResp(200, { ok: true });
    }

    if (body.action === 'delete') {
      if (!getRoles(auth.user).includes('super-admin')) {
        return jsonResp(403, { error: 'Only the super-admin can delete — use Cancelled instead' });
      }
      const target = body.kind === 'event' ? await getEvent(body.pageId) : await getRsvp(body.pageId);
      if (!target || target.village !== village) return jsonResp(404, { error: 'Not found' });
      const res = await fetch(`https://api.notion.com/v1/pages/${body.pageId}`, {
        method: 'PATCH', headers: notionHeaders(), body: JSON.stringify({ archived: true }),
      });
      if (!res.ok) throw new Error(`Notion responded ${res.status}`);
      return jsonResp(200, { ok: true });
    }

    return jsonResp(400, { error: 'Unknown action' });
  } catch (err) {
    return jsonResp(502, { error: err.message });
  }
};

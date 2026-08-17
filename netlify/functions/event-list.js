/**
 * event-list.js — GET /api/event-list?village=   (PUBLIC)
 *
 * Published upcoming events for the public /events/ page, with seats
 * remaining derived server-side. No PII — RSVP rows are only counted.
 */

import {
  EVENTS_DB_ID, RSVPS_DB_ID, jsonResp, notProvisioned,
  queryAll, parseEvent, parseRsvp, seatsTaken,
} from './_events.js';
import { isModulePublic } from './_villages.js';

export const handler = async (event) => {
  if (event.httpMethod !== 'GET') return jsonResp(405, { error: 'GET only' });
  if (!EVENTS_DB_ID || !RSVPS_DB_ID) return notProvisioned();

  const village = event.queryStringParameters?.village || 'Smiths Lake';
  if (!(await isModulePublic(village, 'events'))) return jsonResp(200, { events: [], notPublic: true });

  try {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const [eventPages, rsvpPages] = await Promise.all([
      queryAll(EVENTS_DB_ID, {
        and: [
          { property: 'Village', rich_text: { equals: village } },
          { property: 'Status', select: { equals: 'Published' } },
          { property: 'Date', date: { on_or_after: yesterday } },
        ],
      }, [{ property: 'Date', direction: 'ascending' }]),
      queryAll(RSVPS_DB_ID, { property: 'Village', rich_text: { equals: village } }),
    ]);

    const rsvps = rsvpPages.map(parseRsvp);
    const events = eventPages.map(parseEvent).map((e) => {
      const taken = seatsTaken(rsvps, e.id);
      return {
        id: e.id.replace(/-/g, ''),
        name: e.name, description: e.description, start: e.start, end: e.end,
        location: e.location, price: e.price, organiser: e.organiser,
        capacity: e.capacity,
        seatsLeft: e.capacity != null ? Math.max(0, e.capacity - taken) : null,
      };
    });

    return jsonResp(200, { events });
  } catch (err) {
    return jsonResp(502, { error: err.message });
  }
};

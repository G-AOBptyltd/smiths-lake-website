/**
 * booking-availability.js — GET /api/booking-availability?village=   (PUBLIC)
 *
 * Everything the public "Hire the hall" page needs:
 *   - active facilities with rates/conditions (public information), and
 *   - occupied time slots (Requested/Confirmed) for the next 8 months —
 *     dates and status ONLY, never who booked or why.
 */

import {
  FACILITIES_DB_ID, BOOKINGS_DB_ID, jsonResp, notProvisioned,
  queryAll, parseFacility, parseBooking, OCCUPYING,
} from './_bookings.js';
import { isModulePublic } from './_villages.js';

export const handler = async (event) => {
  if (event.httpMethod !== 'GET') return jsonResp(405, { error: 'GET only' });
  if (!FACILITIES_DB_ID || !BOOKINGS_DB_ID) return notProvisioned();

  const village = event.queryStringParameters?.village || 'Smiths Lake';
  if (!(await isModulePublic(village, 'bookings'))) return jsonResp(200, { facilities: [], slots: [], notPublic: true });

  try {
    const [facPages, bookingPages] = await Promise.all([
      queryAll(FACILITIES_DB_ID, {
        and: [
          { property: 'Village', rich_text: { equals: village } },
          { property: 'Status', select: { equals: 'Active' } },
        ],
      }),
      queryAll(BOOKINGS_DB_ID, {
        and: [
          { property: 'Village', rich_text: { equals: village } },
          { property: 'Date', date: { on_or_after: new Date(Date.now() - 86400000).toISOString().slice(0, 10) } },
        ],
      }),
    ]);

    const facilities = facPages.map(parseFacility).sort((a, b) => a.order - b.order)
      .map((f) => ({
        id: f.id.replace(/-/g, ''),
        name: f.name, description: f.description, rates: f.rates,
        hourlyRate: f.hourlyRate, halfDayRate: f.halfDayRate, fullDayRate: f.fullDayRate,
        bond: f.bond, conditions: f.conditions,
      }));

    const horizon = new Date(Date.now() + 245 * 86400000).toISOString().slice(0, 10);
    const slots = bookingPages.map(parseBooking)
      .filter((b) => OCCUPYING.includes(b.status) && b.start && b.start.slice(0, 10) <= horizon)
      .map((b) => ({ facilityId: b.facilityId, start: b.start, end: b.end, status: b.status }));

    return jsonResp(200, { facilities, slots });
  } catch (err) {
    return jsonResp(502, { error: err.message });
  }
};

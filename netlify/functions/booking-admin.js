/**
 * booking-admin.js — the committee's bookings endpoint.
 *
 * GET  /api/booking-admin?village=       → { bookings, facilities }   (admin)
 *        bookings come from Supabase (PII), facilities from Notion (content)
 * POST /api/booking-admin { village?, pageId, action, ... }           (admin)
 *   status   { status }        Requested | Confirmed | Declined | Cancelled | Completed
 *   payment  { paymentDate?, paymentReference?, amountPaid?, bondReturned? }
 *   details  { date?, startTime?, endTime?, purpose?, attendees?, feeQuoted?, bond?, note? }
 *   delete   { }               SUPER-ADMIN only; soft-deletes the row
 *                              (archived_at — recoverable) — normal flow is Declined/Cancelled
 *
 * `pageId` is the row's uuid — the name is kept so /admin/bookings/ is unchanged.
 * Booking contact details are PII → village ADMIN only (mirrors Membership).
 * Every write stamps last_updated_by. The target row is fetched WITH the
 * village predicate before any write, so an admin JWT from one village can't
 * touch another village's booking. Facility actions live in facility-admin.js.
 */

import { requireRole, getRoles } from './_auth.js';
import { requireEntitlement } from './_entitlements.js';
import {
  FACILITIES_DB_ID, jsonResp, notProvisioned,
  queryAll, parseFacility, listBookings, getBooking, patchBooking, archiveBooking,
  BOOKING_STATUSES, clean, dateOrNull, today, stampBy,
} from './_bookings.js';

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export const handler = async (event, context) => {
  if (!FACILITIES_DB_ID) return notProvisioned();

  if (event.httpMethod === 'GET') {
    const village = event.queryStringParameters?.village || process.env.VILLAGE_NAME || 'Smiths Lake';
    const auth = requireRole(context, { village, anyOf: ['admin'] });
    if (!auth.ok) return jsonResp(auth.status, { error: auth.error });
    const ent = await requireEntitlement(village, 'bookings');
    if (!ent.ok) return jsonResp(ent.status, { error: ent.error });
    try {
      const [bookings, facPages] = await Promise.all([
        listBookings(village),
        queryAll(FACILITIES_DB_ID, { property: 'Village', rich_text: { equals: village } }),
      ]);
      return jsonResp(200, {
        bookings,
        facilities: facPages.map(parseFacility).sort((a, b) => a.order - b.order),
      });
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

  const { pageId, action } = body;
  if (!pageId || !action) return jsonResp(400, { error: 'pageId and action are required' });

  try {
    const booking = await getBooking(pageId, village);
    if (!booking) return jsonResp(404, { error: 'Booking not found' });

    const stamp = { last_updated_by: stampBy(auth.user) };
    let values = null;

    if (action === 'status') {
      if (!BOOKING_STATUSES.includes(body.status)) return jsonResp(400, { error: 'Unknown status' });
      values = { status: body.status, ...stamp };

    } else if (action === 'payment') {
      const amount = Number(body.amountPaid);
      values = {
        ...(body.paymentDate || Number.isFinite(amount)
          ? { payment_date: dateOrNull(body.paymentDate) || today() } : {}),
        payment_reference: clean(body.paymentReference, 200),
        ...(Number.isFinite(amount) ? { amount_paid: Math.round(amount * 100) / 100 } : {}),
        bond_returned: body.bondReturned === true || body.bondReturned === 'true',
        ...stamp,
      };

    } else if (action === 'details') {
      values = { ...stamp };
      const date = body.date && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : (booking.start || '').slice(0, 10);
      const startTime = TIME_RE.test(body.startTime) ? body.startTime : (booking.start || '').slice(11, 16) || '09:00';
      const endTime = TIME_RE.test(body.endTime) ? body.endTime : (booking.end || '').slice(11, 16) || '17:00';
      if (date) {
        // The table enforces end_at > start_at; say so plainly rather than let it 502.
        if (endTime <= startTime) return jsonResp(400, { error: 'The finish time must be after the start time' });
        values.start_at = `${date}T${startTime}:00`;
        values.end_at = `${date}T${endTime}:00`;
      }
      if (body.purpose !== undefined) values.purpose = clean(body.purpose, 500);
      const att = Number(body.attendees);
      if (body.attendees !== undefined) values.attendees = Number.isFinite(att) && att > 0 ? Math.round(att) : null;
      const fee = Number(body.feeQuoted);
      if (body.feeQuoted !== undefined) values.fee_quoted = Number.isFinite(fee) ? Math.round(fee * 100) / 100 : null;
      const bond = Number(body.bond);
      if (body.bond !== undefined) values.bond = Number.isFinite(bond) ? Math.round(bond * 100) / 100 : null;
      if (body.note !== undefined) values.note = clean(body.note, 2000);

    } else if (action === 'delete') {
      if (!getRoles(auth.user).includes('super-admin')) {
        return jsonResp(403, { error: 'Only the super-admin can delete bookings — use Declined or Cancelled instead' });
      }
      await archiveBooking(booking.id, village);
      return jsonResp(200, { ok: true });

    } else {
      return jsonResp(400, { error: 'Unknown action' });
    }

    await patchBooking(booking.id, village, values);
    return jsonResp(200, { ok: true });
  } catch (err) {
    return jsonResp(502, { error: err.message });
  }
};

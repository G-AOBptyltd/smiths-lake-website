/**
 * booking-admin.js — the committee's bookings endpoint.
 *
 * GET  /api/booking-admin?village=       → { bookings, facilities }   (admin)
 * POST /api/booking-admin { village?, pageId, action, ... }           (admin)
 *   status   { status }        Requested | Confirmed | Declined | Cancelled | Completed
 *   payment  { paymentDate?, paymentReference?, amountPaid?, bondReturned? }
 *   details  { date?, startTime?, endTime?, purpose?, attendees?, feeQuoted?, bond?, note? }
 *   delete   { }               SUPER-ADMIN only (Notion trash) — normal flow is Declined/Cancelled
 *
 * Booking contact details are PII → village ADMIN only (mirrors Membership).
 * Every write stamps "Last Updated By".
 */

import { requireRole, getRoles } from './_auth.js';
import { requireEntitlement } from './_entitlements.js';
import {
  BOOKINGS_DB_ID, FACILITIES_DB_ID, notionHeaders, jsonResp, notProvisioned,
  rtChunks, queryAll, parseBooking, parseFacility, getBooking, BOOKING_STATUSES,
} from './_bookings.js';

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export const handler = async (event, context) => {
  if (!BOOKINGS_DB_ID || !FACILITIES_DB_ID) return notProvisioned();

  if (event.httpMethod === 'GET') {
    const village = event.queryStringParameters?.village || process.env.VILLAGE_NAME || 'Smiths Lake';
    const auth = requireRole(context, { village, anyOf: ['admin'] });
    if (!auth.ok) return jsonResp(auth.status, { error: auth.error });
    const ent = await requireEntitlement(village, 'bookings');
    if (!ent.ok) return jsonResp(ent.status, { error: ent.error });
    try {
      const [bookingPages, facPages] = await Promise.all([
        queryAll(BOOKINGS_DB_ID, { property: 'Village', rich_text: { equals: village } },
          [{ property: 'Date', direction: 'ascending' }]),
        queryAll(FACILITIES_DB_ID, { property: 'Village', rich_text: { equals: village } }),
      ]);
      return jsonResp(200, {
        bookings: bookingPages.map(parseBooking),
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
    const booking = await getBooking(pageId);
    if (!booking || booking.village !== village) return jsonResp(404, { error: 'Booking not found' });

    const stamp = { 'Last Updated By': { rich_text: rtChunks(`${auth.user.email || 'admin'} · ${new Date().toISOString().slice(0, 10)}`) } };
    let properties = null;

    if (action === 'status') {
      if (!BOOKING_STATUSES.includes(body.status)) return jsonResp(400, { error: 'Unknown status' });
      properties = { 'Status': { select: { name: body.status } }, ...stamp };

    } else if (action === 'payment') {
      const amount = Number(body.amountPaid);
      properties = {
        ...(body.paymentDate || Number.isFinite(amount)
          ? { 'Payment Date': { date: { start: body.paymentDate || new Date().toISOString().slice(0, 10) } } } : {}),
        'Payment Reference': { rich_text: rtChunks((body.paymentReference || '').trim().slice(0, 200)) },
        ...(Number.isFinite(amount) ? { 'Amount Paid': { number: amount } } : {}),
        'Bond Returned': { checkbox: body.bondReturned === true || body.bondReturned === 'true' },
        ...stamp,
      };

    } else if (action === 'details') {
      properties = { ...stamp };
      const date = body.date && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : (booking.start || '').slice(0, 10);
      const startTime = TIME_RE.test(body.startTime) ? body.startTime : (booking.start || '').slice(11, 16) || '09:00';
      const endTime = TIME_RE.test(body.endTime) ? body.endTime : (booking.end || '').slice(11, 16) || '17:00';
      if (date) properties['Date'] = { date: { start: `${date}T${startTime}:00`, end: `${date}T${endTime}:00` } };
      if (body.purpose !== undefined) properties['Purpose'] = { rich_text: rtChunks(String(body.purpose).trim().slice(0, 500)) };
      const att = Number(body.attendees);
      if (body.attendees !== undefined) properties['Attendees'] = { number: Number.isFinite(att) && att > 0 ? Math.round(att) : null };
      const fee = Number(body.feeQuoted);
      if (body.feeQuoted !== undefined) properties['Fee Quoted'] = { number: Number.isFinite(fee) ? fee : null };
      const bond = Number(body.bond);
      if (body.bond !== undefined) properties['Bond'] = { number: Number.isFinite(bond) ? bond : null };
      if (body.note !== undefined) properties['Note'] = { rich_text: rtChunks(String(body.note).trim().slice(0, 2000)) };

    } else if (action === 'delete') {
      if (!getRoles(auth.user).includes('super-admin')) {
        return jsonResp(403, { error: 'Only the super-admin can delete bookings — use Declined or Cancelled instead' });
      }
      const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
        method: 'PATCH', headers: notionHeaders(), body: JSON.stringify({ archived: true }),
      });
      if (!res.ok) throw new Error(`Notion responded ${res.status}`);
      return jsonResp(200, { ok: true });

    } else {
      return jsonResp(400, { error: 'Unknown action' });
    }

    const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
      method: 'PATCH', headers: notionHeaders(), body: JSON.stringify({ properties }),
    });
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`Notion responded ${res.status}: ${detail.slice(0, 200)}`);
    }
    return jsonResp(200, { ok: true });
  } catch (err) {
    return jsonResp(502, { error: err.message });
  }
};

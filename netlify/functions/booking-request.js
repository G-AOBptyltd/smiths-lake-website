/**
 * booking-request.js — POST /api/booking-request   (PUBLIC, no auth)
 *
 * The "Hire the hall" form. Member-join hardening: honeypot, length caps,
 * nothing trusted from the client. Every request lands as Requested — the
 * committee confirms or declines from /admin/bookings/ (a clash does NOT
 * auto-reject; the committee decides).
 *
 * Body: { village?, facilityId, date (YYYY-MM-DD), startTime ("09:00"),
 *         endTime ("17:00"), firstName, lastName, email, phone?, purpose,
 *         attendees?, note?, website? }
 *
 * Notifies the committee (VF Resend vars, fail-open) with a conflict flag.
 */

import {
  BOOKINGS_DB_ID, FACILITIES_DB_ID, notionHeaders, jsonResp, notProvisioned,
  rtChunks, queryAll, parseBooking, getFacility, overlaps, OCCUPYING,
} from './_bookings.js';
import { isModulePublic, getModuleRecipients } from './_villages.js';

function esc(s) {
  return String(s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

async function notifyCommittee(b, clash, context) {
  const key = process.env.VF_RESEND_API_KEY;
  const to = await getModuleRecipients({ village: b.village, module: 'bookings', context });
  if (!key || !to.length) return;
  const from = process.env.VF_PLEDGE_FROM || 'VillageFirst <noreply@villagefirst.org.au>';
  const rows = [
    ['Facility', b.facility], ['When', `${b.date} ${b.startTime}–${b.endTime}`],
    ['Name', b.fullName], ['Email', b.email], ['Phone', b.phone || '(none given)'],
    ['Purpose', b.purpose], ['Attendees', b.attendees || '(not said)'],
    ['Clash', clash ? '⚠️ OVERLAPS an existing request/booking — check the calendar' : 'None — the slot is free'],
  ].map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;">${esc(k)}</td><td style="padding:4px 0;font-weight:600;">${esc(v)}</td></tr>`).join('');
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1f2937;">
    <h2 style="color:#15795f;">🏛 New hall booking request — ${esc(b.facility)}</h2>
    <p>Someone asked to hire the hall via the website. Review it in <a href="https://villagefirst.org.au/admin/bookings/">Admin → Facility bookings</a> — it stays Requested until you confirm.</p>
    <table style="border-collapse:collapse;font-size:14px;">${rows}</table>
  </div>`;
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject: `Hall booking request — ${b.fullName} · ${b.date}${clash ? ' ⚠️ clash' : ''}`, html }),
    });
  } catch (_) { /* best-effort */ }
}

export const handler = async (event, context) => {
  if (event.httpMethod !== 'POST') return jsonResp(405, { error: 'POST only' });
  if (!BOOKINGS_DB_ID || !FACILITIES_DB_ID) return notProvisioned();

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch {
    return jsonResp(400, { error: 'Invalid request' });
  }

  // Honeypot — pretend success so bots don't learn.
  if ((body.website || '').trim()) return jsonResp(200, { ok: true });

  if (!(await isModulePublic(body.village || 'Smiths Lake', 'bookings'))) {
    return jsonResp(403, { error: 'Online booking is not open yet.' });
  }

  const firstName = (body.firstName || '').trim().slice(0, 100);
  const lastName = (body.lastName || '').trim().slice(0, 100);
  const email = (body.email || '').trim().toLowerCase().slice(0, 200);
  const purpose = (body.purpose || '').trim().slice(0, 500);
  if (!firstName || !lastName) return jsonResp(400, { error: 'Please give us your first and last name.' });
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jsonResp(400, { error: 'Please give us a valid email address.' });
  if (!purpose) return jsonResp(400, { error: 'Please tell us what the booking is for.' });

  const date = String(body.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return jsonResp(400, { error: 'Please pick a date.' });
  if (date < new Date().toISOString().slice(0, 10)) return jsonResp(400, { error: 'That date has already passed.' });
  const startTime = TIME_RE.test(body.startTime) ? body.startTime : null;
  const endTime = TIME_RE.test(body.endTime) ? body.endTime : null;
  if (!startTime || !endTime || endTime <= startTime) return jsonResp(400, { error: 'Please pick a start and finish time (finish after start).' });

  const facility = await getFacility(String(body.facilityId || '').replace(/[^a-f0-9-]/gi, ''));
  if (!facility || facility.status !== 'Active') return jsonResp(400, { error: 'Please choose which space you want to hire.' });

  const phone = (body.phone || '').trim().slice(0, 50);
  const attendees = Number(body.attendees);
  const note = (body.note || '').trim().slice(0, 2000);
  const village = (body.village || 'Smiths Lake').slice(0, 100);
  const fullName = `${firstName} ${lastName}`;
  const start = `${date}T${startTime}:00`;
  const end = `${date}T${endTime}:00`;

  try {
    // Clash check (flagged to the committee, never auto-rejected).
    const dayBookings = (await queryAll(BOOKINGS_DB_ID, {
      and: [
        { property: 'Village', rich_text: { equals: village } },
        { property: 'Date', date: { on_or_after: date } },
        { property: 'Date', date: { before: new Date(new Date(date).getTime() + 86400000).toISOString().slice(0, 10) } },
      ],
    })).map(parseBooking);
    const clash = dayBookings.some((b) =>
      OCCUPYING.includes(b.status) &&
      b.facilityId === facility.id.replace(/-/g, '') &&
      overlaps(b.start, b.end, start, end));

    const res = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: notionHeaders(),
      body: JSON.stringify({
        parent: { database_id: BOOKINGS_DB_ID },
        properties: {
          'Booking': { title: [{ text: { content: `${facility.name} — ${fullName} — ${date}`.slice(0, 200) } }] },
          'Village': { rich_text: rtChunks(village) },
          'Facility': { rich_text: rtChunks(facility.name) },
          'Facility ID': { rich_text: rtChunks(facility.id.replace(/-/g, '')) },
          'Date': { date: { start, end } },
          'Name': { rich_text: rtChunks(fullName) },
          'Email': { email },
          'Phone': phone ? { phone_number: phone } : { phone_number: null },
          'Purpose': { rich_text: rtChunks(purpose) },
          'Attendees': { number: Number.isFinite(attendees) && attendees > 0 ? Math.round(attendees) : null },
          'Status': { select: { name: 'Requested' } },
          'Bond': { number: facility.bond },
          'Note': { rich_text: rtChunks(note) },
          'Logged By': { rich_text: rtChunks(`public form (${email})`) },
          'Date Requested': { date: { start: new Date().toISOString().slice(0, 10) } },
        },
      }),
    });
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`Notion responded ${res.status}: ${detail.slice(0, 200)}`);
    }
    await notifyCommittee({ village, facility: facility.name, date, startTime, endTime, fullName, email, phone, purpose, attendees: body.attendees }, clash, context);
    return jsonResp(200, { ok: true });
  } catch (err) {
    return jsonResp(502, { error: 'Sorry — we could not record your request just now. Please try again shortly.' });
  }
};

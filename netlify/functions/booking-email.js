/**
 * booking-email.js — POST /api/booking-email   (admin)
 *
 * Sends a templated booking email to the requester and stamps "Last Email".
 * Body: { village?, pageId, template }   template ∈ confirmed | declined
 *
 *   confirmed — booking confirmed + fee/bond + how to pay (bank details from
 *               VF_BOOKING_PAY_INSTRUCTIONS, falling back to
 *               VF_MEMBER_PAY_INSTRUCTIONS) + the facility conditions
 *   declined  — a polite "that slot doesn't work" with reply-to the committee
 *
 * Same Resend vars as the other VF mailers; reply-to = first notify address.
 */

import { requireRole } from './_auth.js';
import { notionHeaders, jsonResp, rtChunks, getBooking, getFacility } from './_bookings.js';

function esc(s) {
  return String(s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

function fmtWhen(b) {
  const d = (b.start || '').slice(0, 10);
  const st = (b.start || '').slice(11, 16);
  const en = (b.end || '').slice(11, 16);
  if (!d) return '(date to be confirmed)';
  const [y, m, day] = d.split('-');
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][parseInt(m, 10) - 1];
  return `${parseInt(day, 10)} ${mon} ${y}${st ? `, ${st}–${en}` : ''}`;
}

function wrap(title, bodyHtml, orgName) {
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1f2937;font-size:15px;line-height:1.65;max-width:560px;">
    <h2 style="color:#15795f;">${esc(title)}</h2>
    ${bodyHtml}
    <p style="margin-top:24px;">Warm regards,<br><b>${esc(orgName)}</b></p>
    <p style="font-size:12px;color:#9ca3af;margin-top:18px;">Sent via VillageFirst on behalf of ${esc(orgName)}. Just reply to this email if anything looks wrong.</p>
  </div>`;
}

function buildEmail(template, b, facility, orgName, payInstructions) {
  const first = (b.name || '').split(' ')[0] || 'there';
  const when = fmtWhen(b);

  if (template === 'confirmed') {
    const fee = b.feeQuoted != null ? `$${b.feeQuoted}` : 'to be advised';
    const bond = b.bond != null ? ` plus a refundable bond of <b>$${b.bond}</b>` : '';
    return {
      subject: `Your ${b.facility} booking is confirmed — ${when}`,
      html: wrap(`You're booked in, ${first}! 🏛`, `
        <p>Your booking of the <b>${esc(b.facility)}</b> for <b>${esc(b.purpose)}</b> on <b>${esc(when)}</b> is confirmed.</p>
        <p>The hire fee is <b>${esc(fee)}</b>${bond}.</p>
        ${payInstructions
          ? `<p style="background:#f0fdf6;border:1px solid #bbf7d0;border-radius:8px;padding:12px 14px;">${esc(payInstructions).replace(/\n/g, '<br>')}</p>`
          : '<p>The committee will be in touch about payment and key collection.</p>'}
        ${facility?.conditions ? `<p style="font-size:13.5px;color:#4b5563;"><b>Conditions of hire:</b> ${esc(facility.conditions)}</p>` : ''}
      `, orgName),
    };
  }

  // declined
  return {
    subject: `About your ${b.facility} booking request — ${when}`,
    html: wrap(`Sorry ${first} — that slot doesn't work`, `
      <p>Unfortunately we can't accommodate your request for the <b>${esc(b.facility)}</b> on <b>${esc(when)}</b> — usually this means the hall is already spoken for or being maintained.</p>
      <p>Please reply to this email and we'll happily find you another time that works.</p>
    `, orgName),
  };
}

export const handler = async (event, context) => {
  if (event.httpMethod !== 'POST') return jsonResp(405, { error: 'POST only' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch {
    return jsonResp(400, { error: 'Invalid JSON' });
  }

  const village = body.village || 'Smiths Lake';
  const auth = requireRole(context, { village, anyOf: ['admin'] });
  if (!auth.ok) return jsonResp(auth.status, { error: auth.error });

  const { pageId, template } = body;
  if (!pageId || !['confirmed', 'declined'].includes(template)) {
    return jsonResp(400, { error: 'pageId and a valid template are required' });
  }
  const key = process.env.VF_RESEND_API_KEY;
  if (!key) return jsonResp(400, { error: 'Email is not configured yet (VF_RESEND_API_KEY missing)' });

  try {
    const booking = await getBooking(pageId);
    if (!booking || booking.village !== village) return jsonResp(404, { error: 'Booking not found' });
    if (!booking.email) return jsonResp(400, { error: 'This booking has no email address on file' });

    const facility = booking.facilityId ? await getFacility(booking.facilityId).catch(() => null) : null;
    const orgName = process.env.VF_MEMBER_ORG_NAME || 'Pacific Palms Community Association (PPCA)';
    const payInstructions = process.env.VF_BOOKING_PAY_INSTRUCTIONS || process.env.VF_MEMBER_PAY_INSTRUCTIONS || '';
    const from = process.env.VF_PLEDGE_FROM || 'VillageFirst <noreply@villagefirst.org.au>';
    const replyTo = (process.env.VF_PLEDGE_NOTIFY_TO || '').split(',').map((s) => s.trim()).filter(Boolean)[0];

    const { subject, html } = buildEmail(template, booking, facility, orgName, payInstructions);
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [booking.email], ...(replyTo ? { reply_to: replyTo } : {}), subject, html }),
    });
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`Resend responded ${res.status}: ${detail.slice(0, 200)}`);
    }

    const stampText = `${template} sent ${new Date().toISOString().slice(0, 10)} by ${auth.user.email || 'admin'}`;
    await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
      method: 'PATCH', headers: notionHeaders(),
      body: JSON.stringify({ properties: { 'Last Email': { rich_text: rtChunks(stampText.slice(0, 200)) } } }),
    }).catch(() => { /* the email went — a failed stamp must not report failure */ });

    return jsonResp(200, { ok: true, sent: template, to: booking.email });
  } catch (err) {
    return jsonResp(502, { error: err.message });
  }
};

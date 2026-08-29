/**
 * event-rsvp.js — POST /api/event-rsvp   (PUBLIC, no auth)
 *
 * Registration form on /events/. Member-join hardening (honeypot, caps,
 * nothing trusted). Capacity is enforced SERVER-side at write time:
 *   - seats fit            → Registered
 *   - event full           → Waitlist (told honestly in the response)
 * A confirmation email goes to the registrant (env-gated, fail-open) and the
 * committee is notified.
 *
 * Body: { village?, eventId, firstName, lastName, email, phone?, seats?,
 *         message?, website? }
 */

import {
  RSVPS_DB_ID, EVENTS_DB_ID, notionHeaders, jsonResp, notProvisioned,
  rtChunks, queryAll, parseRsvp, getEvent, seatsTaken,
} from './_events.js';
import { isModulePublic, getModuleRecipients } from './_villages.js';

function esc(s) {
  return String(s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

function fmtWhen(e) {
  if (!e.start) return '(date to be announced)';
  const d = e.start.slice(0, 10), t = e.start.slice(11, 16);
  const [y, m, day] = d.split('-');
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][parseInt(m, 10) - 1];
  return `${parseInt(day, 10)} ${mon} ${y}${t ? `, ${t}` : ''}`;
}

async function sendEmails({ ev, fullName, email, seats, waitlisted, village, context }) {
  const key = process.env.VF_RESEND_API_KEY;
  if (!key) return;
  const from = process.env.VF_PLEDGE_FROM || 'VillageFirst <noreply@villagefirst.org.au>';
  const orgName = process.env.VF_MEMBER_ORG_NAME || 'Pacific Palms Community Association (PPCA)';
  const committee = await getModuleRecipients({ village, module: 'events', context });
  const replyTo = committee[0];
  const when = fmtWhen(ev);

  // 1. Confirmation to the registrant.
  const subject = waitlisted
    ? `You're on the waitlist — ${ev.name}`
    : `You're in! ${ev.name} — ${when}`;
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1f2937;font-size:15px;line-height:1.65;max-width:560px;">
    <h2 style="color:#15795f;">${waitlisted ? 'You’re on the waitlist 📝' : 'You’re in! 🎟'}</h2>
    <p>${waitlisted
      ? `<b>${esc(ev.name)}</b> (${esc(when)}) is currently full, so we've popped ${seats > 1 ? `your party of ${seats}` : 'you'} on the waitlist — we'll email if places open up.`
      : `${seats > 1 ? `Your party of <b>${seats}</b> is` : 'You’re'} registered for <b>${esc(ev.name)}</b> on <b>${esc(when)}</b>${ev.location ? ` at <b>${esc(ev.location)}</b>` : ''}.`}</p>
    ${!waitlisted && ev.price ? `<p><b>Price:</b> ${esc(ev.price)} — payable at the door.</p>` : ''}
    <p style="margin-top:24px;">See you there,<br><b>${esc(orgName)}</b></p>
    <p style="font-size:12px;color:#9ca3af;margin-top:18px;">Sent via VillageFirst on behalf of ${esc(orgName)}. Reply to this email if your plans change.</p>
  </div>`;
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [email], ...(replyTo ? { reply_to: replyTo } : {}), subject, html }),
    });
  } catch (_) { /* best-effort */ }

  // 2. Heads-up to the committee.
  const to = committee;
  if (!to.length) return;
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from, to,
        subject: `RSVP — ${fullName} (${seats}) → ${ev.name}${waitlisted ? ' [waitlist]' : ''}`,
        html: `<p style="font-family:sans-serif;">${esc(fullName)} (${esc(email)}) registered ${seats} seat${seats > 1 ? 's' : ''} for <b>${esc(ev.name)}</b>${waitlisted ? ' — <b>waitlisted (event full)</b>' : ''}. Door list: <a href="${process.env.URL || 'https://villagefirst.org.au'}/admin/events/">Admin → Events</a>.</p>`,
      }),
    });
  } catch (_) { /* best-effort */ }
}

export const handler = async (event, context) => {
  if (event.httpMethod !== 'POST') return jsonResp(405, { error: 'POST only' });
  if (!EVENTS_DB_ID || !RSVPS_DB_ID) return notProvisioned();

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch {
    return jsonResp(400, { error: 'Invalid request' });
  }

  // Honeypot — pretend success so bots don't learn.
  if ((body.website || '').trim()) return jsonResp(200, { ok: true, status: 'Registered' });

  if (!(await isModulePublic(body.village || process.env.VILLAGE_NAME || 'Smiths Lake', 'events'))) {
    return jsonResp(403, { error: 'Event registrations are not open yet.' });
  }

  const firstName = (body.firstName || '').trim().slice(0, 100);
  const lastName = (body.lastName || '').trim().slice(0, 100);
  const email = (body.email || '').trim().toLowerCase().slice(0, 200);
  if (!firstName || !lastName) return jsonResp(400, { error: 'Please give us your first and last name.' });
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jsonResp(400, { error: 'Please give us a valid email address.' });

  const ev = await getEvent(String(body.eventId || '').replace(/[^a-f0-9-]/gi, ''));
  if (!ev || ev.status !== 'Published') return jsonResp(400, { error: 'That event is not taking registrations right now.' });

  const seats = Math.min(10, Math.max(1, Math.round(Number(body.seats) || 1)));
  const phone = (body.phone || '').trim().slice(0, 50);
  const message = (body.message || '').trim().slice(0, 1000);
  const village = (body.village || process.env.VILLAGE_NAME || 'Smiths Lake').slice(0, 100);
  const fullName = `${firstName} ${lastName}`;

  try {
    // Capacity check at write time (server-derived, never from the client).
    let waitlisted = false;
    if (ev.capacity != null) {
      const rsvps = (await queryAll(RSVPS_DB_ID, {
        and: [
          { property: 'Village', rich_text: { equals: village } },
          { property: 'Event ID', rich_text: { equals: ev.id.replace(/-/g, '') } },
        ],
      })).map(parseRsvp);
      waitlisted = seatsTaken(rsvps, ev.id) + seats > ev.capacity;
    }

    const res = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: notionHeaders(),
      body: JSON.stringify({
        parent: { database_id: RSVPS_DB_ID },
        properties: {
          'RSVP': { title: [{ text: { content: `${fullName} — ${ev.name}`.slice(0, 200) } }] },
          'Village': { rich_text: rtChunks(village) },
          'Event ID': { rich_text: rtChunks(ev.id.replace(/-/g, '')) },
          'Event': { rich_text: rtChunks(ev.name) },
          'Name': { rich_text: rtChunks(fullName) },
          'First Name': { rich_text: rtChunks(firstName) },
          'Last Name': { rich_text: rtChunks(lastName) },
          'Email': { email },
          'Phone': phone ? { phone_number: phone } : { phone_number: null },
          'Seats': { number: seats },
          'Status': { select: { name: waitlisted ? 'Waitlist' : 'Registered' } },
          'Message': { rich_text: rtChunks(message) },
          'Date RSVPd': { date: { start: new Date().toISOString().slice(0, 10) } },
          'Logged By': { rich_text: rtChunks(`public form (${email})`) },
        },
      }),
    });
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`Notion responded ${res.status}: ${detail.slice(0, 200)}`);
    }
    await sendEmails({ ev, fullName, email, seats, waitlisted, village, context });
    return jsonResp(200, { ok: true, status: waitlisted ? 'Waitlist' : 'Registered', seats });
  } catch (err) {
    return jsonResp(502, { error: 'Sorry — we could not record your registration just now. Please try again shortly.' });
  }
};

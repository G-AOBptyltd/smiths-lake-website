/**
 * member-join.js — POST /api/member-join   (PUBLIC, no auth)
 *
 * PPCA membership application form on /membership/ writes straight to the
 * member register as an Applied entry. Mirrors the contrib-pledge pattern —
 * the only unauthenticated writer to that register, so it is deliberately
 * narrow:
 *   - always status = Applied  (the committee approves / marks Paid in /admin/)
 *   - "logged_by" is stamped "public form" (+ email), never trusted input
 *   - a honeypot field ("website") must be empty, or we silently accept-and-drop
 *   - all fields are length-capped; fee is derived server-side from the type,
 *     never taken from the client
 *
 * Body: { village?, firstName, lastName, email, phone?, address, postalAddress?,
 *         membershipType, residentCategory?, paymentMethod, stayConnected?,
 *         note?, website? }
 * membershipType ∈ Individual ($10) | Household ($20).
 * Membership year runs 1 July – 30 June; derived from today's date.
 *
 * The register lives in Supabase behind deny-by-default RLS (migration 0013);
 * this function reaches it with the service role, which is exactly why it is
 * kept this narrow — it can only ever INSERT an Applied row.
 *
 * OPTIONAL email notification to PPCA (env-gated, fail-open) — reuses the
 * VillageFirst Resend account vars from contrib-pledge:
 *   VF_RESEND_API_KEY / VF_PLEDGE_NOTIFY_TO / VF_PLEDGE_FROM
 */

import { getModuleRecipients } from './_villages.js';
import {
  MEMBERSHIP_FEES, PAYMENT_METHODS, RESIDENT_CATEGORIES, membershipYear,
  createMember, slugVillage, clean, jsonResp,
} from './_members.js';

function esc(s) {
  return String(s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

/** Notify PPCA of a new application. Env-gated and fail-open like notifyPledge. */
async function notifyApplication(m, context) {
  const key = process.env.VF_RESEND_API_KEY;
  const to = await getModuleRecipients({ village: m.village, module: 'members', context });
  if (!key || !to.length) return; // not configured — stay silent
  const from = process.env.VF_PLEDGE_FROM || 'VillageFirst <noreply@villagefirst.org.au>';

  const rows = [
    ['Name', m.fullName],
    ['Membership', `${m.membershipType} — $${m.fee} (${m.year})`],
    ['Email', m.email],
    ['Phone', m.phone || '(none given)'],
    ['Address', m.address],
    ['Payment', m.paymentMethod],
    ['Updates list', m.stayConnected ? 'Yes — add to community updates' : 'No'],
    ['Village', m.village],
    ['Date', m.date],
  ].map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;">${esc(k)}</td><td style="padding:4px 0;font-weight:600;">${esc(v)}</td></tr>`).join('');

  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1f2937;">
    <h2 style="color:#15795f;">🪪 New membership application — ${esc(m.village)}</h2>
    <p>Someone just applied to join ${process.env.VILLAGE_ENTITY_SHORT || process.env.VILLAGE_NAME || 'PPCA'} via the website. The application is in the member register with Status = Applied — review it in <a href="${process.env.URL || 'https://villagefirst.org.au'}/admin/members/">Admin → Membership</a>.</p>
    <table style="border-collapse:collapse;font-size:14px;">${rows}</table>
  </div>`;

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject: `New ${process.env.VILLAGE_ENTITY_SHORT || process.env.VILLAGE_NAME || 'PPCA'} membership application — ${m.fullName}`, html }),
    });
  } catch (_) { /* email is best-effort; never block the application */ }
}

export const handler = async (event, context) => {
  if (event.httpMethod !== 'POST') return jsonResp(405, { error: 'POST only' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch {
    return jsonResp(400, { error: 'Invalid request' });
  }

  // Honeypot — real people leave this empty. Pretend success so bots don't learn.
  if ((body.website || '').trim()) return jsonResp(200, { ok: true });

  const firstName = (body.firstName || '').trim().slice(0, 100);
  const lastName = (body.lastName || '').trim().slice(0, 100);
  const email = (body.email || '').trim().slice(0, 200);
  const address = (body.address || '').trim().slice(0, 300);
  if (!firstName || !lastName) return jsonResp(400, { error: 'Please give us your first and last name.' });
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jsonResp(400, { error: 'Please give us a valid email address.' });
  if (!address) return jsonResp(400, { error: 'Please give us your residential address — the member register requires it.' });
  const membershipType = Object.hasOwn(MEMBERSHIP_FEES, body.membershipType) ? body.membershipType : null;
  if (!membershipType) return jsonResp(400, { error: 'Please choose a membership type.' });

  const fee = MEMBERSHIP_FEES[membershipType];
  const phone = (body.phone || '').trim().slice(0, 50);
  const postalAddress = (body.postalAddress || '').trim().slice(0, 300);
  const residentCategory = RESIDENT_CATEGORIES.includes(body.residentCategory) ? body.residentCategory : null;
  const paymentMethod = PAYMENT_METHODS.includes(body.paymentMethod) ? body.paymentMethod : PAYMENT_METHODS[0];
  const stayConnected = body.stayConnected === true || body.stayConnected === 'true';
  const note = (body.note || '').trim().slice(0, 2000);
  const village = (body.village || process.env.VILLAGE_NAME || 'Smiths Lake').slice(0, 100);
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const year = membershipYear(now);
  const fullName = `${firstName} ${lastName}`;

  try {
    await createMember({
      village_id: slugVillage(village),
      first_name: firstName,
      last_name: lastName,
      email,
      phone: phone || null,
      residential_address: address,
      postal_address: postalAddress || null,
      membership_type: membershipType,
      fee,
      resident_category: residentCategory,
      membership_year: year,
      payment_method: paymentMethod,
      status: 'Applied',                                   // the ONLY status this path can write
      stay_connected: stayConnected,
      date_applied: date,
      note: clean(note, 2000),
      logged_by: `public form (${email})`.slice(0, 200),
    });
    await notifyApplication({ fullName, membershipType, fee, year, email, phone, address, paymentMethod, stayConnected, village, date }, context);
    return jsonResp(200, { ok: true, fee, year, paymentMethod });
  } catch (err) {
    return jsonResp(502, { error: 'Sorry — we could not record your application just now. Please try again shortly.' });
  }
};

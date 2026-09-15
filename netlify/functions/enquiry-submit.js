/**
 * enquiry-submit.js — POST /api/enquiry-submit   (PUBLIC, no auth)
 *
 * /contact/ and /feedback/ off Netlify Forms and into Supabase.
 *
 * WHY. Both forms wrote to Netlify Forms and NOWHERE ELSE: a US-hosted store
 * sitting outside the site's own privacy policy, with no retention control, no
 * village scoping and no way for the committee to work a queue. A resident
 * telling the association about a flooded road was PII in a place the privacy
 * policy never mentioned. Migration 0020 gives them `enquiries`, which the
 * retention engine (0016/0019) already knows how to age out.
 *
 * Deliberately narrow, same shape as contrib-pledge / member-join:
 *   - a honeypot field ("website") must be empty, or we silently accept-and-drop
 *   - all fields are length-capped; the email is regex-checked
 *   - status is ALWAYS 'New' — only the committee can move an enquiry along
 *   - kind is one of contact | feedback, nothing else
 *
 * Body: { village?, kind, name, email, phone?, subject, category?, message,
 *         project?, priority?, sourcePage, website? }
 *
 * OPTIONAL committee notification (env-gated, fail-open) — reuses the
 * VillageFirst Resend account vars:
 *   VF_RESEND_API_KEY / VF_PLEDGE_NOTIFY_TO / VF_PLEDGE_FROM
 * Recipients come from getNotifyRecipients(village) — the village's own notify
 * list. There is no 'contact' entry in the role×module matrix (there is no
 * enquiries console yet), and routing a resident's message to super-admins
 * only would be worse than routing it to the committee address the village
 * already nominated.
 */

import { getNotifyRecipients } from './_villages.js';
import {
  ENQUIRY_KINDS, createEnquiry, isEmail, slugVillage, clean, jsonResp,
} from './_subscribers.js';

function esc(s) {
  return String(s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

/** Notify the committee. Env-gated and fail-open like notifyPledge. */
async function notifyEnquiry(e) {
  const key = process.env.VF_RESEND_API_KEY;
  if (!key) return;
  const to = await getNotifyRecipients(e.village);
  if (!to.length) return; // not configured — stay silent
  const from = process.env.VF_PLEDGE_FROM || 'VillageFirst <noreply@villagefirst.org.au>';

  const rows = [
    ['From', e.name],
    ['Email', e.email],
    ['Phone', e.phone || '(none given)'],
    ['Subject', e.subject || '(none)'],
    ['Category', e.category || '(none)'],
    ...(e.project ? [['Project', e.project]] : []),
    ...(e.priority ? [['Importance', e.priority]] : []),
    ['Page', e.sourcePage || '(unknown)'],
    ['Village', e.village],
  ].map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;">${esc(k)}</td><td style="padding:4px 0;font-weight:600;">${esc(v)}</td></tr>`).join('');

  const heading = e.kind === 'feedback' ? '💬 New community feedback' : '✉️ New enquiry';
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1f2937;">
    <h2 style="color:#15795f;">${heading} — ${esc(e.village)}</h2>
    <table style="border-collapse:collapse;font-size:14px;">${rows}</table>
    <p style="white-space:pre-wrap;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;margin-top:16px;">${esc(e.message)}</p>
    <p style="font-size:13px;color:#6b7280;">Reply straight to this email to answer ${esc(e.name)}.</p>
  </div>`;

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to,
        reply_to: e.email,                       // the committee answers the resident, not us
        subject: `${e.kind === 'feedback' ? 'Feedback' : 'Enquiry'} from ${e.name}${e.subject ? ` — ${e.subject}` : ''}`,
        html,
      }),
    });
  } catch (_) { /* email is best-effort; never block the enquiry */ }
}

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return jsonResp(405, { error: 'POST only' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch {
    return jsonResp(400, { error: 'Invalid request' });
  }

  // Honeypot — real people leave this empty. Pretend success so bots don't learn.
  if ((body.website || '').trim()) return jsonResp(200, { ok: true });

  const kind = ENQUIRY_KINDS.includes(body.kind) ? body.kind : 'contact';
  const name = (body.name || '').trim().slice(0, 200);
  const email = (body.email || '').trim().slice(0, 200);
  const message = (body.message || '').trim().slice(0, 5000);
  if (!name) return jsonResp(400, { error: 'Please tell us your name.' });
  if (!isEmail(email)) return jsonResp(400, { error: 'Please give us a valid email address so we can reply.' });
  if (!message) return jsonResp(400, { error: 'Please tell us what you would like to say.' });

  const village = (body.village || process.env.VILLAGE_NAME || 'Smiths Lake').slice(0, 100);
  const values = {
    village_id: slugVillage(village),
    kind,
    name,
    email,
    phone: clean(body.phone, 50),
    subject: clean(body.subject, 200),
    category: clean(body.category, 100),
    message,
    project: clean(body.project, 200),
    priority: clean(body.priority, 50),
    status: 'New',                                   // the ONLY status this path can write
    source_page: clean(body.sourcePage, 200),
  };

  try {
    await createEnquiry(values);
    await notifyEnquiry({
      kind, name, email, village,
      phone: values.phone, subject: values.subject, category: values.category,
      project: values.project, priority: values.priority, message,
      sourcePage: values.source_page,
    });
    return jsonResp(200, { ok: true });
  } catch (err) {
    return jsonResp(502, { error: 'Sorry — we could not send that just now. Please try again shortly.' });
  }
};

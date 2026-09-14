/**
 * contrib-pledge.js — POST /api/contrib-pledge   (PUBLIC, no auth)
 *
 * Public "pledge / offer" form on /contribute writes straight to the
 * contributions ledger as a Pledged entry, so it appears in the admin ledger
 * (/admin/contrib) immediately. This is the ONLY unauthenticated writer to
 * that table, so it is deliberately narrow:
 *   - always status = Pledged  (never "Received" — a stranger can't confirm receipt)
 *   - logged_by is stamped "public form" (+ contact if given), never trusted input
 *   - a honeypot field ("website") must be empty, or we silently accept-and-drop
 *   - all fields are length-capped
 *
 * Storage: Supabase (Phase 3 of the PII plan) — the row carries the visitor's
 * name and contact, so it never touches Notion. See _contrib.js.
 *
 * Body: { village?, contributor, type, amount?, hours?, note?, contact?, website? }
 * type ∈ Money | Time in kind | Donated service | Gift  (defaults Money).
 *
 * OPTIONAL email notification to PPCA (env-gated, fail-open):
 *   Set ALL of these — a VillageFirst-owned email account, NOT Agility Ops:
 *     VF_RESEND_API_KEY   — a VillageFirst Resend API key (separate account)
 *     VF_PLEDGE_NOTIFY_TO — recipient(s), comma-separated (e.g. greg@villagefirst.org.au)
 *     VF_PLEDGE_FROM      — optional; verified sender, default noreply@villagefirst.org.au
 *   Until these exist the pledge just saves silently. Email never blocks the pledge.
 */

import { getModuleRecipients } from './_villages.js';
import {
  PUBLIC_TYPES, contributionValues, createContribution, slugVillage, jsonResp,
} from './_contrib.js';

function esc(s) {
  return String(s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

/**
 * Notify PPCA of a new pledge. Fully env-gated and fail-open: if the VF email
 * env vars are absent, or the send fails, we return quietly — the pledge is
 * already saved, so a missing/broken email must never surface to the visitor.
 * Uses a VillageFirst-owned Resend account (separate from any Agility Ops email).
 */
async function notifyPledge(p, context) {
  const key = process.env.VF_RESEND_API_KEY;
  const to = await getModuleRecipients({ village: p.village, module: 'contrib', context });
  if (!key || !to.length) return; // not configured — stay silent
  const from = process.env.VF_PLEDGE_FROM || 'VillageFirst <noreply@villagefirst.org.au>';

  const give = p.type === 'Time in kind'
    ? (p.hours ? `${p.hours} hours` : 'time in kind')
    : (p.amount ? `$${p.amount}` : p.type);
  const rows = [
    ['Contributor', p.contributor],
    ['Wants to give', `${p.type}${give ? ` — ${give}` : ''}`],
    ['Contact', p.contact || '(none given)'],
    ['Message', p.note || '(none)'],
    ['Public board', p.showPublicly ? 'Yes — happy to be thanked publicly' : 'No — private'],
    ['Village', p.village],
    ['Date', p.date],
  ].map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;">${esc(k)}</td><td style="padding:4px 0;font-weight:600;">${esc(v)}</td></tr>`).join('');

  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1f2937;">
    <h2 style="color:#15795f;">🤝 New pledge — ${esc(p.village)}</h2>
    <p>Someone just offered to support the community via the website. Details are in the admin ledger too.</p>
    <table style="border-collapse:collapse;font-size:14px;">${rows}</table>
    <p style="margin-top:16px;"><a href="${process.env.URL || 'https://villagefirst.org.au'}/admin/contrib/">Open the Contributions ledger →</a></p>
  </div>`;

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject: `New pledge from ${p.contributor} — ${p.village}`, html }),
    });
  } catch (_) { /* email is best-effort; never block the pledge */ }
}

export const handler = async (event, context) => {
  if (event.httpMethod !== 'POST') return jsonResp(405, { error: 'POST only' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch {
    return jsonResp(400, { error: 'Invalid request' });
  }

  // Honeypot — real people leave this empty. Bots fill every field.
  // Pretend success so the bot doesn't learn it was filtered.
  if ((body.website || '').trim()) return jsonResp(200, { ok: true });

  const contributor = (body.contributor || '').trim();
  if (!contributor) return jsonResp(400, { error: 'Please tell us your name.' });
  if (contributor.length > 200) return jsonResp(400, { error: 'That name looks too long.' });

  const village = (body.village || process.env.VILLAGE_NAME || 'Smiths Lake').slice(0, 100);
  const type = PUBLIC_TYPES.includes(body.type) ? body.type : 'Money';
  const contact = (body.contact || '').trim().slice(0, 200);
  const loggedBy = contact ? `public form (${contact})` : 'public form';

  // The public form never sets a date or status: today, Pledged.
  const values = {
    village_id: slugVillage(village),
    ...contributionValues({ ...body, contributor, type, date: null }),
    status: 'Pledged',
    logged_by: loggedBy.slice(0, 200),
  };

  try {
    await createContribution(values);
    // Best-effort PPCA notification (env-gated, fail-open) — never blocks the pledge.
    await notifyPledge({
      village, contributor, type,
      amount: values.amount, hours: values.hours, note: values.note || '',
      contact, date: values.date, showPublicly: values.show_publicly,
    }, context);
    return jsonResp(200, { ok: true });
  } catch (err) {
    return jsonResp(502, { error: 'Sorry — we could not record that just now. Please try again shortly.' });
  }
};

/**
 * contrib-pledge.js — POST /api/contrib-pledge   (PUBLIC, no auth)
 *
 * Public "pledge / offer" form on /contribute writes straight to the VF
 * Contributions DB as a Pledged entry, so it appears in the admin ledger
 * (/admin/contrib) immediately. This is the ONLY unauthenticated writer to
 * that DB, so it is deliberately narrow:
 *   - always Status = Pledged  (never "Received" — a stranger can't confirm receipt)
 *   - "Logged by" is stamped "public form" (+ contact if given), never trusted input
 *   - a honeypot field ("website") must be empty, or we silently accept-and-drop
 *   - all fields are length-capped
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

const NOTION_VERSION = '2022-06-28';
const CONTRIB_DB_ID = process.env.NOTION_CONTRIB_DB_ID || '6d182a0d4f0c42c2879f13753e355861';

const PUBLIC_TYPES = ['Money', 'Time in kind', 'Donated service', 'Gift'];

function corsHeaders() {
  return { 'Content-Type': 'application/json' };
}

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
    <p style="margin-top:16px;"><a href="https://villagefirst.org.au/admin/contrib/">Open the Contributions ledger →</a></p>
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
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders(), body: JSON.stringify({ error: 'POST only' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch {
    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'Invalid request' }) };
  }

  // Honeypot — real people leave this empty. Bots fill every field.
  // Pretend success so the bot doesn't learn it was filtered.
  if ((body.website || '').trim()) {
    return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ ok: true }) };
  }

  const contributor = (body.contributor || '').trim();
  if (!contributor) {
    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'Please tell us your name.' }) };
  }
  if (contributor.length > 200) {
    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'That name looks too long.' }) };
  }

  const village = (body.village || 'Smiths Lake').slice(0, 100);
  const type = PUBLIC_TYPES.includes(body.type) ? body.type : 'Money';
  const note = (body.note || '').trim().slice(0, 2000);
  const contact = (body.contact || '').trim().slice(0, 200);
  const date = new Date().toISOString().slice(0, 10);
  const amount = Number(body.amount);
  const hours = Number(body.hours);

  const loggedBy = contact ? `public form (${contact})` : 'public form';
  const showPublicly = body.showPublicly === true || body.showPublicly === 'true';
  const displayName = (body.displayName || '').trim().slice(0, 60);

  const properties = {
    'Contributor': { title: [{ text: { content: contributor } }] },
    'Type': { select: { name: type } },
    'Status': { select: { name: 'Pledged' } },
    'Note': { rich_text: note ? [{ text: { content: note } }] : [] },
    'Contact': { rich_text: contact ? [{ text: { content: contact } }] : [] },
    'Date': { date: { start: date } },
    'Logged by': { rich_text: [{ text: { content: loggedBy.slice(0, 200) } }] },
    'Village': { rich_text: [{ text: { content: village } }] },
    'Amount': { number: Number.isFinite(amount) && amount > 0 ? amount : null },
    'Hours': { number: Number.isFinite(hours) && hours > 0 ? hours : null },
    // Opt-in to the public supporters board. Default false — silence is not consent.
    'Show Publicly': { checkbox: showPublicly },
    'Display Name': { rich_text: displayName ? [{ text: { content: displayName } }] : [] },
  };

  try {
    const res = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.NOTION_API_KEY}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ parent: { database_id: CONTRIB_DB_ID }, properties }),
    });
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`Notion responded ${res.status}: ${detail.slice(0, 200)}`);
    }
    // Best-effort PPCA notification (env-gated, fail-open) — never blocks the pledge.
    await notifyPledge({ village, contributor, type, amount, hours, note, contact, date, showPublicly }, context);
    return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ ok: true }) };
  } catch (err) {
    return { statusCode: 502, headers: corsHeaders(), body: JSON.stringify({ error: 'Sorry — we could not record that just now. Please try again shortly.' }) };
  }
};

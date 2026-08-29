/**
 * member-join.js — POST /api/member-join   (PUBLIC, no auth)
 *
 * PPCA membership application form on /membership/ writes straight to the
 * VF Members DB (the PPCA member register) as an Applied entry. Mirrors the
 * contrib-pledge pattern — the only unauthenticated writer to that DB, so it
 * is deliberately narrow:
 *   - always Status = Applied  (committee approves / marks Paid in Notion)
 *   - "Logged by" is stamped "public form" (+ email), never trusted input
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
 * OPTIONAL email notification to PPCA (env-gated, fail-open) — reuses the
 * VillageFirst Resend account vars from contrib-pledge:
 *   VF_RESEND_API_KEY / VF_PLEDGE_NOTIFY_TO / VF_PLEDGE_FROM
 */

const NOTION_VERSION = '2022-06-28';
const MEMBERS_DB_ID = process.env.NOTION_MEMBERS_DB_ID || '494becca311c4d668a0f7f2750c08a74';

const MEMBERSHIP_FEES = { Individual: 10, Household: 20 };
const PAYMENT_METHODS = ['Bank transfer', 'Cash at meeting', 'Notify when online payments open'];
const RESIDENT_CATEGORIES = [
  'Permanent Resident',
  'Holiday Home Owner',
  'Renter',
  'Visitor / Prospective Resident',
  'Local Business',
];

function corsHeaders() {
  return { 'Content-Type': 'application/json' };
}

function esc(s) {
  return String(s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

/** Membership year label for a date: 1 July–30 June, e.g. "2026-27". */
function membershipYear(d) {
  const y = d.getUTCFullYear();
  const startYear = d.getUTCMonth() >= 6 ? y : y - 1; // months 0-indexed; 6 = July
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

/** Notify PPCA of a new application. Env-gated and fail-open like notifyPledge. */
async function notifyApplication(m) {
  const key = process.env.VF_RESEND_API_KEY;
  const to = (process.env.VF_PLEDGE_NOTIFY_TO || '').split(',').map((s) => s.trim()).filter(Boolean);
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
    <p>Someone just applied to join ${process.env.VILLAGE_ENTITY_SHORT || process.env.VILLAGE_NAME || 'PPCA'} via the website. The application is in the VF Members register with Status = Applied.</p>
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

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders(), body: JSON.stringify({ error: 'POST only' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch {
    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'Invalid request' }) };
  }

  // Honeypot — real people leave this empty. Pretend success so bots don't learn.
  if ((body.website || '').trim()) {
    return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ ok: true }) };
  }

  const firstName = (body.firstName || '').trim().slice(0, 100);
  const lastName = (body.lastName || '').trim().slice(0, 100);
  const email = (body.email || '').trim().slice(0, 200);
  const address = (body.address || '').trim().slice(0, 300);
  if (!firstName || !lastName) {
    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'Please give us your first and last name.' }) };
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'Please give us a valid email address.' }) };
  }
  if (!address) {
    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'Please give us your residential address — the member register requires it.' }) };
  }
  const membershipType = Object.hasOwn(MEMBERSHIP_FEES, body.membershipType) ? body.membershipType : null;
  if (!membershipType) {
    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'Please choose a membership type.' }) };
  }

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

  const properties = {
    'Member': { title: [{ text: { content: fullName } }] },
    'First Name': { rich_text: [{ text: { content: firstName } }] },
    'Last Name': { rich_text: [{ text: { content: lastName } }] },
    'Email': { email },
    'Phone': phone ? { phone_number: phone } : { phone_number: null },
    'Residential Address': { rich_text: [{ text: { content: address } }] },
    'Postal Address': { rich_text: postalAddress ? [{ text: { content: postalAddress } }] : [] },
    'Membership Type': { select: { name: membershipType } },
    'Fee': { number: fee },
    'Resident Category': residentCategory ? { select: { name: residentCategory } } : { select: null },
    'Membership Year': { select: { name: year } },
    'Payment Method': { select: { name: paymentMethod } },
    'Status': { select: { name: 'Applied' } },
    'Stay Connected': { checkbox: stayConnected },
    'Date Applied': { date: { start: date } },
    'Village': { rich_text: [{ text: { content: village } }] },
    'Note': { rich_text: note ? [{ text: { content: note } }] : [] },
    'Logged by': { rich_text: [{ text: { content: `public form (${email})`.slice(0, 200) } }] },
  };

  try {
    const res = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.NOTION_API_KEY}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ parent: { database_id: MEMBERS_DB_ID }, properties }),
    });
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`Notion responded ${res.status}: ${detail.slice(0, 200)}`);
    }
    await notifyApplication({ fullName, membershipType, fee, year, email, phone, address, paymentMethod, stayConnected, village, date });
    return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ ok: true, fee, year, paymentMethod }) };
  } catch (err) {
    return { statusCode: 502, headers: corsHeaders(), body: JSON.stringify({ error: 'Sorry — we could not record your application just now. Please try again shortly.' }) };
  }
};

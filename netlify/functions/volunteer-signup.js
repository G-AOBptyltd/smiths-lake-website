/**
 * volunteer-signup.js — POST /api/volunteer-signup   (PUBLIC, no auth)
 *
 * "Volunteer for this group" forms on the card detail pages (e.g.
 * /environment/landcare-and-bush-regeneration/) post here. Mirrors the
 * member-join hardening: honeypot, length caps, no trusted input.
 *
 * Body: { village?, cardPath, cardTitle, firstName, lastName, email, phone?,
 *         message?, isMember?, website? }
 *
 * Writes to the volunteer app's Supabase (`volunteers` + `volunteer_groups`),
 * which has been the source of truth since 7 Sep 2026. Upsert by email+village:
 * an existing volunteer signing up for a second group gets that group APPENDED
 * to their record; a new email creates a `volunteers` row. A person's details
 * never go to Notion from here — the Notion write that used to lead this
 * function (and that the 7 Sep migration had already drained) was removed on
 * 14 Sep 2026 under the PII plan: a public form re-populating a retired
 * register is exactly the write path that plan exists to close.
 *
 * Notifies the card's stewards (or the village notify list if the card has
 * none) via the VF Resend vars — env-gated, fail-open. Stewards are still read
 * from Notion (PII plan Phase 3); the message text reaches them in that email.
 */

import { STEWARDS_DB_ID, jsonResp, queryAll, parseSteward, normPath } from './_stewards.js';
import { getModuleRecipients } from './_villages.js';
import { supaConfigured, slugVillage } from './_supa.js';

function esc(s) {
  return String(s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

// ── The write: the volunteer app's Supabase ───────────────────────────────
// This is the authoritative path. It THROWS on failure so the resident sees the
// "could not record your signup" message rather than a false success — losing a
// signup silently is worse than asking them to try again.
const SUPA_URL = process.env.VAPP_SUPABASE_URL;
const SUPA_KEY = process.env.VAPP_SUPABASE_SERVICE_KEY;

async function supaReq(path, opts = {}) {
  // Bounded so a Supabase stall cannot hang the public form; on timeout the
  // caller's catch returns the 502 message.
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetch(`${SUPA_URL}/rest/v1/${path}`, {
      ...opts,
      signal: ctl.signal,
      headers: {
        apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`,
        'Content-Type': 'application/json', ...(opts.headers || {}),
      },
    });
    const text = await res.text();
    let data = null; try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; }
    return { ok: res.ok, status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Upsert the volunteer and attach the group. Returns { isExisting, fullName }.
 * The `volunteers` table has no free-text column (health notes live in their
 * own table by design), so the signup message is delivered to the stewards in
 * the notification email — the same as the Supabase path has done since 7 Sep.
 */
async function writeVolunteer({ firstName, lastName, email, phone, isMember, village, cardPath, cardTitle }) {
  const vslug = slugVillage(village);
  const gslug = normPath(cardPath).split('/').pop() || null;

  const found = await supaReq(`volunteers?village_id=eq.${encodeURIComponent(vslug)}&email=eq.${encodeURIComponent(email)}&select=id,first_name,last_name,member_status`);
  if (!found.ok) throw new Error(`Supabase lookup failed (${found.status})`);
  const existing = Array.isArray(found.data) ? found.data[0] : null;
  let vid = existing ? existing.id : null;

  if (!vid) {
    const ins = await supaReq('volunteers', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify([{
        village_id: vslug, first_name: firstName, last_name: lastName,
        mobile: phone || '', email, group_id: gslug,
        status: 'active', member_status: isMember ? 'member' : null,
      }]),
    });
    vid = (ins.ok && Array.isArray(ins.data) && ins.data[0]) ? ins.data[0].id : null;
    if (!vid) throw new Error(`Supabase insert failed (${ins.status})`);
  } else if (isMember && existing.member_status !== 'member') {
    // Best-effort: a returning volunteer telling us they are now a member.
    await supaReq(`volunteers?id=eq.${encodeURIComponent(vid)}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ member_status: 'member' }),
    }).catch(() => {});
  }

  // Group membership. A duplicate (same volunteer, same group) is a 409 from
  // the unique index and means "already attached" — not an error for the resident.
  if (gslug) {
    const g = await supaReq('volunteer_groups', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify([{
        volunteer_id: vid, village_id: vslug, group_id: gslug,
        group_title: cardTitle, is_primary: false, source: 'website',
      }]),
    });
    if (!g.ok && g.status !== 409) throw new Error(`Supabase group attach failed (${g.status})`);
  }

  const fullName = existing ? `${existing.first_name} ${existing.last_name}`.trim() : `${firstName} ${lastName}`;
  return { isExisting: !!existing, fullName };
}

async function notifyStewards(v, context) {
  const key = process.env.VF_RESEND_API_KEY;
  if (!key) return;
  let to = [];
  try {
    if (STEWARDS_DB_ID) {
      const rows = await queryAll(STEWARDS_DB_ID, {
        and: [
          { property: 'Village', rich_text: { equals: v.village } },
          { property: 'Status', select: { equals: 'Active' } },
        ],
      });
      to = rows.map(parseSteward)
        .filter((s) => s.email && s.cards.some((c) => normPath(c.path) === v.cardPath))
        .map((s) => s.email);
    }
  } catch (_) { /* fall through to village list */ }
  if (!to.length) to = await getModuleRecipients({ village: v.village, module: 'volunteers', context });
  if (!to.length) return;
  const from = process.env.VF_PLEDGE_FROM || 'VillageFirst <noreply@villagefirst.org.au>';

  const rows = [
    ['Name', v.fullName], ['Group', v.cardTitle], ['Email', v.email],
    ['Phone', v.phone || '(none given)'], ['Message', v.message || '—'],
    ['Existing volunteer', v.isExisting ? 'Yes — this card was added to their record' : 'No — new signup, Status = Applied'],
    ['Village', v.village],
  ].map(([k, val]) => `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;">${esc(k)}</td><td style="padding:4px 0;font-weight:600;">${esc(val)}</td></tr>`).join('');

  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1f2937;">
    <h2 style="color:#15795f;">🙋 New volunteer signup — ${esc(v.cardTitle)}</h2>
    <p>Someone volunteered via the website. Review them in the <a href="${process.env.URL || 'https://villagefirst.org.au'}/admin/volunteers/">Volunteer hub</a>.</p>
    <table style="border-collapse:collapse;font-size:14px;">${rows}</table>
  </div>`;

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject: `New volunteer — ${v.fullName} → ${v.cardTitle}`, html }),
    });
  } catch (_) { /* best-effort */ }
}

export const handler = async (event, context) => {
  if (event.httpMethod !== 'POST') return jsonResp(405, { error: 'POST only' });
  if (!supaConfigured()) return jsonResp(503, { error: 'Volunteer signups are not switched on for this site yet.' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch {
    return jsonResp(400, { error: 'Invalid request' });
  }

  // Honeypot — pretend success so bots don't learn.
  if ((body.website || '').trim()) return jsonResp(200, { ok: true });

  const firstName = (body.firstName || '').trim().slice(0, 100);
  const lastName = (body.lastName || '').trim().slice(0, 100);
  const email = (body.email || '').trim().toLowerCase().slice(0, 200);
  const cardPath = normPath(body.cardPath);
  const cardTitle = (body.cardTitle || '').trim().slice(0, 200);
  if (!firstName || !lastName) return jsonResp(400, { error: 'Please give us your first and last name.' });
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jsonResp(400, { error: 'Please give us a valid email address.' });
  if (!cardPath || !cardTitle) return jsonResp(400, { error: 'Something went wrong — please refresh the page and try again.' });

  const phone = (body.phone || '').trim().slice(0, 50);
  const message = (body.message || '').trim().slice(0, 2000);
  const isMember = body.isMember === true || body.isMember === 'true';
  const village = (body.village || process.env.VILLAGE_NAME || 'Smiths Lake').slice(0, 100);
  try {
    const { isExisting, fullName } = await writeVolunteer({ firstName, lastName, email, phone, isMember, village, cardPath, cardTitle });
    await notifyStewards({ fullName, cardTitle, cardPath, email, phone, message, village, isExisting }, context);
    return jsonResp(200, { ok: true });
  } catch (err) {
    return jsonResp(502, { error: 'Sorry — we could not record your signup just now. Please try again shortly.' });
  }
};

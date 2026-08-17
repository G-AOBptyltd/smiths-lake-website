/**
 * volunteer-signup.js — POST /api/volunteer-signup   (PUBLIC, no auth)
 *
 * "Volunteer for this group" forms on the card detail pages (e.g.
 * /environment/landcare-and-bush-regeneration/) post here. Mirrors the
 * member-join hardening: honeypot, length caps, no trusted input, and the
 * only public writer to the VF Volunteers DB.
 *
 * Body: { village?, cardPath, cardTitle, firstName, lastName, email, phone?,
 *         message?, isMember?, website? }
 *
 * Upsert by email+village: an existing volunteer signing up for a second card
 * gets that card APPENDED to their record (status untouched); a new email
 * creates a row with Status = Applied for the steward/admin to approve.
 *
 * Notifies the card's stewards (or the village notify list if the card has
 * none) via the VF Resend vars — env-gated, fail-open.
 */

import {
  VOLUNTEERS_DB_ID, STEWARDS_DB_ID, notionHeaders, jsonResp, notProvisioned,
  rtChunks, queryAll, parseVolunteer, parseSteward, normPath, mergeCard,
} from './_stewards.js';

function esc(s) {
  return String(s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

async function notifyStewards(v) {
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
  if (!to.length) to = (process.env.VF_PLEDGE_NOTIFY_TO || '').split(',').map((s) => s.trim()).filter(Boolean);
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
    <p>Someone volunteered via the website. Review them in the <a href="https://villagefirst.org.au/admin/volunteers/">Volunteer hub</a>.</p>
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

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return jsonResp(405, { error: 'POST only' });
  if (!VOLUNTEERS_DB_ID) return notProvisioned();

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
  const village = (body.village || 'Smiths Lake').slice(0, 100);
  const fullName = `${firstName} ${lastName}`;
  const today = new Date().toISOString().slice(0, 10);
  const card = { path: cardPath, title: cardTitle };

  try {
    const existing = (await queryAll(VOLUNTEERS_DB_ID, {
      and: [
        { property: 'Email', email: { equals: email } },
        { property: 'Village', rich_text: { equals: village } },
      ],
    })).map(parseVolunteer)[0];

    if (existing) {
      const cards = mergeCard(existing.cards, card);
      const res = await fetch(`https://api.notion.com/v1/pages/${existing.id}`, {
        method: 'PATCH',
        headers: notionHeaders(),
        body: JSON.stringify({ properties: {
          'Cards': { rich_text: rtChunks(JSON.stringify(cards)) },
          'PPCA Member': { checkbox: isMember || existing.isMember },
          ...(message ? { 'Message': { rich_text: rtChunks([existing.message, `[${cardTitle}] ${message}`].filter(Boolean).join('\n').slice(0, 2000)) } } : {}),
        } }),
      });
      if (!res.ok) throw new Error(`Notion responded ${res.status}`);
      await notifyStewards({ fullName: existing.name, cardTitle, cardPath, email, phone, message, village, isExisting: true });
      return jsonResp(200, { ok: true });
    }

    const res = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: notionHeaders(),
      body: JSON.stringify({
        parent: { database_id: VOLUNTEERS_DB_ID },
        properties: {
          'Volunteer': { title: [{ text: { content: fullName } }] },
          'First Name': { rich_text: rtChunks(firstName) },
          'Last Name': { rich_text: rtChunks(lastName) },
          'Email': { email },
          'Phone': phone ? { phone_number: phone } : { phone_number: null },
          'Village': { rich_text: rtChunks(village) },
          'Cards': { rich_text: rtChunks(JSON.stringify([card])) },
          'Status': { select: { name: 'Applied' } },
          'PPCA Member': { checkbox: isMember },
          'Message': { rich_text: rtChunks(message) },
          'Date Joined': { date: { start: today } },
          'Logged By': { rich_text: rtChunks(`public form (${email})`) },
        },
      }),
    });
    if (!res.ok) throw new Error(`Notion responded ${res.status}`);
    await notifyStewards({ fullName, cardTitle, cardPath, email, phone, message, village, isExisting: false });
    return jsonResp(200, { ok: true });
  } catch (err) {
    return jsonResp(502, { error: 'Sorry — we could not record your signup just now. Please try again shortly.' });
  }
};

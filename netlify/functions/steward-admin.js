/**
 * steward-admin.js — appoint and manage community stewards (card-level admins).
 *
 * GET  /api/steward-admin?village=               → { stewards }        (admin)
 * POST /api/steward-admin { village?, action, ... }                    (admin)
 *      add     { email, name?, cards:[{path,title}] }
 *              Upserts the VF Stewards row AND wires Netlify Identity:
 *              invites the email if no account exists, and grants the
 *              "<village>:steward" role if they hold no role yet (existing
 *              roles are never downgraded). Identity failures are reported
 *              as warnings — the register row is still saved.
 *      cards   { pageId, cards:[{path,title}] }   replace a steward's cards
 *      remove  { pageId }                         Status → Removed (the
 *              Identity role is left in place; with no Active register row
 *              they can sign in but see no cards)
 *      restore { pageId }                         Status → Active
 *
 * Auth: village admin / super-admin. Village admins can only appoint stewards
 * for THEIR village — the role string granted is derived server-side.
 */

import { requireRole, villageKey, getRoles } from './_auth.js';
import {
  STEWARDS_DB_ID, notionHeaders, jsonResp, notProvisioned, rtChunks,
  queryAll, parseSteward, normPath,
} from './_stewards.js';

function cleanCards(raw) {
  const out = [];
  for (const c of (Array.isArray(raw) ? raw : []).slice(0, 100)) {
    const path = normPath(c?.path);
    if (!path || out.some((x) => x.path === path)) continue;
    out.push({ path, title: String(c?.title || path).slice(0, 200) });
  }
  return out;
}

function esc(s) { return String(s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

// Friendly heads-up to a steward on appointment / card change. For brand-new
// accounts the Netlify Identity invite already tells them, so we only send this
// to EXISTING accounts (who otherwise get nothing). Best-effort, env-gated.
async function sendStewardWelcome({ email, name, cards, village, changed }) {
  const key = process.env.VF_RESEND_API_KEY;
  if (!key) return;
  const from = process.env.VF_PLEDGE_FROM || 'VillageFirst <noreply@villagefirst.org.au>';
  const replyTo = (process.env.VF_PLEDGE_NOTIFY_TO || '').split(',')[0].trim();
  const first = String(name || '').trim().split(/\s+/)[0] || 'there';
  const list = (cards || []).map((c) => `<li>${esc(c.title)}</li>`).join('');
  const link = 'https://villagefirst.org.au/admin/volunteers/my/';
  const intro = changed
    ? `Your steward groups at ${esc(village)} have been updated. You now look after:`
    : `You've been made a community steward at ${esc(village)} — thank you! You now look after:`;
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1f2937;max-width:520px;">
    <p>Hi ${esc(first)},</p>
    <p>${intro}</p>
    <ul>${list}</ul>
    <p>As a steward you can approve volunteers, run working bees and log hours for these groups — all from your phone.</p>
    <p><a href="${link}" style="display:inline-block;background:#15795f;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;">Open your steward home</a></p>
    <p style="color:#6b7280;font-size:13px;">If you weren't expecting this, just reply and let us know.</p>
    <p>Thanks,<br>The ${esc(village)} team</p>
  </div>`;
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: email, subject: `You're a steward at ${village}`, html, ...(replyTo ? { reply_to: replyTo } : {}) }),
    });
  } catch (_) { /* best-effort */ }
}

/**
 * Make sure the steward can actually sign in: invite unknown emails, grant
 * "<village>:steward" to role-less accounts. Never touches an existing role
 * (an admin stays an admin). Returns a human-readable warning or null.
 */
async function ensureIdentity(context, email, village) {
  const identity = context?.clientContext?.identity;
  if (!identity?.url || !identity?.token) return { invited: false, warning: 'Identity admin API unavailable — invite the steward manually in Netlify' };
  const adminHeaders = { Authorization: `Bearer ${identity.token}`, 'Content-Type': 'application/json' };
  const role = `${villageKey(village)}:steward`;
  try {
    const listRes = await fetch(`${identity.url}/admin/users`, { headers: adminHeaders });
    if (!listRes.ok) return { invited: false, warning: 'Could not read Identity users — check the steward has an account' };
    const user = (((await listRes.json()).users) || []).find((u) => (u.email || '').toLowerCase() === email);

    if (!user) {
      const inv = await fetch(`${identity.url}/invite`, { method: 'POST', headers: adminHeaders, body: JSON.stringify({ email }) });
      if (!inv.ok) return { invited: false, warning: 'Register row saved, but the Identity invite failed — invite them manually in Netlify' };
      // Assign the role on the freshly-invited account so access works on first sign-in.
      const again = await fetch(`${identity.url}/admin/users`, { headers: adminHeaders });
      if (again.ok) {
        const u = (((await again.json()).users) || []).find((x) => (x.email || '').toLowerCase() === email);
        if (u) await fetch(`${identity.url}/admin/users/${u.id}`, { method: 'PUT', headers: adminHeaders, body: JSON.stringify({ app_metadata: { roles: [role] } }) });
      }
      return { invited: true, warning: null };            // brand-new account → invite email sent
    }

    const roles = user.app_metadata?.roles || [];
    if (roles.length) return { invited: false, warning: null }; // existing access — don't touch
    const set = await fetch(`${identity.url}/admin/users/${user.id}`, {
      method: 'PUT', headers: adminHeaders, body: JSON.stringify({ app_metadata: { roles: [role] } }),
    });
    if (!set.ok) return { invited: false, warning: 'Register row saved, but granting the steward role failed — set it manually in Netlify' };
    return { invited: false, warning: null };
  } catch (_) {
    return { invited: false, warning: 'Register row saved, but Identity wiring failed — check their account in Netlify' };
  }
}

// Revoke ONLY the "<village>:steward" role from an account (keeps the account
// and any other roles — never hard-delete a sign-in account). Best-effort.
async function revokeIdentityRole(context, email, village) {
  const identity = context?.clientContext?.identity;
  if (!identity?.url || !identity?.token || !email) return;
  const adminHeaders = { Authorization: `Bearer ${identity.token}`, 'Content-Type': 'application/json' };
  const role = `${villageKey(village)}:steward`;
  try {
    const listRes = await fetch(`${identity.url}/admin/users`, { headers: adminHeaders });
    if (!listRes.ok) return;
    const user = (((await listRes.json()).users) || []).find((u) => (u.email || '').toLowerCase() === email);
    if (!user) return;
    const roles = (user.app_metadata?.roles || []).filter((r) => r !== role);
    await fetch(`${identity.url}/admin/users/${user.id}`, {
      method: 'PUT', headers: adminHeaders, body: JSON.stringify({ app_metadata: { roles } }),
    });
  } catch (_) { /* best-effort */ }
}

async function getSteward(pageId) {
  const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, { headers: notionHeaders() });
  if (!res.ok) return null;
  const page = await res.json();
  const parent = page.parent?.database_id?.replace(/-/g, '');
  if (parent !== STEWARDS_DB_ID.replace(/-/g, '')) return null;
  return parseSteward(page);
}

export const handler = async (event, context) => {
  if (!STEWARDS_DB_ID) return notProvisioned();

  if (event.httpMethod === 'GET') {
    const village = event.queryStringParameters?.village || process.env.VILLAGE_NAME || 'Smiths Lake';
    const auth = requireRole(context, { village, anyOf: ['admin'] });
    if (!auth.ok) return jsonResp(auth.status, { error: auth.error });
    try {
      const stewards = (await queryAll(
        STEWARDS_DB_ID,
        { property: 'Village', rich_text: { equals: village } },
        [{ property: 'Date Added', direction: 'descending' }],
      )).map(parseSteward);
      return jsonResp(200, { stewards });
    } catch (err) {
      return jsonResp(502, { error: err.message });
    }
  }

  if (event.httpMethod !== 'POST') return jsonResp(405, { error: 'GET or POST only' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch {
    return jsonResp(400, { error: 'Invalid JSON' });
  }

  const village = body.village || process.env.VILLAGE_NAME || 'Smiths Lake';
  const auth = requireRole(context, { village, anyOf: ['admin'] });
  if (!auth.ok) return jsonResp(auth.status, { error: auth.error });
  const adminEmail = (auth.user.email || 'admin').slice(0, 200);

  try {
    if (body.action === 'add') {
      const email = (body.email || '').trim().toLowerCase().slice(0, 200);
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jsonResp(400, { error: 'A valid email address is required' });
      const cards = cleanCards(body.cards);
      if (!cards.length) return jsonResp(400, { error: 'Pick at least one card for this steward' });
      const name = (body.name || '').trim().slice(0, 200) || email;

      const existing = (await queryAll(STEWARDS_DB_ID, {
        and: [
          { property: 'Email', email: { equals: email } },
          { property: 'Village', rich_text: { equals: village } },
        ],
      })).map(parseSteward)[0];

      const properties = {
        'Steward': { title: [{ text: { content: name } }] },
        'Email': { email },
        'Village': { rich_text: rtChunks(village.slice(0, 100)) },
        'Cards': { rich_text: rtChunks(JSON.stringify(cards)) },
        'Status': { select: { name: 'Active' } },
        'Added By': { rich_text: rtChunks(adminEmail) },
        'Date Added': { date: { start: new Date().toISOString().slice(0, 10) } },
      };

      let res;
      if (existing) {
        // Re-appointing merges nothing implicitly — the submitted cards win.
        res = await fetch(`https://api.notion.com/v1/pages/${existing.id}`, {
          method: 'PATCH', headers: notionHeaders(), body: JSON.stringify({ properties }),
        });
      } else {
        res = await fetch('https://api.notion.com/v1/pages', {
          method: 'POST', headers: notionHeaders(),
          body: JSON.stringify({ parent: { database_id: STEWARDS_DB_ID }, properties }),
        });
      }
      if (!res.ok) {
        const detail = await res.text();
        throw new Error(`Notion responded ${res.status}: ${detail.slice(0, 200)}`);
      }
      const idr = await ensureIdentity(context, email, village);
      // New accounts get the Identity invite; existing accounts (no invite) get
      // a friendly steward heads-up instead.
      if (!idr.invited) await sendStewardWelcome({ email, name, cards, village, changed: !!existing });
      return jsonResp(200, { ok: true, ...(idr.warning ? { warning: idr.warning } : {}) });
    }

    if (body.action === 'cards' || body.action === 'remove' || body.action === 'restore') {
      const steward = await getSteward(body.pageId);
      if (!steward || steward.village !== village) return jsonResp(404, { error: 'Steward not found' });
      let properties, changedCards = null;
      if (body.action === 'cards') {
        const cards = cleanCards(body.cards);
        if (!cards.length) return jsonResp(400, { error: 'A steward needs at least one card — use Remove instead' });
        properties = { 'Cards': { rich_text: rtChunks(JSON.stringify(cards)) } };
        changedCards = cards;
      } else {
        properties = { 'Status': { select: { name: body.action === 'remove' ? 'Removed' : 'Active' } } };
      }
      const res = await fetch(`https://api.notion.com/v1/pages/${body.pageId}`, {
        method: 'PATCH', headers: notionHeaders(), body: JSON.stringify({ properties }),
      });
      if (!res.ok) throw new Error(`Notion responded ${res.status}`);
      // Heads-up email when their groups change (not on remove/restore).
      if (changedCards && steward.email) {
        await sendStewardWelcome({ email: steward.email, name: steward.name, cards: changedCards, village, changed: true });
      }
      return jsonResp(200, { ok: true });
    }

    // Fix a steward's email address (keeps their cards). Re-wires Identity for
    // the new email; the old account keeps its role but no longer has a register
    // row, so it sees no cards.
    if (body.action === 'editEmail') {
      const steward = await getSteward(body.pageId);
      if (!steward || steward.village !== village) return jsonResp(404, { error: 'Steward not found' });
      const newEmail = (body.email || '').trim().toLowerCase().slice(0, 200);
      if (!newEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) return jsonResp(400, { error: 'A valid email address is required' });
      if (newEmail === (steward.email || '').toLowerCase()) return jsonResp(200, { ok: true });
      const res = await fetch(`https://api.notion.com/v1/pages/${body.pageId}`, {
        method: 'PATCH', headers: notionHeaders(), body: JSON.stringify({ properties: { 'Email': { email: newEmail } } }),
      });
      if (!res.ok) throw new Error(`Notion responded ${res.status}`);
      const idr = await ensureIdentity(context, newEmail, village);
      if (!idr.invited) await sendStewardWelcome({ email: newEmail, name: steward.name, cards: steward.cards, village, changed: true });
      return jsonResp(200, { ok: true, ...(idr.warning ? { warning: idr.warning } : {}) });
    }

    // Hard-delete a steward from the register (super-admin only). Archives the
    // Notion row AND revokes the steward role — but never deletes the account.
    if (body.action === 'delete') {
      if (!getRoles(auth.user).includes('super-admin')) return jsonResp(403, { error: 'Only the super-admin can delete a steward from the register' });
      const steward = await getSteward(body.pageId);
      if (!steward || steward.village !== village) return jsonResp(404, { error: 'Steward not found' });
      const res = await fetch(`https://api.notion.com/v1/pages/${body.pageId}`, {
        method: 'PATCH', headers: notionHeaders(), body: JSON.stringify({ archived: true }),
      });
      if (!res.ok) throw new Error(`Notion responded ${res.status}`);
      await revokeIdentityRole(context, steward.email, village);
      return jsonResp(200, { ok: true });
    }

    return jsonResp(400, { error: 'Unknown action' });
  } catch (err) {
    return jsonResp(502, { error: err.message });
  }
};

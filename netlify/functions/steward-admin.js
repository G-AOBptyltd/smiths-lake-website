/**
 * steward-admin.js — appoint and manage community stewards (card-level admins).
 *
 * GET  /api/steward-admin?village=               → { stewards }        (admin)
 * POST /api/steward-admin { village?, action, ... }                    (admin)
 *      add     { email, name?, cards:[{path,title}] }
 *              Upserts the register row (Supabase `stewards`, migration 0018
 *              — PII plan Phase 3b, 15 Sep 2026; `pageId` in request bodies
 *              is now the row's uuid) AND wires Netlify Identity:
 *              invites the email if no account exists, and grants the
 *              "<village>:steward" role if they hold no role yet (existing
 *              roles are never downgraded). Identity failures are reported
 *              as warnings — the register row is still saved.
 *              ALSO grants the app's Supabase `group_leader` role, one row
 *              per card (see _vapp.js). Appointing someone here is what makes
 *              the steward console appear in their phone app — without it the
 *              app shows them a plain volunteer screen.
 *      cards   { pageId, cards:[{path,title}] }   replace a steward's cards
 *      remove  { pageId }                         Status → Removed (the
 *              Identity role is left in place; with no Active register row
 *              they can sign in but see no cards)
 *      restore { pageId }                         Status → Active
 *      editEmail { pageId, email }                re-wires Identity + app grants
 *      delete  { pageId }                         super-admin: archive + revoke role
 *
 * Auth: village admin / super-admin. Village admins can only appoint stewards
 * for THEIR village — the role string granted is derived server-side, and
 * every register read/write is scoped to that village (getSteward returns
 * null for another village's uuid).
 */

import { requireRole, villageKey, getRoles } from './_auth.js';
import {
  jsonResp, normPath,
  listStewards, getSteward, findStewardByEmail, createSteward, patchSteward, archiveSteward,
} from './_stewards.js';
import { supaConfigured } from './_supa.js';
import { syncStewardRole } from './_vapp.js';

// Where a steward actually does the job: the phone app. Per-village, because
// every village gets its own app deployment (smithslake-stewards…, etc.).
const APP_URL = (process.env.VF_APP_URL || 'https://smithslake-stewards.village1st.com.au').replace(/\/+$/, '');
// The desktop console — the same job on a big screen, for whoever wants it.
const CONSOLE_URL = (process.env.VF_CONSOLE_URL || 'https://villagefirst.org.au').replace(/\/+$/, '') + '/admin/volunteers/my/';

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

// Friendly heads-up to a steward on appointment / card change.
//
// This email is the ONLY thing that tells a steward the app exists. The
// Netlify Identity invite that brand-new accounts also receive is a
// password-setup link for the DESKTOP console — follow it and you land on
// villagefirst.org.au, which is why stewards kept ending up there instead of
// in the app. So we send this to everyone, new accounts included, and lead
// with the app; the console is offered second, as the big-screen option.
async function sendStewardWelcome({ email, name, cards, village, changed, isNew }) {
  const key = process.env.VF_RESEND_API_KEY;
  if (!key) return;
  const from = process.env.VF_PLEDGE_FROM || 'VillageFirst <noreply@villagefirst.org.au>';
  const replyTo = (process.env.VF_PLEDGE_NOTIFY_TO || '').split(',')[0].trim();
  const first = String(name || '').trim().split(/\s+/)[0] || 'there';
  const list = (cards || []).map((c) => `<li>${esc(c.title)}</li>`).join('');
  const intro = changed
    ? `Your steward groups at ${esc(village)} have been updated. You now look after:`
    : `You've been made a community steward at ${esc(village)} — thank you! You now look after:`;
  // Sign-in is by emailed link, so spell that out: a steward who goes looking
  // for a password they were never given is a steward who gives up.
  const howToSignIn = `<p style="background:#f0fdf4;border-left:3px solid #15795f;padding:10px 14px;border-radius:4px;">
      <strong>Signing in:</strong> tap the button, enter <strong>${esc(email)}</strong>, and we'll email you a
      one-tap sign-in link. No password to remember. Add the app to your home screen and it opens like any other app.</p>`;
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1f2937;max-width:520px;">
    <p>Hi ${esc(first)},</p>
    <p>${intro}</p>
    <ul>${list}</ul>
    <p>As a steward you can see who's coming, who's on site, and approve the hours your group logs — all from your phone.</p>
    <p><a href="${APP_URL}" style="display:inline-block;background:#15795f;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;">Open the volunteer app</a></p>
    ${howToSignIn}
    <p style="color:#6b7280;font-size:13px;">Prefer a big screen? The same tools are at
      <a href="${CONSOLE_URL}" style="color:#15795f;">your steward home</a> on the website.</p>
    ${isNew ? `<p style="color:#6b7280;font-size:13px;">You may also get a separate "accept the invite" email — that one is for the website only. You don't need it to use the app.</p>` : ''}
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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const handler = async (event, context) => {
  if (!supaConfigured()) return jsonResp(503, { error: 'The steward register is stored in Supabase, which is not configured on this site (VAPP_SUPABASE_URL / VAPP_SUPABASE_SERVICE_KEY).' });

  if (event.httpMethod === 'GET') {
    const village = event.queryStringParameters?.village || process.env.VILLAGE_NAME || 'Smiths Lake';
    const auth = requireRole(context, { village, anyOf: ['admin'] });
    if (!auth.ok) return jsonResp(auth.status, { error: auth.error });
    try {
      const stewards = await listStewards(village);
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
      if (!email || !EMAIL_RE.test(email)) return jsonResp(400, { error: 'A valid email address is required' });
      const cards = cleanCards(body.cards);
      if (!cards.length) return jsonResp(400, { error: 'Pick at least one card for this steward' });
      const name = (body.name || '').trim().slice(0, 200) || email;

      // One live row per email per village (unique index): re-appointing a
      // steward — Removed or still Active — updates that row. The submitted
      // cards win; nothing is merged implicitly. added_by / date_added keep
      // the original appointment for the audit trail.
      const existing = await findStewardByEmail(village, email);
      if (existing) {
        await patchSteward(existing.id, village, { name, cards, status: 'Active', last_updated_by: adminEmail });
      } else {
        await createSteward(village, { name, email, cards, status: 'Active', added_by: adminEmail, last_updated_by: adminEmail });
      }
      const idr = await ensureIdentity(context, email, village);
      // Switch on their steward view in the APP (the console and the app are
      // two front ends over one register — appointing here must mean both).
      const app = await syncStewardRole({ email, name, village, cards, active: true });
      // Everyone gets this — it is the only email that mentions the app.
      await sendStewardWelcome({ email, name, cards, village, changed: !!existing, isNew: idr.invited });
      const warning = idr.warning || app.warning;
      return jsonResp(200, { ok: true, appSteward: app.synced, ...(warning ? { warning } : {}) });
    }

    if (body.action === 'cards' || body.action === 'remove' || body.action === 'restore') {
      const steward = await getSteward(body.pageId, village);
      if (!steward) return jsonResp(404, { error: 'Steward not found' });
      let values, changedCards = null;
      if (body.action === 'cards') {
        const cards = cleanCards(body.cards);
        if (!cards.length) return jsonResp(400, { error: 'A steward needs at least one card — use Remove instead' });
        values = { cards };
        changedCards = cards;
      } else {
        values = { status: body.action === 'remove' ? 'Removed' : 'Active' };
      }
      await patchSteward(steward.id, village, { ...values, last_updated_by: adminEmail });
      // Keep the app's steward grants in step: new card list on 'cards',
      // revoked on 'remove', restored to their register cards on 'restore'.
      const app = await syncStewardRole({
        email: steward.email, name: steward.name, village,
        cards: changedCards || steward.cards,
        active: body.action !== 'remove',
      });
      // Heads-up email when their groups change (not on remove/restore).
      if (changedCards && steward.email) {
        await sendStewardWelcome({ email: steward.email, name: steward.name, cards: changedCards, village, changed: true });
      }
      return jsonResp(200, { ok: true, ...(app.warning ? { warning: app.warning } : {}) });
    }

    // Fix a steward's email address (keeps their cards). Re-wires Identity for
    // the new email; the old account keeps its role but no longer has a register
    // row, so it sees no cards.
    if (body.action === 'editEmail') {
      const steward = await getSteward(body.pageId, village);
      if (!steward) return jsonResp(404, { error: 'Steward not found' });
      const newEmail = (body.email || '').trim().toLowerCase().slice(0, 200);
      if (!newEmail || !EMAIL_RE.test(newEmail)) return jsonResp(400, { error: 'A valid email address is required' });
      if (newEmail === (steward.email || '').toLowerCase()) return jsonResp(200, { ok: true });
      // The unique index would refuse this anyway; say why in plain words first.
      if (await findStewardByEmail(village, newEmail)) return jsonResp(409, { error: 'Another steward in this village already uses that email address' });
      await patchSteward(steward.id, village, { email: newEmail, last_updated_by: adminEmail });
      const idr = await ensureIdentity(context, newEmail, village);
      // Move the app grants to the new address, and strip them from the old
      // one — otherwise the previous account keeps a live steward view.
      await syncStewardRole({ email: steward.email, name: steward.name, village, cards: [], active: false });
      const app = await syncStewardRole({ email: newEmail, name: steward.name, village, cards: steward.cards, active: true });
      await sendStewardWelcome({ email: newEmail, name: steward.name, cards: steward.cards, village, changed: true, isNew: idr.invited });
      const warning = idr.warning || app.warning;
      return jsonResp(200, { ok: true, ...(warning ? { warning } : {}) });
    }

    // Delete a steward from the register (super-admin only). Soft-deletes the
    // row (archived_at — recoverable with one SQL update, and it frees the
    // email for a fresh appointment) AND revokes the steward role — but never
    // deletes the account.
    if (body.action === 'delete') {
      if (!getRoles(auth.user).includes('super-admin')) return jsonResp(403, { error: 'Only the super-admin can delete a steward from the register' });
      const steward = await getSteward(body.pageId, village);
      if (!steward) return jsonResp(404, { error: 'Steward not found' });
      await patchSteward(steward.id, village, { last_updated_by: adminEmail });
      await archiveSteward(steward.id, village);
      await revokeIdentityRole(context, steward.email, village);
      // Revoke in the app too — the account stays, the steward view goes.
      await syncStewardRole({ email: steward.email, name: steward.name, village, cards: [], active: false });
      return jsonResp(200, { ok: true });
    }

    return jsonResp(400, { error: 'Unknown action' });
  } catch (err) {
    return jsonResp(502, { error: err.message });
  }
};

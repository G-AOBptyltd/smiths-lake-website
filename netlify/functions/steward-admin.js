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

import { requireRole, villageKey } from './_auth.js';
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

/**
 * Make sure the steward can actually sign in: invite unknown emails, grant
 * "<village>:steward" to role-less accounts. Never touches an existing role
 * (an admin stays an admin). Returns a human-readable warning or null.
 */
async function ensureIdentity(context, email, village) {
  const identity = context?.clientContext?.identity;
  if (!identity?.url || !identity?.token) return 'Identity admin API unavailable — invite the steward manually in Netlify';
  const adminHeaders = { Authorization: `Bearer ${identity.token}`, 'Content-Type': 'application/json' };
  const role = `${villageKey(village)}:steward`;
  try {
    const listRes = await fetch(`${identity.url}/admin/users`, { headers: adminHeaders });
    if (!listRes.ok) return 'Could not read Identity users — check the steward has an account';
    const user = (((await listRes.json()).users) || []).find((u) => (u.email || '').toLowerCase() === email);

    if (!user) {
      const inv = await fetch(`${identity.url}/invite`, { method: 'POST', headers: adminHeaders, body: JSON.stringify({ email }) });
      if (!inv.ok) return 'Register row saved, but the Identity invite failed — invite them manually in Netlify';
      // Assign the role on the freshly-invited account so access works on first sign-in.
      const again = await fetch(`${identity.url}/admin/users`, { headers: adminHeaders });
      if (again.ok) {
        const u = (((await again.json()).users) || []).find((x) => (x.email || '').toLowerCase() === email);
        if (u) await fetch(`${identity.url}/admin/users/${u.id}`, { method: 'PUT', headers: adminHeaders, body: JSON.stringify({ app_metadata: { roles: [role] } }) });
      }
      return null;
    }

    const roles = user.app_metadata?.roles || [];
    if (roles.length) return null; // already has access of some kind — don't touch
    const set = await fetch(`${identity.url}/admin/users/${user.id}`, {
      method: 'PUT', headers: adminHeaders, body: JSON.stringify({ app_metadata: { roles: [role] } }),
    });
    if (!set.ok) return 'Register row saved, but granting the steward role failed — set it manually in Netlify';
    return null;
  } catch (_) {
    return 'Register row saved, but Identity wiring failed — check their account in Netlify';
  }
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
    const village = event.queryStringParameters?.village || 'Smiths Lake';
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

  const village = body.village || 'Smiths Lake';
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
      const warning = await ensureIdentity(context, email, village);
      return jsonResp(200, { ok: true, ...(warning ? { warning } : {}) });
    }

    if (body.action === 'cards' || body.action === 'remove' || body.action === 'restore') {
      const steward = await getSteward(body.pageId);
      if (!steward || steward.village !== village) return jsonResp(404, { error: 'Steward not found' });
      let properties;
      if (body.action === 'cards') {
        const cards = cleanCards(body.cards);
        if (!cards.length) return jsonResp(400, { error: 'A steward needs at least one card — use Remove instead' });
        properties = { 'Cards': { rich_text: rtChunks(JSON.stringify(cards)) } };
      } else {
        properties = { 'Status': { select: { name: body.action === 'remove' ? 'Removed' : 'Active' } } };
      }
      const res = await fetch(`https://api.notion.com/v1/pages/${body.pageId}`, {
        method: 'PATCH', headers: notionHeaders(), body: JSON.stringify({ properties }),
      });
      if (!res.ok) throw new Error(`Notion responded ${res.status}`);
      return jsonResp(200, { ok: true });
    }

    return jsonResp(400, { error: 'Unknown action' });
  } catch (err) {
    return jsonResp(502, { error: err.message });
  }
};

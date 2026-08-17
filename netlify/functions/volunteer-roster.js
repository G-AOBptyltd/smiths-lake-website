/**
 * volunteer-roster.js — the volunteer register, card-scoped.
 *
 * GET  /api/volunteer-roster?village=            → { volunteers, scope }
 *      Admins see every volunteer in the village; a card steward sees only
 *      volunteers signed up to at least one of THEIR cards.
 *
 * POST /api/volunteer-roster  { village?, pageId, action, ... }
 *      status   { status }                          Applied | Active | Inactive
 *      details  { firstName?, lastName?, email?, phone?, message?, isMember? }
 *      cards    { cards: [{path,title}] }           admin: any; steward: may only
 *                                                   add/remove THEIR OWN cards
 *      delete   { }                                 SUPER-ADMIN only (Notion trash)
 *
 * Every write stamps "Last Updated By". Server re-checks that the caller's
 * scope covers the target volunteer — the UI filter is not the gate.
 */

import { getRoles } from './_auth.js';
import {
  VOLUNTEERS_DB_ID, notionHeaders, jsonResp, notProvisioned, rtChunks,
  queryAll, parseVolunteer, resolveScope, scopeCoversVolunteer, scopeHasCard,
  normPath, VOLUNTEER_STATUSES,
} from './_stewards.js';

async function getVolunteer(pageId) {
  const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, { headers: notionHeaders() });
  if (!res.ok) return null;
  const page = await res.json();
  const parent = page.parent?.database_id?.replace(/-/g, '');
  if (parent !== VOLUNTEERS_DB_ID.replace(/-/g, '')) return null;
  return parseVolunteer(page);
}

export const handler = async (event, context) => {
  if (!VOLUNTEERS_DB_ID) return notProvisioned();

  if (event.httpMethod === 'GET') {
    const village = event.queryStringParameters?.village || 'Smiths Lake';
    const scope = await resolveScope(context, village);
    if (!scope.ok) return jsonResp(scope.status, { error: scope.error });
    try {
      const all = (await queryAll(
        VOLUNTEERS_DB_ID,
        { property: 'Village', rich_text: { equals: village } },
        [{ property: 'Date Joined', direction: 'descending' }],
      )).map(parseVolunteer);
      const volunteers = all.filter((v) => scopeCoversVolunteer(scope, v));
      return jsonResp(200, {
        volunteers,
        scope: { isAdmin: scope.isAdmin, cards: scope.cards },
      });
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
  const scope = await resolveScope(context, village);
  if (!scope.ok) return jsonResp(scope.status, { error: scope.error });

  const { pageId, action } = body;
  if (!pageId || !action) return jsonResp(400, { error: 'pageId and action are required' });

  try {
    const volunteer = await getVolunteer(pageId);
    if (!volunteer || volunteer.village !== village) return jsonResp(404, { error: 'Volunteer not found' });
    if (!scopeCoversVolunteer(scope, volunteer)) return jsonResp(403, { error: 'This volunteer is outside your cards' });

    const stamp = { 'Last Updated By': { rich_text: rtChunks(`${scope.user.email || 'admin'} · ${new Date().toISOString().slice(0, 10)}`) } };
    let properties = null;

    if (action === 'status') {
      if (!VOLUNTEER_STATUSES.includes(body.status)) return jsonResp(400, { error: 'Unknown status' });
      properties = { 'Status': { select: { name: body.status } }, ...stamp };

    } else if (action === 'details') {
      const firstName = (body.firstName ?? volunteer.firstName).trim().slice(0, 100);
      const lastName = (body.lastName ?? volunteer.lastName).trim().slice(0, 100);
      if (!firstName || !lastName) return jsonResp(400, { error: 'First and last name are required' });
      const email = (body.email ?? volunteer.email).trim().toLowerCase().slice(0, 200);
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jsonResp(400, { error: 'That email address does not look valid' });
      properties = {
        'Volunteer': { title: [{ text: { content: `${firstName} ${lastName}` } }] },
        'First Name': { rich_text: rtChunks(firstName) },
        'Last Name': { rich_text: rtChunks(lastName) },
        'Email': { email: email || null },
        'Phone': { phone_number: (body.phone ?? volunteer.phone).trim().slice(0, 50) || null },
        'Message': { rich_text: rtChunks((body.message ?? volunteer.message).trim().slice(0, 2000)) },
        'PPCA Member': { checkbox: body.isMember === undefined ? volunteer.isMember : (body.isMember === true || body.isMember === 'true') },
        ...stamp,
      };

    } else if (action === 'cards') {
      const requested = Array.isArray(body.cards) ? body.cards : [];
      const cleaned = [];
      for (const c of requested) {
        const path = normPath(c?.path);
        if (!path || cleaned.some((x) => x.path === path)) continue;
        cleaned.push({ path, title: String(c.title || path).slice(0, 200) });
      }
      if (!scope.isAdmin) {
        // A steward may only change membership of THEIR cards — every card
        // added or removed must be in their scope; other cards must survive.
        const before = volunteer.cards.map((c) => normPath(c.path));
        const after = cleaned.map((c) => c.path);
        const changed = [...before.filter((p) => !after.includes(p)), ...after.filter((p) => !before.includes(p))];
        if (changed.some((p) => !scopeHasCard(scope, p))) {
          return jsonResp(403, { error: 'You can only add or remove your own cards' });
        }
      }
      properties = { 'Cards': { rich_text: rtChunks(JSON.stringify(cleaned)) }, ...stamp };

    } else if (action === 'delete') {
      if (!getRoles(scope.user).includes('super-admin')) {
        return jsonResp(403, { error: 'Only the super-admin can delete volunteers — use Inactive instead' });
      }
      const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
        method: 'PATCH', headers: notionHeaders(), body: JSON.stringify({ archived: true }),
      });
      if (!res.ok) throw new Error(`Notion responded ${res.status}`);
      return jsonResp(200, { ok: true });

    } else {
      return jsonResp(400, { error: 'Unknown action' });
    }

    const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
      method: 'PATCH', headers: notionHeaders(), body: JSON.stringify({ properties }),
    });
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`Notion responded ${res.status}: ${detail.slice(0, 200)}`);
    }
    return jsonResp(200, { ok: true });
  } catch (err) {
    return jsonResp(502, { error: err.message });
  }
};

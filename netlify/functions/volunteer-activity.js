/**
 * volunteer-activity.js — working bees / sessions with attendance & hours.
 * This ledger is the raw audit trail behind grant co-contribution claims.
 *
 * GET  /api/volunteer-activity?village=&card=    → { activities, scope }
 *      Admins see every activity; stewards only their cards'. Optional card
 *      filter narrows further.
 *
 * POST /api/volunteer-activity { village?, action, ... }
 *      save     { pageId?, name, cardPath, cardTitle, date?, description?,
 *                 attendance:[{name, volunteerId?, hours}], note? }
 *               create (no pageId) or update. Total Hours is derived
 *               server-side from attendance — never taken from the client.
 *      status   { pageId, status }   Draft | Confirmed   ("Pushed" is reserved
 *               for the contributions push in the next stage; a Pushed
 *               activity is locked against edits here)
 *      delete   { pageId }           admin: any; steward: only their cards'
 *               Drafts (Notion trash, recoverable)
 *
 * Card scoping enforced server-side on both the target card and (for save)
 * any card change.
 */

import {
  ACTIVITIES_DB_ID, notionHeaders, jsonResp, notProvisioned, rtChunks,
  queryAll, parseActivity, resolveScope, scopeHasCard, normPath,
} from './_stewards.js';

async function getActivity(pageId) {
  const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, { headers: notionHeaders() });
  if (!res.ok) return null;
  const page = await res.json();
  const parent = page.parent?.database_id?.replace(/-/g, '');
  if (parent !== ACTIVITIES_DB_ID.replace(/-/g, '')) return null;
  return parseActivity(page);
}

function cleanAttendance(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const out = [];
  for (const a of list.slice(0, 200)) {
    const name = String(a?.name || '').trim().slice(0, 200);
    const hours = Number(a?.hours);
    if (!name || !Number.isFinite(hours) || hours <= 0 || hours > 24) continue;
    out.push({
      name,
      hours: Math.round(hours * 2) / 2,
      ...(a.volunteerId ? { volunteerId: String(a.volunteerId).slice(0, 50) } : {}),
    });
  }
  return out;
}

export const handler = async (event, context) => {
  if (!ACTIVITIES_DB_ID) return notProvisioned();

  if (event.httpMethod === 'GET') {
    const params = event.queryStringParameters || {};
    const village = params.village || 'Smiths Lake';
    const scope = await resolveScope(context, village);
    if (!scope.ok) return jsonResp(scope.status, { error: scope.error });
    try {
      const all = (await queryAll(
        ACTIVITIES_DB_ID,
        { property: 'Village', rich_text: { equals: village } },
        [{ property: 'Date', direction: 'descending' }],
      )).map(parseActivity);
      const cardFilter = normPath(params.card);
      const activities = all.filter((a) => scopeHasCard(scope, a.cardPath) && (!cardFilter || a.cardPath === cardFilter));
      return jsonResp(200, { activities, scope: { isAdmin: scope.isAdmin, cards: scope.cards } });
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
  const stamp = { 'Last Updated By': { rich_text: rtChunks(`${scope.user.email || 'admin'} · ${new Date().toISOString().slice(0, 10)}`) } };

  try {
    if (body.action === 'save') {
      const name = (body.name || '').trim().slice(0, 200);
      const cardPath = normPath(body.cardPath);
      const cardTitle = (body.cardTitle || '').trim().slice(0, 200);
      if (!name) return jsonResp(400, { error: 'Give the activity a name (e.g. "March working bee")' });
      if (!cardPath || !cardTitle) return jsonResp(400, { error: 'An activity must belong to a card' });
      if (!scopeHasCard(scope, cardPath)) return jsonResp(403, { error: 'That card is outside your scope' });

      const attendance = cleanAttendance(body.attendance);
      const totalHours = Math.round(attendance.reduce((s, a) => s + a.hours, 0) * 2) / 2;
      const properties = {
        'Activity': { title: [{ text: { content: name } }] },
        'Village': { rich_text: rtChunks(village.slice(0, 100)) },
        'Card Path': { rich_text: rtChunks(cardPath) },
        'Card Title': { rich_text: rtChunks(cardTitle) },
        'Date': { date: { start: body.date || new Date().toISOString().slice(0, 10) } },
        'Description': { rich_text: rtChunks((body.description || '').trim().slice(0, 2000)) },
        'Attendance': { rich_text: rtChunks(JSON.stringify(attendance)) },
        'Total Hours': { number: totalHours },
        'Note': { rich_text: rtChunks((body.note || '').trim().slice(0, 2000)) },
        ...stamp,
      };

      let res;
      if (body.pageId) {
        const existing = await getActivity(body.pageId);
        if (!existing || existing.village !== village) return jsonResp(404, { error: 'Activity not found' });
        if (!scopeHasCard(scope, existing.cardPath)) return jsonResp(403, { error: 'That activity is outside your scope' });
        if (existing.status === 'Pushed') return jsonResp(400, { error: 'This activity has been pushed to Contributions and is locked' });
        res = await fetch(`https://api.notion.com/v1/pages/${body.pageId}`, {
          method: 'PATCH', headers: notionHeaders(), body: JSON.stringify({ properties }),
        });
      } else {
        properties['Status'] = { select: { name: 'Draft' } };
        properties['Created By'] = { rich_text: rtChunks(scope.user.email || 'admin') };
        res = await fetch('https://api.notion.com/v1/pages', {
          method: 'POST', headers: notionHeaders(),
          body: JSON.stringify({ parent: { database_id: ACTIVITIES_DB_ID }, properties }),
        });
      }
      if (!res.ok) {
        const detail = await res.text();
        throw new Error(`Notion responded ${res.status}: ${detail.slice(0, 200)}`);
      }
      const page = await res.json();
      return jsonResp(200, { ok: true, pageId: page.id, totalHours });
    }

    if (body.action === 'status') {
      if (!['Draft', 'Confirmed'].includes(body.status)) return jsonResp(400, { error: 'Status must be Draft or Confirmed' });
      const existing = await getActivity(body.pageId);
      if (!existing || existing.village !== village) return jsonResp(404, { error: 'Activity not found' });
      if (!scopeHasCard(scope, existing.cardPath)) return jsonResp(403, { error: 'That activity is outside your scope' });
      if (existing.status === 'Pushed') return jsonResp(400, { error: 'This activity has been pushed to Contributions and is locked' });
      const res = await fetch(`https://api.notion.com/v1/pages/${body.pageId}`, {
        method: 'PATCH', headers: notionHeaders(),
        body: JSON.stringify({ properties: { 'Status': { select: { name: body.status } }, ...stamp } }),
      });
      if (!res.ok) throw new Error(`Notion responded ${res.status}`);
      return jsonResp(200, { ok: true });
    }

    if (body.action === 'delete') {
      const existing = await getActivity(body.pageId);
      if (!existing || existing.village !== village) return jsonResp(404, { error: 'Activity not found' });
      if (!scopeHasCard(scope, existing.cardPath)) return jsonResp(403, { error: 'That activity is outside your scope' });
      if (existing.status === 'Pushed') return jsonResp(400, { error: 'Pushed activities are part of the financial audit trail and cannot be deleted' });
      if (!scope.isAdmin && existing.status !== 'Draft') {
        return jsonResp(403, { error: 'Only a village admin can delete a confirmed activity' });
      }
      const res = await fetch(`https://api.notion.com/v1/pages/${body.pageId}`, {
        method: 'PATCH', headers: notionHeaders(), body: JSON.stringify({ archived: true }),
      });
      if (!res.ok) throw new Error(`Notion responded ${res.status}`);
      return jsonResp(200, { ok: true });
    }

    return jsonResp(400, { error: 'Unknown action' });
  } catch (err) {
    return jsonResp(502, { error: err.message });
  }
};

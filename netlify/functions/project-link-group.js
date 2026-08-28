/**
 * project-link-group.js — POST /api/project-link-group
 *
 * The volunteer-side of the two-way project<->group link. Given a volunteer
 * GROUP (a content card) and the set of project slugs it should feed, this
 * reconciles every village project's "Volunteer Groups" list: the card is added
 * to projects in `projectSlugs` and removed from those not in it. Lets an admin
 * or PM manage the link from the Volunteer hub as well as from the Projects page
 * (which writes the same field via cocon-save).
 *
 * Body: { village?, cardPath, cardTitle?, projectSlugs: [slug, ...] }
 * Auth: village admin / pm / super-admin.
 */

import { requireRole } from './_auth.js';
import { normPath } from './_stewards.js';
import {
  PROJECTS_DB, jsonResp, notionHeaders, queryAll, parseProject, rtChunks, ensureProjectSchema,
} from './_projects.js';

export const handler = async (event, context) => {
  if (event.httpMethod !== 'POST') return jsonResp(405, { error: 'POST only' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return jsonResp(400, { error: 'Invalid JSON' }); }
  const village = body.village || process.env.VILLAGE_NAME || 'Smiths Lake';
  const cardPath = normPath(body.cardPath);
  const cardTitle = (body.cardTitle || cardPath || '').toString().slice(0, 200);
  const wanted = new Set((Array.isArray(body.projectSlugs) ? body.projectSlugs : []).map(String));

  const auth = requireRole(context, { village, anyOf: ['admin', 'pm'] });
  if (!auth.ok) return jsonResp(auth.status, { error: auth.error });
  if (!cardPath) return jsonResp(400, { error: 'cardPath is required' });
  if (!PROJECTS_DB) return jsonResp(503, { error: 'Projects database not configured' });

  await ensureProjectSchema();

  try {
    const projects = (await queryAll(PROJECTS_DB, { property: 'Village', rich_text: { equals: village } }))
      .map(parseProject);

    let updated = 0;
    for (const p of projects) {
      const groups = Array.isArray(p.volunteerGroups) ? p.volunteerGroups.slice() : [];
      const has = groups.some((g) => normPath(g.path) === cardPath);
      const shouldHave = wanted.has(p.slug);
      if (has === shouldHave) continue;

      const next = shouldHave
        ? [...groups, { path: cardPath, title: cardTitle }]
        : groups.filter((g) => normPath(g.path) !== cardPath);

      const res = await fetch(`https://api.notion.com/v1/pages/${p.id}`, {
        method: 'PATCH', headers: notionHeaders(),
        body: JSON.stringify({ properties: { 'Volunteer Groups': { rich_text: rtChunks(JSON.stringify(next)) } } }),
      });
      if (!res.ok) {
        const detail = await res.text();
        throw new Error(`Notion responded ${res.status}: ${detail.slice(0, 200)}`);
      }
      updated += 1;
    }
    return jsonResp(200, { ok: true, updated });
  } catch (err) {
    return jsonResp(502, { error: err.message });
  }
};

/**
 * group-consolidate.js — merge a duplicate volunteer group into the real one.
 *
 * WHY. The same group can exist twice as two Notion content cards with nearly
 * identical names — "Landcare & Bush Regeneration" lives at BOTH
 * environment/landcare-and-bush-regeneration and
 * environment/landcare-bush-regeneration. Everything downstream keys off the
 * card path, so the group's history splits in two: on 12 Sep 2026 the working
 * bees (61 h) sat under one slug and every app hour (4.37 h) under the other.
 * A project can only link one of them, so whichever you pick, the other half
 * of the effort silently drops out of the grant claim.
 *
 * This rewrites every reference from one card path to another, across both
 * stores, so the group becomes one thing again.
 *
 * SAFE BY DESIGN, same shape as vapp-migrate.js:
 *   • SUPER-ADMIN only — this rewrites grant evidence.
 *   • GET  = DRY RUN. Reports exactly what would change. Writes nothing.
 *   • POST = COMMIT, and refuses unless body.confirm === true AND
 *            body.expected equals the dry run's total change count, so a
 *            stale or accidental commit cannot land.
 *   • Idempotent: re-running finds nothing left to change.
 *   • Uniqueness-safe: volunteer_groups and volunteer_roles both have unique
 *            constraints that a blind rename would violate, so rows that
 *            would collide are DELETED rather than renamed — the survivor is
 *            the one already on the canonical slug.
 *
 * It deliberately does NOT archive the emptied Notion content card. Retiring a
 * published card is an editorial decision with a public-site effect, so it is
 * reported as a remaining manual step instead.
 *
 * GET  /api/group-consolidate?village=&from=environment/x&to=environment/y
 * POST /api/group-consolidate { village, from, to, confirm:true, expected:<n> }
 */

import {
  jsonResp, normPath, queryAll, notionHeaders,
  ACTIVITIES_DB_ID, VOLUNTEERS_DB_ID, STEWARDS_DB_ID,
  parseActivity, parseVolunteer, parseSteward, rtChunks,
} from './_stewards.js';
import { PROJECTS_DB, parseProject } from './_projects.js';
import { requireRole, getRoles } from './_auth.js';
import { supa, vappConfigured, slugVillage } from './_vapp.js';

const slugOf = (p) => normPath(p).split('/').pop() || '';
const safeBody = (e) => { try { return e.body ? JSON.parse(e.body) : {}; } catch (_) { return {}; } };

async function patchPage(pageId, properties) {
  const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: 'PATCH', headers: notionHeaders(), body: JSON.stringify({ properties }),
  });
  if (!res.ok) throw new Error(`Notion responded ${res.status} updating ${pageId}`);
}

/** Replace a card path inside a [{path,title}] list, de-duplicating. */
function swapCards(cards, fromPath, toPath, toTitle) {
  const out = [];
  let changed = false;
  for (const card of (cards || [])) {
    // Never reassign the loop binding — esbuild refuses to bundle an
    // assignment to a const, and Netlify then ships the file unbundled,
    // which fails at runtime as "Cannot use import statement outside a
    // module". Build a new object instead.
    const isTarget = normPath(card?.path) === fromPath;
    const next = isTarget ? { path: toPath, title: toTitle || card?.title } : card;
    if (isTarget) changed = true;
    if (!out.some((x) => normPath(x.path) === normPath(next.path))) out.push(next);
    else changed = true;                       // collapsed a duplicate entry
  }
  return { cards: out, changed };
}

export const handler = async (event, context) => {
  const p = event.queryStringParameters || {};
  const body = safeBody(event);
  const village = p.village || body.village || process.env.VILLAGE_NAME || 'Smiths Lake';

  const auth = requireRole(context, { village, anyOf: ['admin'] });
  if (!auth.ok) return jsonResp(auth.status, { error: auth.error });
  if (!getRoles(auth.user).includes('super-admin')) {
    return jsonResp(403, { error: 'Only the super-admin can consolidate groups — this rewrites grant evidence.' });
  }

  const fromPath = normPath(p.from || body.from);
  const toPath = normPath(p.to || body.to);
  if (!fromPath || !toPath) return jsonResp(400, { error: 'from and to card paths are required' });
  if (fromPath === toPath) return jsonResp(400, { error: 'from and to are the same card' });

  const fromSlug = slugOf(fromPath);
  const toSlug = slugOf(toPath);
  const commit = event.httpMethod === 'POST';
  const vslug = slugVillage(village);

  try {
    // ── Notion side ──────────────────────────────────────────────────────
    const villageFilter = { property: 'Village', rich_text: { equals: village } };

    const [actRows, volRows, stwRows, projRows] = [
      ACTIVITIES_DB_ID ? await queryAll(ACTIVITIES_DB_ID, villageFilter) : [],
      VOLUNTEERS_DB_ID ? await queryAll(VOLUNTEERS_DB_ID, villageFilter) : [],
      STEWARDS_DB_ID ? await queryAll(STEWARDS_DB_ID, villageFilter) : [],
      PROJECTS_DB ? await queryAll(PROJECTS_DB, villageFilter) : [],
    ];

    // The canonical card's display title, taken from something already using
    // it, so the merged records read the way the rest of the system does.
    let toTitle = null;
    for (const a of actRows.map(parseActivity)) {
      if (normPath(a.cardPath) === toPath && a.cardTitle) { toTitle = a.cardTitle; break; }
    }

    const activities = actRows.map(parseActivity).filter((a) => normPath(a.cardPath) === fromPath);
    const volunteers = volRows.map(parseVolunteer)
      .filter((v) => (v.cards || []).some((c) => normPath(c.path) === fromPath));
    const stewards = stwRows.map(parseSteward)
      .filter((s) => (s.cards || []).some((c) => normPath(c.path) === fromPath));
    const projects = projRows.map(parseProject)
      .filter((pr) => (pr.volunteerGroups || []).some((g) => normPath(g?.path || g) === fromPath));

    const activityHours = Math.round(activities.reduce((s, a) => s + (Number(a.totalHours) || 0), 0) * 100) / 100;

    // ── Supabase side ────────────────────────────────────────────────────
    const counts = { hours: 0, attendance: 0, rsvpsGroup: 0, rsvpsActivity: 0, volunteers: 0, groupLinks: 0, roles: 0 };
    if (vappConfigured()) {
      const n = async (path) => {
        const r = await supa(path, { headers: { Prefer: 'count=exact', Range: '0-0' } });
        return Array.isArray(r.data) ? r.data.length : 0;
      };
      const rows = async (path) => {
        const r = await supa(path);
        return Array.isArray(r.data) ? r.data : [];
      };
      counts.hours = (await rows(`hours?village_id=eq.${vslug}&group_id=eq.${fromSlug}&select=id`)).length;
      counts.attendance = (await rows(`attendance?village_id=eq.${vslug}&group_id=eq.${fromSlug}&select=id`)).length;
      counts.rsvpsGroup = (await rows(`rsvps?village_id=eq.${vslug}&group_id=eq.${fromSlug}&select=id`)).length;
      counts.rsvpsActivity = (await rows(`rsvps?village_id=eq.${vslug}&activity_id=eq.${fromSlug}&select=id`)).length;
      counts.volunteers = (await rows(`volunteers?village_id=eq.${vslug}&group_id=eq.${fromSlug}&select=id`)).length;
      counts.groupLinks = (await rows(`volunteer_groups?village_id=eq.${vslug}&group_id=eq.${fromSlug}&select=id`)).length;
      counts.roles = (await rows(`volunteer_roles?village_id=eq.${vslug}&group_id=eq.${fromSlug}&select=id`)).length;
      void n;
    }

    const total = activities.length + volunteers.length + stewards.length + projects.length
      + Object.values(counts).reduce((a, b) => a + b, 0);

    const plan = {
      village, from: fromPath, to: toPath, toTitle,
      notion: {
        activities: activities.length,
        activityHoursMoving: activityHours,
        volunteers: volunteers.length,
        stewards: stewards.length,
        projects: projects.map((x) => x.name),
      },
      supabase: counts,
      total,
      supabaseConfigured: vappConfigured(),
    };

    if (!commit) {
      return jsonResp(200, {
        dryRun: true, ...plan,
        remainingManualStep: activities.length || volunteers.length || stewards.length
          ? `After this runs, the "${fromPath}" content card will have no records left. Archive it in Notion so it stops appearing as a choice.`
          : null,
      });
    }

    if (body.confirm !== true) return jsonResp(400, { error: 'Set confirm:true to commit.' });
    if (Number(body.expected) !== total) {
      return jsonResp(409, {
        error: `Expected ${body.expected} changes but found ${total}. Re-run the dry run and commit with the current number.`,
        total,
      });
    }

    // ── Commit: Notion ───────────────────────────────────────────────────
    for (const a of activities) {
      await patchPage(a.id, {
        'Card Path': { rich_text: rtChunks(toPath) },
        ...(toTitle ? { 'Card Title': { rich_text: rtChunks(toTitle) } } : {}),
      });
    }
    for (const v of volunteers) {
      const { cards } = swapCards(v.cards, fromPath, toPath, toTitle);
      await patchPage(v.id, { 'Cards': { rich_text: rtChunks(JSON.stringify(cards)) } });
    }
    for (const s of stewards) {
      const { cards } = swapCards(s.cards, fromPath, toPath, toTitle);
      await patchPage(s.id, { 'Cards': { rich_text: rtChunks(JSON.stringify(cards)) } });
    }
    for (const pr of projects) {
      const { cards } = swapCards(pr.volunteerGroups, fromPath, toPath, toTitle);
      await patchPage(pr.id, { 'Volunteer Groups': { rich_text: rtChunks(JSON.stringify(cards)) } });
    }

    // ── Commit: Supabase ─────────────────────────────────────────────────
    if (vappConfigured()) {
      const patch = (path, payload) => supa(path, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(payload),
      });
      const del = (path) => supa(path, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });

      await patch(`hours?village_id=eq.${vslug}&group_id=eq.${fromSlug}`, { group_id: toSlug });
      await patch(`attendance?village_id=eq.${vslug}&group_id=eq.${fromSlug}`, { group_id: toSlug });
      await patch(`rsvps?village_id=eq.${vslug}&group_id=eq.${fromSlug}`, { group_id: toSlug });
      await patch(`volunteers?village_id=eq.${vslug}&group_id=eq.${fromSlug}`, { group_id: toSlug });

      // rsvps is unique (volunteer_id, activity_id) and volunteer_groups /
      // volunteer_roles are unique per (volunteer, group): anyone already on
      // the canonical slug would collide, so drop the duplicate and rename
      // only the rest.
      const dedupe = async (table, col, extra = '') => {
        const dupes = await supa(`${table}?village_id=eq.${vslug}&${col}=eq.${fromSlug}&select=id,volunteer_id${extra}`);
        const keep = await supa(`${table}?village_id=eq.${vslug}&${col}=eq.${toSlug}&select=volunteer_id`);
        const have = new Set((Array.isArray(keep.data) ? keep.data : []).map((r) => r.volunteer_id));
        for (const r of (Array.isArray(dupes.data) ? dupes.data : [])) {
          if (have.has(r.volunteer_id)) await del(`${table}?id=eq.${r.id}`);
        }
        await patch(`${table}?village_id=eq.${vslug}&${col}=eq.${fromSlug}`, { [col]: toSlug });
      };
      await dedupe('rsvps', 'activity_id');
      await dedupe('volunteer_groups', 'group_id');
      await dedupe('volunteer_roles', 'group_id');
    }

    return jsonResp(200, { ok: true, committed: true, ...plan });
  } catch (err) {
    return jsonResp(502, { error: err.message });
  }
};

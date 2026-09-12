/**
 * volunteer-ledger.js — the volunteer-hours ledger, joined to projects and grants.
 *
 * The question this answers: "how many volunteer hours has this village
 * actually banked, which project does each hour belong to, what are they worth
 * as in-kind co-contribution, and which grant do they evidence?"
 *
 * Until now that could not be answered. Approved app hours were invisible
 * outside the app, working-bee hours lived in Notion, and no screen put either
 * next to a project or a grant. See _vledger.js for how the two sources are
 * merged without double-counting the mirrored rows.
 *
 * GET /api/volunteer-ledger?village=Smiths Lake[&from=YYYY-MM-DD][&to=…][&format=csv]
 *   → { village, range, totals, projects, unlinked, sharedGroups, groupTitles }
 *   format=csv returns the per-project x per-group rows as a CSV attachment,
 *   which is the shape a grant acquittal actually wants.
 *
 * Auth: village admin / pm / treasurer — the people who answer to funders.
 * A steward is deliberately NOT given the whole-village money view; their own
 * group's hours are in the app and in /admin/volunteers/hours/.
 */

import { requireRole } from './_auth.js';
import {
  jsonResp, listGroups, PROJECTS_DB, queryAll, parseProject, grantsForProject,
} from './_projects.js';
import { ACTIVITIES_DB_ID, parseActivity } from './_stewards.js';
import { ledgerByGroup, attachToProjects, groupKeyOfPath } from './_vledger.js';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const handler = async (event, context) => {
  const params = event.queryStringParameters || {};
  const village = params.village || process.env.VILLAGE_NAME || 'Smiths Lake';

  const auth = requireRole(context, { village, anyOf: ['admin', 'pm', 'treasurer'] });
  if (!auth.ok) return jsonResp(auth.status, { error: auth.error });

  const from = isDate(params.from) ? params.from : null;
  const to = isDate(params.to) ? params.to : null;
  const villageRate = Number(process.env.VF_VOLUNTEER_HOUR_RATE) || 0;

  try {
    // Notion allows ~3 requests/sec and this page reads four databases, each
    // paginated. Firing them together earned a 429 on the first real use, so
    // the Notion reads are sequential and VF Activities — which both the
    // ledger and listGroups() need — is fetched ONCE and passed through.
    const activities = ACTIVITIES_DB_ID
      ? (await queryAll(ACTIVITIES_DB_ID, { property: 'Village', rich_text: { equals: village } })).map(parseActivity)
      : [];
    const projectPages = PROJECTS_DB
      ? await queryAll(PROJECTS_DB, { property: 'Village', rich_text: { equals: village } })
      : [];
    const groups = await listGroups(village);
    // Supabase is a different service, so this one may overlap nothing.
    const rows = await ledgerByGroup(village, { from, to }, activities);

    const projects = projectPages.map(parseProject).filter((p) => p.status !== 'Archived');
    const { perProject, unlinked, sharedGroups } = attachToProjects(rows, projects, { villageRate });

    // Human titles for the group slugs, so the ledger reads in card names
    // rather than in the app's internal keys.
    const groupTitles = {};
    for (const g of groups) groupTitles[groupKeyOfPath(g.path)] = g.title;

    // Grants hang off a project by slug, so an hour can be traced all the way
    // to the funder it is being claimed against. Only fetched for projects
    // that actually have hours — the rest would be a wasted round trip each.
    for (const p of perProject) {
      p.grants = [];
      if (!p.slug || p.totalHours <= 0) continue;   // skip: a wasted Notion call each
      const gs = await grantsForProject(village, p.slug);
      p.grants = gs.map((g) => ({
        name: g.name, funder: g.funder, status: g.status,
        amountRequested: g.amountRequested ?? null, amountAwarded: g.amountAwarded ?? null,
      }));
    }

    const totals = {
      totalHours: round2(rows.reduce((s, r) => s + r.totalHours, 0)),
      appHours: round2(rows.reduce((s, r) => s + r.appHours, 0)),
      activityHours: round2(rows.reduce((s, r) => s + r.activityHours, 0)),
      linkedHours: round2(perProject.reduce((s, p) => s + p.totalHours, 0)),
      unlinkedHours: round2(unlinked.reduce((s, r) => s + r.totalHours, 0)),
      valuedTotal: round2(perProject.reduce((s, p) => s + p.value, 0)),
      projectsWithHours: perProject.filter((p) => p.totalHours > 0).length,
      projectsMissingRate: perProject.filter((p) => p.totalHours > 0 && p.noRateSet).map((p) => p.name),
    };

    if ((params.format || '').toLowerCase() === 'csv') {
      const head = ['Project', 'Project status', 'Grant program', 'Group', 'App hours',
        'Working-bee hours', 'Total hours', 'Hour rate', 'In-kind value', 'First worked', 'Last worked'];
      const lines = [head.join(',')];
      for (const p of perProject) {
        for (const g of p.groups) {
          lines.push([
            p.name, p.status, p.grantProgram || '',
            groupTitles[g.groupKey] || g.groupKey,
            g.appHours || 0, g.activityHours || 0, g.totalHours || 0,
            p.hourRate, round2((g.totalHours || 0) * p.hourRate),
            g.firstWorked || '', g.lastWorked || '',
          ].map(csvCell).join(','));
        }
      }
      for (const r of unlinked) {
        lines.push(['(not linked to a project)', '', '',
          groupTitles[r.groupKey] || r.groupKey,
          r.appHours, r.activityHours, r.totalHours, '', '',
          r.firstWorked || '', r.lastWorked || ''].map(csvCell).join(','));
      }
      const stamp = [from || 'start', to || 'today'].join('_to_');
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="volunteer-ledger-${stamp}.csv"`,
        },
        body: lines.join('\n'),
      };
    }

    return jsonResp(200, {
      village, range: { from, to }, villageRate,
      totals, projects: perProject, unlinked, sharedGroups, groupTitles,
    });
  } catch (err) {
    return jsonResp(502, { error: err.message });
  }
};

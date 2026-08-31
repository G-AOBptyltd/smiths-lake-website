/**
 * projects-get.js — GET /api/projects-get?village=Smiths Lake&project=slug
 *
 * The Projects drill-in aggregator. Assembles ONE project's whole picture from
 * the modules that already own the data:
 *   { project, schedule, budget, rollups, grants, volunteers, exec }
 *
 * - schedule/budget/rollups : co-contribution DBs (single source of truth via
 *                             computeRollups)
 * - grants                  : VF Grants rows whose Project == slug
 * - volunteers              : confirmed working-bee hours for the project's
 *                             linked groups + volunteer counts (indicative $)
 * - exec                    : the steering-committee number set
 *
 * Auth: village admin / treasurer / pm / super-admin (money is read-only for
 * pm; editing happens through cocon-save / grant-admin with their own floors).
 */

import { requireRole } from './_auth.js';
import { requireEntitlement } from './_entitlements.js';
import { computeRollups } from './_cocon-calc.js';
import {
  PROJECTS_DB, SCHEDULE_DB, BUDGET_DB, jsonResp, queryAll,
  parseProject, parseSchedule, parseBudget, ensureProjectSchema,
  grantsForProject, aggregateVolunteers, execNumbers, listGroups,
} from './_projects.js';

export const handler = async (event, context) => {
  if (event.httpMethod !== 'GET') return jsonResp(405, { error: 'GET only' });

  const village = event.queryStringParameters?.village || process.env.VILLAGE_NAME || 'Smiths Lake';
  const slug = event.queryStringParameters?.project || '';

  const auth = requireRole(context, { village, anyOf: ['admin', 'treasurer', 'pm'] });
  if (!auth.ok) return jsonResp(auth.status, { error: auth.error });
  const ent = await requireEntitlement(village, 'projects');
  if (!ent.ok) return jsonResp(ent.status, { error: ent.error });

  if (!PROJECTS_DB || !SCHEDULE_DB || !BUDGET_DB) {
    return jsonResp(503, { error: 'Co-Contribution/Projects databases not configured. Set NOTION_COCON_PROJECTS_DB_ID, NOTION_COCON_SCHEDULE_DB_ID, NOTION_COCON_BUDGET_DB_ID.' });
  }
  if (!slug) return jsonResp(400, { error: 'project (slug) is required' });

  await ensureProjectSchema();

  try {
    const villageFilter = { property: 'Village', rich_text: { equals: village } };
    const projectFilter = { and: [villageFilter, { property: 'Project', rich_text: { equals: slug } }] };

    const [projPages, schedPages, budgetPages] = await Promise.all([
      queryAll(PROJECTS_DB, { and: [villageFilter, { property: 'Slug', rich_text: { equals: slug } }] }),
      queryAll(SCHEDULE_DB, projectFilter),
      queryAll(BUDGET_DB, projectFilter),
    ]);

    if (!projPages.length) return jsonResp(404, { error: 'Project not found' });
    const project = parseProject(projPages[0]);
    const schedule = schedPages.map(parseSchedule).sort((a, b) => a.order - b.order);
    const budget = budgetPages.map(parseBudget).sort((a, b) => a.order - b.order);
    const rollups = computeRollups(schedule, budget, project);

    const [grants, volunteers, availableGroups] = await Promise.all([
      grantsForProject(village, slug),
      aggregateVolunteers(village, project.volunteerGroups),
      listGroups(village),
    ]);
    const exec = execNumbers(project, rollups, grants, volunteers);

    return jsonResp(200, { project, schedule, budget, rollups, grants, volunteers, exec, availableGroups });
  } catch (err) {
    return jsonResp(502, { error: err.message });
  }
};

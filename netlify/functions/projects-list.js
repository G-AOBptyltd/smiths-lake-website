/**
 * projects-list.js — GET /api/projects-list?village=Smiths Lake
 *
 * The Projects home list. Returns every project for the village with its
 * metadata plus two cheap rollups (budget total, grant awarded) so the list
 * can show progress without the full per-project aggregation (that lives in
 * projects-get). Volunteer hours are intentionally NOT computed here (heavy).
 *
 * NOTE: distinct from the older project-list.js, which returns "Project Hub"
 * CONTENT items for the survey builder — different concept, different DB.
 *
 * Auth: village admin / treasurer / pm / super-admin.
 */

import { requireRole } from './_auth.js';
import { requireEntitlement } from './_entitlements.js';
import {
  PROJECTS_DB, BUDGET_DB, jsonResp, queryAll,
  parseProject, parseBudget, ensureProjectSchema, grantsForProject, listGroups,
} from './_projects.js';

export const handler = async (event, context) => {
  if (event.httpMethod !== 'GET') return jsonResp(405, { error: 'GET only' });

  const village = event.queryStringParameters?.village || process.env.VILLAGE_NAME || 'Smiths Lake';
  const auth = requireRole(context, { village, anyOf: ['admin', 'treasurer', 'pm'] });
  if (!auth.ok) return jsonResp(auth.status, { error: auth.error });
  const ent = await requireEntitlement(village, 'projects');
  if (!ent.ok) return jsonResp(ent.status, { error: ent.error });

  if (!PROJECTS_DB) {
    return jsonResp(503, { error: 'Projects database not configured. Set NOTION_COCON_PROJECTS_DB_ID.' });
  }

  await ensureProjectSchema();

  try {
    const villageFilter = { property: 'Village', rich_text: { equals: village } };
    const [projPages, budgetPages] = await Promise.all([
      queryAll(PROJECTS_DB, villageFilter),
      BUDGET_DB ? queryAll(BUDGET_DB, villageFilter) : Promise.resolve([]),
    ]);

    // Budget total per project slug (non-archived lines only).
    const budgetBySlug = {};
    budgetPages.map(parseBudget).forEach((b) => {
      if (b.archived) return;
      budgetBySlug[b.project] = (budgetBySlug[b.project] || 0) + (Number(b.amount) || 0);
    });

    const projects = projPages.map(parseProject).sort((a, b) => a.name.localeCompare(b.name));

    // Grant awarded per project — grants read per project, grouped here.
    const awardedBySlug = {};
    await Promise.all(projects.map(async (p) => {
      const grants = await grantsForProject(village, p.slug);
      awardedBySlug[p.slug] = grants
        .filter((g) => g.status === 'Successful')
        .reduce((s, g) => s + (Number(g.amountAwarded) || 0), 0);
    }));

    const out = projects.map((p) => ({
      ...p,
      budgetTotal: budgetBySlug[p.slug] || 0,
      grantAwarded: awardedBySlug[p.slug] || 0,
      groupCount: (p.volunteerGroups || []).length,
    }));

    const availableGroups = await listGroups(village);
    return jsonResp(200, { projects: out, availableGroups });
  } catch (err) {
    return jsonResp(502, { error: err.message });
  }
};

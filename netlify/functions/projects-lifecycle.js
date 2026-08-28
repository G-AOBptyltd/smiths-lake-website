/**
 * projects-lifecycle.js — POST /api/projects-lifecycle
 *
 * Archive / restore / delete a whole project (the cocon Projects row).
 * Mirrors the survey-admin + cocon-lifecycle patterns.
 *
 * Body: { village?, projectId, action: 'archive' | 'restore' | 'delete' }
 *   archive : Status -> 'Archived'  (soft, reversible)          admin | pm
 *   restore : Status -> 'Active'                                admin | pm
 *   delete  : Notion page archived:true (trash, recoverable)    admin only
 *
 * The project's budget/schedule/grant links are left in Notion; a deleted
 * project page is recoverable from Notion trash.
 */

import { requireRole } from './_auth.js';
import { PROJECTS_DB, jsonResp, notionHeaders } from './_projects.js';

const rt = (p) => (p?.rich_text || []).map((t) => t.plain_text).join('');

export const handler = async (event, context) => {
  if (event.httpMethod !== 'POST') return jsonResp(405, { error: 'POST only' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return jsonResp(400, { error: 'Invalid JSON' }); }
  const village = body.village || process.env.VILLAGE_NAME || 'Smiths Lake';
  const projectId = body.projectId;
  const action = body.action;

  if (!projectId) return jsonResp(400, { error: 'projectId is required' });
  if (!['archive', 'restore', 'delete'].includes(action)) return jsonResp(400, { error: 'action must be archive | restore | delete' });
  if (!PROJECTS_DB) return jsonResp(503, { error: 'Projects database not configured' });

  // delete is admin-only; archive/restore allow pm too.
  const need = action === 'delete' ? ['admin'] : ['admin', 'pm'];
  const auth = requireRole(context, { village, anyOf: need });
  if (!auth.ok) return jsonResp(auth.status, { error: auth.error });

  try {
    // Confirm the page is a project in this village before mutating it.
    const res = await fetch(`https://api.notion.com/v1/pages/${projectId}`, { headers: notionHeaders() });
    if (!res.ok) return jsonResp(404, { error: 'Project not found' });
    const page = await res.json();
    const parent = page.parent?.database_id?.replace(/-/g, '');
    if (parent !== PROJECTS_DB.replace(/-/g, '')) return jsonResp(400, { error: 'That record is not a project' });
    if (rt(page.properties?.Village) && rt(page.properties.Village) !== village) return jsonResp(404, { error: 'Project not found in this village' });

    let patchBody;
    if (action === 'delete') {
      patchBody = { archived: true };
    } else {
      patchBody = { properties: { 'Status': { select: { name: action === 'archive' ? 'Archived' : 'Active' } } } };
    }
    const patch = await fetch(`https://api.notion.com/v1/pages/${projectId}`, {
      method: 'PATCH', headers: notionHeaders(), body: JSON.stringify(patchBody),
    });
    if (!patch.ok) {
      const detail = await patch.text();
      throw new Error(`Notion responded ${patch.status}: ${detail.slice(0, 200)}`);
    }
    return jsonResp(200, { ok: true, state: action === 'delete' ? 'deleted' : (action === 'archive' ? 'archived' : 'restored') });
  } catch (err) {
    return jsonResp(502, { error: err.message });
  }
};

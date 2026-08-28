/**
 * project-link-grant.js — POST /api/project-link-grant
 *
 * Link (or unlink) an existing grant to a project by writing the grant's
 * "Project" field. Lets an admin/PM manage the grant<->project link straight
 * from the Projects page without needing full grant-edit rights.
 *
 * Body: { village?, grantId, projectSlug }   // projectSlug '' or null = unlink
 * Auth: village admin / pm / super-admin.
 */

import { requireRole } from './_auth.js';
import { jsonResp, notionHeaders } from './_projects.js';

const rt = (p) => (p?.rich_text || []).map((t) => t.plain_text).join('');

export const handler = async (event, context) => {
  if (event.httpMethod !== 'POST') return jsonResp(405, { error: 'POST only' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return jsonResp(400, { error: 'Invalid JSON' }); }
  const village = body.village || 'Smiths Lake';
  const grantId = body.grantId;
  const projectSlug = (body.projectSlug || '').toString().slice(0, 200);

  const auth = requireRole(context, { village, anyOf: ['admin', 'pm'] });
  if (!auth.ok) return jsonResp(auth.status, { error: auth.error });
  if (!grantId) return jsonResp(400, { error: 'grantId is required' });

  try {
    // Fetch the grant page and sanity-check it's a grant in this village.
    const res = await fetch(`https://api.notion.com/v1/pages/${grantId}`, { headers: notionHeaders() });
    if (!res.ok) return jsonResp(404, { error: 'Grant not found' });
    const props = (await res.json()).properties || {};
    const isGrant = !!props.Grant && Object.prototype.hasOwnProperty.call(props, 'Project');
    if (!isGrant) return jsonResp(400, { error: 'That record is not a grant' });
    if (rt(props.Village) && rt(props.Village) !== village) return jsonResp(404, { error: 'Grant not found in this village' });

    const patch = await fetch(`https://api.notion.com/v1/pages/${grantId}`, {
      method: 'PATCH', headers: notionHeaders(),
      body: JSON.stringify({ properties: { 'Project': { rich_text: projectSlug ? [{ text: { content: projectSlug } }] : [] } } }),
    });
    if (!patch.ok) {
      const detail = await patch.text();
      throw new Error(`Notion responded ${patch.status}: ${detail.slice(0, 200)}`);
    }
    return jsonResp(200, { ok: true, project: projectSlug });
  } catch (err) {
    return jsonResp(502, { error: err.message });
  }
};

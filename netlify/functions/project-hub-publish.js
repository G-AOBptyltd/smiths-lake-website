/**
 * project-hub-publish.js — POST /api/project-hub-publish { village, projectId }
 *
 * The "Publish to Hub" write-side of the two-way Project Hub link. When a SoR
 * project has "Publish to Hub" ticked, this creates (or refreshes) a matching
 * "Project Hub" card in the site CONTENT DB and writes its slug back to the
 * project's "Hub Slug" field.
 *
 * SAFE BY DEFAULT (publicity-gating): a newly-created card is a DRAFT
 * (Status on Web = Pending, Show on Website = FALSE) — it only appears on the
 * public site after the committee edits it and runs the normal website publish.
 * An existing/already-live card is never downgraded.
 *
 * Auth: village admin / pm / super-admin.
 */

import { requireRole } from './_auth.js';
import { PROJECTS_DB, jsonResp, notionHeaders, queryAll, parseHubSlugs } from './_projects.js';

const CONTENT_DB_ID = process.env.NOTION_CONTENT_DB_ID || '2cad508adfc1809d8438c8f3a5dd8d42';
const SECTION_NAME = 'Project Hub';

const rt = (p) => (p?.rich_text || []).map((t) => t.plain_text).join('');
function slugify(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100);
}

async function getContentSchema() {
  const res = await fetch(`https://api.notion.com/v1/databases/${CONTENT_DB_ID}`, { headers: notionHeaders() });
  if (!res.ok) throw new Error(`Could not read the content database (${res.status})`);
  return (await res.json()).properties || {};
}

// Build a Section value that matches whatever type the content DB uses.
function sectionProp(schema) {
  const t = schema.Section?.type;
  if (t === 'multi_select') return { multi_select: [{ name: SECTION_NAME }] };
  return { select: { name: SECTION_NAME } };
}
// "Show on Website" is a select of TRUE/FALSE on this DB, but tolerate a checkbox.
function showProp(schema, on) {
  const t = schema['Show on Website']?.type;
  if (t === 'checkbox') return { checkbox: !!on };
  return { select: { name: on ? 'TRUE' : 'FALSE' } };
}

export const handler = async (event, context) => {
  if (event.httpMethod !== 'POST') return jsonResp(405, { error: 'POST only' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return jsonResp(400, { error: 'Invalid JSON' }); }
  const village = body.village || process.env.VILLAGE_NAME || 'Smiths Lake';
  const projectId = body.projectId;

  const auth = requireRole(context, { village, anyOf: ['admin', 'pm'] });
  if (!auth.ok) return jsonResp(auth.status, { error: auth.error });
  if (!projectId) return jsonResp(400, { error: 'projectId is required' });
  if (!PROJECTS_DB) return jsonResp(503, { error: 'Projects database not configured' });

  try {
    // Load the project.
    const projRes = await fetch(`https://api.notion.com/v1/pages/${projectId}`, { headers: notionHeaders() });
    if (!projRes.ok) return jsonResp(404, { error: 'Project not found' });
    const pp = (await projRes.json()).properties || {};
    const name = pp.Name?.title?.[0]?.plain_text || '';
    const description = rt(pp.Description);
    const publishToHub = pp['Publish to Hub']?.checkbox === true;
    // Link to any already-chosen Project Hub cards; if none, mint one from the
    // project's own slug so "Publish to Hub" always yields a card.
    let slugs = parseHubSlugs(pp['Hub Slug']).map(slugify).filter(Boolean);
    if (!slugs.length) slugs = [slugify(rt(pp.Slug) || name)].filter(Boolean);
    if (!name || !slugs.length) return jsonResp(400, { error: 'The project needs a name before it can appear on the Project Hub.' });
    if (!publishToHub) {
      return jsonResp(200, { ok: true, skipped: true, message: 'Tick "Show as a Project Hub card" first, then save.' });
    }

    const schema = await getContentSchema();
    let created = 0, linked = 0;

    for (const slug of slugs) {
      const existing = (await queryAll(CONTENT_DB_ID, { property: 'Slug', rich_text: { equals: slug } }))[0];
      if (existing) {
        // Refresh title/section only — never downgrade an already-live card.
        await fetch(`https://api.notion.com/v1/pages/${existing.id}`, {
          method: 'PATCH', headers: notionHeaders(),
          body: JSON.stringify({ properties: {
            'Title': { title: [{ text: { content: name.slice(0, 200) } }] },
            'Section': sectionProp(schema),
            'Slug': { rich_text: [{ text: { content: slug } }] },
          } }),
        });
        linked += 1;
        continue;
      }
      // Create a NEW Project Hub card as a draft.
      const props = {
        'Title': { title: [{ text: { content: name.slice(0, 200) } }] },
        'Section': sectionProp(schema),
        'Slug': { rich_text: [{ text: { content: slug } }] },
      };
      if (schema['Status on Web']) props['Status on Web'] = { select: { name: 'Pending' } };
      if (schema['Show on Website']) props['Show on Website'] = showProp(schema, false);
      if (schema.Description && description) props.Description = { rich_text: [{ text: { content: description.slice(0, 2000) } }] };
      if (schema.Village) props.Village = { rich_text: [{ text: { content: village.slice(0, 100) } }] };
      const res = await fetch('https://api.notion.com/v1/pages', {
        method: 'POST', headers: notionHeaders(),
        body: JSON.stringify({ parent: { database_id: CONTENT_DB_ID }, properties: props }),
      });
      if (!res.ok) {
        const detail = await res.text();
        throw new Error(`Notion responded ${res.status}: ${detail.slice(0, 200)}`);
      }
      created += 1;
    }

    // Persist the (possibly newly-minted) slug set back onto the project.
    await fetch(`https://api.notion.com/v1/pages/${projectId}`, {
      method: 'PATCH', headers: notionHeaders(),
      body: JSON.stringify({ properties: { 'Hub Slug': { rich_text: [{ text: { content: JSON.stringify(slugs) } }] } } }),
    });

    const parts = [];
    if (created) parts.push(`${created} draft card${created > 1 ? 's' : ''} created`);
    if (linked) parts.push(`${linked} existing card${linked > 1 ? 's' : ''} refreshed`);
    return jsonResp(200, {
      ok: true, created, linked, hubSlugs: slugs,
      message: (parts.join(' and ') || 'Done') + '. New cards are drafts — add photos in Notion, then Publish website to make them live.',
    });
  } catch (err) {
    return jsonResp(502, { error: err.message });
  }
};

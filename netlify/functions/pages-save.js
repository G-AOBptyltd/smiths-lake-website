/**
 * pages-save.js — POST /.netlify/functions/pages-save
 *
 * Property-only update for a Village-pages row (About / Contact / story rows
 * in the village content DB). Writes Title + Description ONLY — never Section,
 * Slug, or the visibility flags — so a save can't knock a page off the site or
 * change which page renders as About/Contact. (The site's rich page-body
 * blocks are written separately via the existing /api/news-body machinery.)
 *
 * Body: {
 *   village?: string,
 *   pageId: string,        // must belong to the village's own content DB
 *   title: string,
 *   description: string,   // rendered as the page body fallback / contact copy
 *   dryRun?: boolean       // return the Notion payload without writing
 * }
 *
 * Auth: village admin / steward / super-admin — Identity JWT → requireRole
 * BEFORE any Notion access, same model as news-save.js.
 *
 * Cross-village guard: the page is retrieved first and its parent database id
 * must equal the village's registered Content DB ID, so a role in one village
 * can never edit another village's rows by guessing pageIds.
 *
 * Audit: stamps "Logged By"/"Logged by" with the admin's verified email when
 * the content DB carries that property (see _pages.js buildSaveProperties).
 *
 * NOTE: called via the raw /.netlify/functions/ path — netlify.toml (the /api
 * alias registry) is owned by other work; add an /api/pages-save redirect
 * there when convenient.
 */

import { requireRole } from './_auth.js';
import { getVillageRecord } from './_villages.js';
import { buildSaveProperties, normalizeId } from './_pages.js';

const NOTION_VERSION = '2022-06-28';

function json(statusCode, obj) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}

function notionHeaders() {
  return {
    Authorization: `Bearer ${process.env.NOTION_API_KEY}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  };
}

export const handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'POST only' });
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch {
    return json(400, { error: 'Invalid JSON' });
  }

  const village = body.village || process.env.VILLAGE_NAME || 'Smiths Lake';
  const auth = requireRole(context, { village, anyOf: ['admin', 'steward'] });
  if (!auth.ok) {
    return json(auth.status, { error: auth.error });
  }

  const pageId = normalizeId(body.pageId);
  if (!/^[a-f0-9]{32}$/.test(pageId)) {
    return json(400, { error: 'A valid pageId is required' });
  }
  const title = (body.title || '').trim();
  if (!title) {
    return json(400, { error: 'A title is required' });
  }
  const description = (body.description || '').trim();

  const rec = await getVillageRecord(village);
  if (!rec.contentDbId) {
    return json(400, { error: "Website tools aren't enabled for " + village + ' yet' });
  }

  try {
    // Retrieve the page: (a) prove it belongs to THIS village's content DB,
    // (b) learn whether it carries an audit-stamp property.
    const getRes = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
      headers: notionHeaders(),
    });
    if (!getRes.ok) {
      return json(getRes.status === 404 ? 404 : 502, { error: 'Could not load that page' });
    }
    const page = await getRes.json();
    const parentDb = normalizeId(page.parent?.database_id);
    if (parentDb !== normalizeId(rec.contentDbId)) {
      return json(403, { error: "That page isn't part of " + village + "'s website content" });
    }

    const properties = buildSaveProperties({
      title,
      description,
      editorEmail: auth.user.email,
      existingProps: page.properties,
    });

    if (body.dryRun) {
      return json(200, { ok: true, dryRun: true, pageId, properties });
    }

    const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
      method: 'PATCH',
      headers: notionHeaders(),
      body: JSON.stringify({ properties }),
    });
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`Notion responded ${res.status}: ${detail.slice(0, 200)}`);
    }
    return json(200, { ok: true, pageId });
  } catch (err) {
    return json(502, { error: err.message });
  }
};

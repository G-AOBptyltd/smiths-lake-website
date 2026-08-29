/**
 * pages-list.js — GET /.netlify/functions/pages-list?village=Smiths Lake
 *
 * Lists the village's About / Contact / story rows for the "Village pages"
 * admin console (/admin/pages/): the rows the About page renders (visible
 * History & Culture rows with story/about slugs or Category "Indigenous
 * Heritage", ordered by Priority Order) and the Contact page's Administration
 * & Reference contact row. Selection logic lives in _pages.js, a deliberate
 * mirror of src/lib/notion-about.js (the build-time source of truth).
 *
 * Rows that MATCH the About/Contact patterns but are hidden (not Published /
 * not shown on website) are also returned, flagged visible:false, so admins
 * can see why something isn't on the site.
 *
 * Auth: village admin / steward / super-admin — same server-side model as
 * news-list.js (Identity JWT → requireRole BEFORE any Notion access).
 *
 * NOTE: called via the raw /.netlify/functions/ path — netlify.toml (the /api
 * alias registry) is owned by other work; add an /api/pages-list redirect
 * there when convenient.
 */

import { requireRole } from './_auth.js';
import { getVillageRecord } from './_villages.js';
import { pageKind, parsePageItem } from './_pages.js';

const NOTION_VERSION = '2022-06-28';

function json(statusCode, obj) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}

export const handler = async (event, context) => {
  if (event.httpMethod !== 'GET') {
    return json(405, { error: 'GET only' });
  }

  const village = event.queryStringParameters?.village || process.env.VILLAGE_NAME || 'Smiths Lake';
  const auth = requireRole(context, { village, anyOf: ['admin', 'steward'] });
  if (!auth.ok) {
    return json(auth.status, { error: auth.error });
  }

  const rec = await getVillageRecord(village);
  if (!rec.contentDbId) {
    return json(400, { error: "Website tools aren't enabled for " + village + ' yet' });
  }

  try {
    // Server-side pre-filter to the two sections the About/Contact selection
    // draws from; the exact slug/category rules are applied in code (Notion
    // can't express the slug regex).
    const results = [];
    let cursor;
    do {
      const res = await fetch(`https://api.notion.com/v1/databases/${rec.contentDbId}/query`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.NOTION_API_KEY}`,
          'Notion-Version': NOTION_VERSION,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filter: {
            or: [
              { property: 'Section', select: { equals: 'History & Culture' } },
              { property: 'Section', select: { equals: 'Administration & Reference' } },
            ],
          },
          page_size: 100,
          ...(cursor ? { start_cursor: cursor } : {}),
        }),
      });
      if (!res.ok) throw new Error(`Notion responded ${res.status}`);
      const data = await res.json();
      results.push(...data.results);
      cursor = data.has_more ? data.next_cursor : undefined;
    } while (cursor);

    const items = results
      .filter((p) => pageKind(p.properties))
      .map(parsePageItem)
      .sort((a, b) => {
        // About rows first (site order: Priority Order, then title), then Contact.
        if (a.kind !== b.kind) return a.kind === 'about' ? -1 : 1;
        return a.priority - b.priority || a.title.localeCompare(b.title);
      });

    return json(200, { items });
  } catch (err) {
    return json(502, { error: err.message });
  }
};

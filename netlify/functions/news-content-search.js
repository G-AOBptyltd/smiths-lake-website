/**
 * news-content-search.js — GET /api/news-content-search?village=&section=
 *
 * The "Share existing" picker: published website items (everything except
 * Section = News and Project Hub internals), optionally filtered to one
 * section. Returns enough to render the click-to-select cards.
 */

import { requireRole } from './_auth.js';
import { getVillageRecord } from './_villages.js';

const NOTION_VERSION = '2022-06-28';


const PICKER_SECTIONS = [
  'History & Culture',
  'Services & Amenities',
  'Services',
  'Groups & Activities',
  'Environment & Sustainability',
  'Project Hub',
  'Emergency & Safety',
];

function corsHeaders() {
  return { 'Content-Type': 'application/json' };
}

export const handler = async (event, context) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: corsHeaders(), body: JSON.stringify({ error: 'GET only' }) };
  }

  const params = event.queryStringParameters || {};
  const village = params.village || process.env.VILLAGE_NAME || 'Smiths Lake';
  const auth = requireRole(context, { village, anyOf: ['admin', 'steward'] });
  if (!auth.ok) {
    return { statusCode: auth.status, headers: corsHeaders(), body: JSON.stringify({ error: auth.error }) };
  }

  const rec = await getVillageRecord(village);
  if (!rec.contentDbId) {
    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: "Website tools aren't enabled for " + village + ' yet' }) };
  }
  const contentDbId = rec.contentDbId;

  const sectionFilter = params.section && PICKER_SECTIONS.includes(params.section) ? params.section : null;

  const publishedFilter = {
    or: [
      { property: 'Status on Web', select: { equals: 'Published' } },
      { property: 'Show on Website', select: { equals: 'TRUE' } },
    ],
  };
  const sectionOr = {
    or: (sectionFilter ? [sectionFilter] : PICKER_SECTIONS).map((s) => ({
      property: 'Section', select: { equals: s },
    })),
  };

  try {
    const results = [];
    let cursor = undefined;
    do {
      const res = await fetch(`https://api.notion.com/v1/databases/${contentDbId}/query`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.NOTION_API_KEY}`,
          'Notion-Version': NOTION_VERSION,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filter: { and: [publishedFilter, sectionOr] },
          page_size: 100,
          ...(cursor ? { start_cursor: cursor } : {}),
        }),
      });
      if (!res.ok) throw new Error(`Notion responded ${res.status}`);
      const data = await res.json();
      results.push(...data.results);
      cursor = data.has_more ? data.next_cursor : undefined;
    } while (cursor);

    const items = results.map((page) => {
      const p = page.properties || {};
      return {
        id: page.id,
        title: p.Title?.title?.[0]?.plain_text || '(untitled)',
        section: p.Section?.select?.name || '',
        category: p.Category?.select?.name || '',
        hasPhoto: (p['Hero Image File']?.files || []).length > 0,
        showInNewsFeed: !!p['Show in News Feed']?.checkbox,
      };
    }).sort((a, b) => a.title.localeCompare(b.title));

    return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ items }) };
  } catch (err) {
    return { statusCode: 502, headers: corsHeaders(), body: JSON.stringify({ error: err.message }) };
  }
};

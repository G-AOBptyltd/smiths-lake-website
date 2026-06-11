/**
 * news-list.js — GET /api/news-list?village=Smiths Lake
 *
 * Returns items relevant to the News Desk:
 *   - every page with Section = "News" (stories, any status), and
 *   - every page currently flagged "Show in News Feed" (from any section).
 *
 * Auth: village admin / steward / super-admin (same model as surveys).
 * Multi-village: village param reserved — v1 serves the single content DB;
 * when more villages join, resolve DB id from the Villages registry here.
 */

import { requireRole } from './_auth.js';
import { getVillageRecord } from './_villages.js';

const NOTION_VERSION = '2022-06-28';


function corsHeaders() {
  return { 'Content-Type': 'application/json' };
}

function parseItem(page) {
  const p = page.properties || {};
  return {
    id: page.id,
    title: p.Title?.title?.[0]?.plain_text || '(untitled)',
    description: (p.Description?.rich_text || []).map(t => t.plain_text).join(''),
    section: p.Section?.select?.name || '',
    statusOnWeb: p['Status on Web']?.select?.name || '',
    showOnWebsite: p['Show on Website']?.select?.name === 'TRUE',
    showInNewsFeed: !!p['Show in News Feed']?.checkbox,
    publishDate: p['Publish Date']?.date?.start || null,
    hasPhoto: (p['Hero Image File']?.files || []).length > 0,
    lastEdited: page.last_edited_time,
  };
}

export const handler = async (event, context) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: corsHeaders(), body: JSON.stringify({ error: 'GET only' }) };
  }

  const village = event.queryStringParameters?.village || 'Smiths Lake';
  const auth = requireRole(context, { village, anyOf: ['admin', 'steward'] });
  if (!auth.ok) {
    return { statusCode: auth.status, headers: corsHeaders(), body: JSON.stringify({ error: auth.error }) };
  }

  const rec = await getVillageRecord(village);
  if (!rec.contentDbId) {
    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: "Website tools aren't enabled for " + village + ' yet' }) };
  }
  const contentDbId = rec.contentDbId;

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
          filter: {
            or: [
              { property: 'Section', select: { equals: 'News' } },
              { property: 'Show in News Feed', checkbox: { equals: true } },
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

    const items = results.map(parseItem).sort((a, b) => {
      const da = a.publishDate || '0000';
      const db = b.publishDate || '0000';
      return db.localeCompare(da);
    });

    return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ items }) };
  } catch (err) {
    return { statusCode: 502, headers: corsHeaders(), body: JSON.stringify({ error: err.message }) };
  }
};

/**
 * news-save.js — POST /api/news-save
 *
 * Create or update a news story in the website content DB.
 * Body: {
 *   village?: string,
 *   pageId?: string,          // present = update, absent = create
 *   title: string,
 *   description: string,      // the story body (site renders \n as paragraphs)
 *   publishDate?: string,     // YYYY-MM-DD
 *   live: boolean             // true = published + in feed, false = draft
 * }
 *
 * Live stories  → Status on Web = Published, Show on Website = TRUE,
 *                 Show in News Feed ✓, Publish Date set.
 * Drafts        → Status on Web = Pending, Show in News Feed unchecked
 *                 (never appears on the site).
 */

import { requireRole } from './_auth.js';
import { getVillageRecord } from './_villages.js';

const NOTION_VERSION = '2022-06-28';


function corsHeaders() {
  return { 'Content-Type': 'application/json' };
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
    return { statusCode: 405, headers: corsHeaders(), body: JSON.stringify({ error: 'POST only' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch {
    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const village = body.village || 'Smiths Lake';
  const auth = requireRole(context, { village, anyOf: ['admin', 'steward'] });
  if (!auth.ok) {
    return { statusCode: auth.status, headers: corsHeaders(), body: JSON.stringify({ error: auth.error }) };
  }

  const rec = await getVillageRecord(village);
  if (!rec.contentDbId) {
    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: "Website tools aren't enabled for " + village + ' yet' }) };
  }
  const contentDbId = rec.contentDbId;

  const title = (body.title || '').trim();
  if (!title) {
    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'A headline is required' }) };
  }
  const description = (body.description || '').trim();
  const live = !!body.live;
  const publishDate = body.publishDate || new Date().toISOString().slice(0, 10);

  const properties = {
    'Title': { title: [{ text: { content: title.slice(0, 200) } }] },
    'Description': { rich_text: description
      ? [{ text: { content: description.slice(0, 2000) } }]
      : [] },
    'Section': { select: { name: 'News' } },
    'Status on Web': { select: { name: live ? 'Published' : 'Pending' } },
    'Show on Website': { select: { name: live ? 'TRUE' : 'FALSE' } },
    'Show in News Feed': { checkbox: live },
    'Publish Date': { date: { start: publishDate } },
  };

  try {
    let res;
    if (body.pageId) {
      res = await fetch(`https://api.notion.com/v1/pages/${body.pageId}`, {
        method: 'PATCH',
        headers: notionHeaders(),
        body: JSON.stringify({ properties }),
      });
    } else {
      res = await fetch('https://api.notion.com/v1/pages', {
        method: 'POST',
        headers: notionHeaders(),
        body: JSON.stringify({ parent: { database_id: contentDbId }, properties }),
      });
    }

    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`Notion responded ${res.status}: ${detail.slice(0, 200)}`);
    }
    const page = await res.json();
    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({ ok: true, pageId: page.id, live }),
    };
  } catch (err) {
    return { statusCode: 502, headers: corsHeaders(), body: JSON.stringify({ error: err.message }) };
  }
};

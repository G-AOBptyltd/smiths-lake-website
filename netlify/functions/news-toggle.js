/**
 * news-toggle.js — POST /api/news-toggle
 *
 * Flip any website page in or out of the news feed (the "Share existing" flow
 * and the dashboard toggles).
 *
 * Body: {
 *   village?: string,
 *   pageId: string,
 *   showInNewsFeed: boolean,
 *   publishDate?: string   // used when enabling; defaults to today
 * }
 */

import { requireRole } from './_auth.js';

const NOTION_VERSION = '2022-06-28';

function corsHeaders() {
  return { 'Content-Type': 'application/json' };
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

  if (!body.pageId) {
    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'pageId required' }) };
  }

  const enable = !!body.showInNewsFeed;
  const properties = { 'Show in News Feed': { checkbox: enable } };
  if (enable) {
    properties['Publish Date'] = { date: { start: body.publishDate || new Date().toISOString().slice(0, 10) } };

    // When enabling for feed, verify page has content (description or body blocks)
    try {
      const pageRes = await fetch(`https://api.notion.com/v1/pages/${body.pageId}`, {
        headers: {
          Authorization: `Bearer ${process.env.NOTION_API_KEY}`,
          'Notion-Version': NOTION_VERSION,
        },
      });
      if (pageRes.ok) {
        const pageData = await pageRes.json();
        const desc = (pageData.properties?.Description?.rich_text || [])
          .map(rt => rt.text?.content || '')
          .join('')
          .trim();

        // Check if page has body blocks (excluding title blocks)
        let hasBodyContent = false;
        if (desc) hasBodyContent = true;
        else {
          const blocksRes = await fetch(`https://api.notion.com/v1/blocks/${body.pageId}/children?page_size=1`, {
            headers: {
              Authorization: `Bearer ${process.env.NOTION_API_KEY}`,
              'Notion-Version': NOTION_VERSION,
            },
          });
          if (blocksRes.ok) {
            const blocksData = await blocksRes.json();
            hasBodyContent = (blocksData.results || []).length > 0;
          }
        }

        if (!hasBodyContent) {
          return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'Stories must have content before publishing. Add a summary or use "Write a story" to add a rich body.' }) };
        }
      }
    } catch (err) {
      // If we can't verify, allow the toggle (fail-open) but log the issue
      console.warn('Could not verify page content:', err.message);
    }
  }

  try {
    const res = await fetch(`https://api.notion.com/v1/pages/${body.pageId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${process.env.NOTION_API_KEY}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ properties }),
    });
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`Notion responded ${res.status}: ${detail.slice(0, 200)}`);
    }
    return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ ok: true, showInNewsFeed: enable }) };
  } catch (err) {
    return { statusCode: 502, headers: corsHeaders(), body: JSON.stringify({ error: err.message }) };
  }
};

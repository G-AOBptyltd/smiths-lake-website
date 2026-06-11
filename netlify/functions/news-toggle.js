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

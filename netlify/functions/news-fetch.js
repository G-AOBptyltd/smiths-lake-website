/**
 * news-fetch.js — GET /api/news-fetch
 *
 * Fetches Notion page blocks for rendering on the public website.
 * Supports fetching by Notion page ID or Notion page URL.
 *
 * Query params:
 *   - pageId: Notion page ID (UUID format, e.g. 3c1d508adfc18165ba3dc282e38e0961)
 *   - url: Notion page URL (e.g. https://app.notion.com/p/3c1d508adfc18165ba3dc282e38e0961)
 *
 * Returns:
 *   { blocks: [...], ok: true }
 *
 * If no blocks found, returns { blocks: [], ok: true } — fail-open for graceful degradation.
 */

const NOTION_VERSION = '2022-06-28';

function json(statusCode, obj) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(obj),
  };
}

function notionHeaders() {
  return {
    Authorization: `Bearer ${process.env.NOTION_API_KEY}`,
    'Notion-Version': NOTION_VERSION,
  };
}

// Extract Notion page ID from a URL like "https://app.notion.com/p/3c1d508adfc18165ba3dc282e38e0961"
// or from slugged URLs like "https://app.notion.com/Smiths-Lake-Community-Day-3c1d508adfc18165ba3dc282e38e0961"
function extractPageIdFromUrl(urlStr) {
  try {
    const url = new URL(urlStr);
    const path = url.pathname + url.hash; // include hash for embedded URLs

    // Pattern 1: /p/UUID or /?p=UUID in query
    const pMatch = path.match(/\/p\/([a-f0-9]{32})/i) || urlStr.match(/[?&]p=([a-f0-9]{32})/i);
    if (pMatch) return pMatch[1];

    // Pattern 2: Slugged URL ending with -UUID
    const slugMatch = path.match(/([a-f0-9]{32})(?:\?|$|\/)/i);
    if (slugMatch) return slugMatch[1];

    // Pattern 3: Direct UUID in path
    if (/^[a-f0-9]{32}$/i.test(path)) return path;
  } catch (e) {
    // Invalid URL — fall through to return error
  }
  return null;
}

async function fetchPageBlocks(pageId) {
  const blocks = [];
  let cursor;

  try {
    do {
      const url = new URL(`https://api.notion.com/v1/blocks/${pageId}/children`);
      url.searchParams.set('page_size', '100');
      if (cursor) url.searchParams.set('start_cursor', cursor);

      const res = await fetch(url, { headers: notionHeaders() });

      if (!res.ok) {
        // If page doesn't exist or isn't accessible, return empty gracefully
        if (res.status === 404) return [];
        throw new Error(`Notion API ${res.status}`);
      }

      const data = await res.json();
      (data.results || []).forEach((block) => blocks.push(block));
      cursor = data.has_more ? data.next_cursor : undefined;
    } while (cursor);
  } catch (err) {
    // Fail-open: return what we have so far, or empty if error on first call
    console.error('news-fetch: error fetching blocks:', err.message);
  }

  return blocks;
}

export const handler = async (event) => {
  if (event.httpMethod !== 'GET') return json(405, { error: 'GET only' });

  const pageId = (event.queryStringParameters?.pageId || '').trim();
  const urlParam = (event.queryStringParameters?.url || '').trim();

  let id = pageId;

  // Try to extract page ID from URL if no direct pageId param
  if (!id && urlParam) {
    id = extractPageIdFromUrl(urlParam);
    if (!id) {
      return json(400, { error: 'Could not extract page ID from URL', blocks: [] });
    }
  }

  if (!id) {
    return json(400, { error: 'pageId or url query param required', blocks: [] });
  }

  // Normalize UUID: remove hyphens and lowercase
  id = id.toLowerCase().replace(/-/g, '');

  if (!/^[a-f0-9]{32}$/.test(id)) {
    return json(400, { error: 'Invalid Notion page ID format', blocks: [] });
  }

  try {
    const blocks = await fetchPageBlocks(id);
    return json(200, { blocks, ok: true });
  } catch (err) {
    // Fail-open: return empty blocks on any error
    return json(200, {
      blocks: [],
      ok: true,
      warning: err.message,
    });
  }
};

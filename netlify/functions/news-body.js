/**
 * news-body.js — POST /api/news-body
 *
 * Writes the Notion PAGE BODY for a news story from a structured, template-built
 * payload — paragraphs, images, and photo galleries (rendered as column grids).
 * This is what lets the News Desk publish long, photo-rich articles: /admin/news/
 * saves the short summary into the Description property (news-save.js), then calls
 * this to lay out the full illustrated story in the page body, which the website
 * renders via NotionPageContent.astro.
 *
 * Body: {
 *   village?: string,
 *   pageId: string,               // the page created by news-save.js
 *   heroUrl?: string,             // stable image URL for the feed card (Image URL prop)
 *   blocks: Array<
 *     | { type: 'paragraphs', text: string }         // blank-line / newline split into <p>
 *     | { type: 'heading', text: string }
 *     | { type: 'image', url: string, caption?: string }
 *     | { type: 'gallery', urls: string[] }          // laid out in rows of up to 3 columns
 *   >
 * }
 *
 * The existing page body is cleared first, so re-saving an edited story replaces
 * it cleanly rather than appending duplicates.
 */

import { requireRole } from './_auth.js';
import { getVillageRecord } from './_villages.js';

const NOTION_VERSION = '2022-06-28';
const NOTION_TEXT_LIMIT = 2000; // Notion rich_text content cap per segment

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

function richText(text) {
  return [{ type: 'text', text: { content: String(text).slice(0, NOTION_TEXT_LIMIT) } }];
}

function paragraphBlock(text) {
  return { object: 'block', type: 'paragraph', paragraph: { rich_text: richText(text) } };
}

function headingBlock(text) {
  return { object: 'block', type: 'heading_2', heading_2: { rich_text: richText(text) } };
}

// External image block (the URL is a stable Blobs URL served by news-image.js).
function imageBlock(url, caption) {
  const image = { type: 'external', external: { url } };
  if (caption) image.caption = richText(caption);
  return { object: 'block', type: 'image', image };
}

// A gallery row: 2–3 images side by side as a column_list. Notion requires a
// column_list to have ≥2 columns, so a lone trailing image is emitted as a plain
// image block by the caller.
function galleryRow(urls) {
  return {
    object: 'block',
    type: 'column_list',
    column_list: {
      children: urls.map((url) => ({
        object: 'block',
        type: 'column',
        column: { children: [imageBlock(url)] },
      })),
    },
  };
}

// Turn the structured payload into an ordered list of Notion blocks.
function buildBlocks(blocks) {
  const out = [];
  for (const b of Array.isArray(blocks) ? blocks : []) {
    if (!b || typeof b !== 'object') continue;

    if (b.type === 'paragraphs') {
      // Each non-empty line becomes its own paragraph (matches the site's
      // \n-splitting behaviour for the Description fallback).
      String(b.text || '')
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .forEach((line) => out.push(paragraphBlock(line)));
    } else if (b.type === 'heading') {
      if ((b.text || '').trim()) out.push(headingBlock(b.text.trim()));
    } else if (b.type === 'image') {
      if (b.url) out.push(imageBlock(b.url, b.caption));
    } else if (b.type === 'gallery') {
      const urls = (b.urls || []).filter(Boolean);
      // Rows of up to 3; a trailing single image can't be a 1-column list.
      for (let i = 0; i < urls.length; i += 3) {
        const row = urls.slice(i, i + 3);
        if (row.length >= 2) out.push(galleryRow(row));
        else out.push(imageBlock(row[0]));
      }
    }
  }
  return out;
}

// Remove every existing child block from the page (so a re-save replaces, not appends).
async function clearPageBody(pageId) {
  let cursor;
  const ids = [];
  do {
    const url = new URL(`https://api.notion.com/v1/blocks/${pageId}/children`);
    url.searchParams.set('page_size', '100');
    if (cursor) url.searchParams.set('start_cursor', cursor);
    const res = await fetch(url, { headers: notionHeaders() });
    if (!res.ok) break; // best-effort: a fresh page simply has no children
    const data = await res.json();
    (data.results || []).forEach((blk) => ids.push(blk.id));
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);

  for (const id of ids) {
    await fetch(`https://api.notion.com/v1/blocks/${id}`, {
      method: 'DELETE',
      headers: notionHeaders(),
    });
  }
}

async function appendBlocks(pageId, blocks) {
  // Notion accepts ≤100 children per append call.
  for (let i = 0; i < blocks.length; i += 100) {
    const chunk = blocks.slice(i, i + 100);
    const res = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children`, {
      method: 'PATCH',
      headers: notionHeaders(),
      body: JSON.stringify({ children: chunk }),
    });
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`Notion append ${res.status}: ${detail.slice(0, 200)}`);
    }
  }
}

export const handler = async (event, context) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Invalid JSON' }); }

  const village = body.village || 'Smiths Lake';
  const auth = requireRole(context, { village, anyOf: ['admin', 'steward'] });
  if (!auth.ok) return json(auth.status, { error: auth.error });

  const pageId = (body.pageId || '').trim();
  if (!pageId) return json(400, { error: 'A pageId is required (save the story first)' });

  const rec = await getVillageRecord(village);
  if (!rec.contentDbId) {
    return json(400, { error: "Website tools aren't enabled for " + village + ' yet' });
  }

  try {
    const notionBlocks = buildBlocks(body.blocks);

    await clearPageBody(pageId);
    if (notionBlocks.length) await appendBlocks(pageId, notionBlocks);

    // Set the feed-card hero image (Image URL property) when provided.
    const heroUrl = (body.heroUrl || '').trim();
    if (heroUrl) {
      await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
        method: 'PATCH',
        headers: notionHeaders(),
        body: JSON.stringify({ properties: { 'Image URL': { url: heroUrl } } }),
      });
    }

    return json(200, { ok: true, blockCount: notionBlocks.length });
  } catch (err) {
    return json(502, { error: err.message });
  }
};

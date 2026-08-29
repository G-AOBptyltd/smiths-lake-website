/**
 * Notion-driven About / Contact page body copy.
 *
 * Used ONLY when village.aboutSource === 'notion' (PUBLIC_ABOUT_SOURCE env).
 * The default ('builtin') never calls this module, so default builds remain
 * byte-identical to the historical hardcoded Smiths Lake pages.
 *
 * HOW VILLAGE "ABOUT" CONTENT IS SEEDED (see provision content payloads):
 * each village's content DB carries its story as History & Culture rows —
 * a Featured "our story" row (slug `our-story` / `the-story-of-<village>`,
 * Priority Order "1") plus optional companion rows such as the Indigenous
 * heritage "Worimi Country" row (Category "Indigenous Heritage", Priority
 * Order "2"). Contact copy is an Administration & Reference row with slug
 * `contact` / `contact-us` carrying Description + Contact Email.
 *
 * Every fetch failure or empty result returns null so callers fall back to
 * the hardcoded builtin copy.
 */

import { Client } from '@notionhq/client';
import { resilientFetch } from './notion-fetch.js';
import { queryAllPages } from './notion-query-all.js';

const notion = new Client({
  auth: process.env.NOTION_API_KEY,
  fetch: resilientFetch,
});

// Same DB either way — NOTION_DATABASE_ID and NOTION_CONTENT_DB_ID are aliases.
const DATABASE_ID = process.env.NOTION_DATABASE_ID || process.env.NOTION_CONTENT_DB_ID;

/** Join every rich-text/title segment (mirrors notion-unified.js parsing). */
function plain(property) {
  if (!property) return '';
  if (property.type === 'title') return property.title?.map((t) => t.plain_text).join('') || '';
  if (property.type === 'rich_text') return property.rich_text?.map((t) => t.plain_text).join('') || '';
  if (property.type === 'select') return property.select?.name || '';
  if (property.type === 'email') return property.email || '';
  return '';
}

/** Visibility gate — matches applyFilters in notion-unified.js. */
function isVisible(props) {
  const statusOnWeb = plain(props['Status on Web']);
  const showOnWebsite = plain(props['Show on Website']);
  return statusOnWeb === 'Published' || showOnWebsite === 'TRUE';
}

/** Numeric sort key from the rich_text "Priority Order" (missing → 999). */
function priorityOrder(props) {
  const n = parseInt(plain(props['Priority Order']), 10);
  return Number.isFinite(n) ? n : 999;
}

/** Slug fallback identical in spirit to the build's auto-slug (title-derived). */
function rowSlug(props) {
  const explicit = plain(props['Slug']);
  if (explicit) return explicit.toLowerCase();
  return plain(props['Title'])
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** About-ish detector — the seeded story/country rows, not the whole History section. */
function isAboutRow(props) {
  if (plain(props['Section']) !== 'History & Culture') return false;
  const slug = rowSlug(props);
  // "our-story", "the-story-of-<village>", explicit "about" slugs…
  if (/(^|-)story(-|$)|(^|-)about(-|$)/.test(slug)) return true;
  // …plus the Indigenous-heritage country row ("Worimi Country").
  if (plain(props['Category']) === 'Indigenous Heritage') return true;
  return false;
}

/**
 * Fetch a page's body blocks as renderable items.
 * @returns {Promise<Array<{type:'p'|'h3', text:string}>>}
 */
async function fetchBodyItems(pageId) {
  const items = [];
  let cursor;
  for (let i = 0; i < 20; i++) {
    const res = await notion.blocks.children.list({
      block_id: pageId,
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    for (const block of res.results || []) {
      const type = block.type;
      const rich = block[type]?.rich_text;
      if (!Array.isArray(rich)) continue;
      const text = rich.map((t) => t.plain_text).join('').trim();
      if (!text) continue;
      if (type === 'paragraph') items.push({ type: 'p', text });
      else if (type === 'heading_1' || type === 'heading_2' || type === 'heading_3') items.push({ type: 'h3', text });
      else if (type === 'bulleted_list_item' || type === 'numbered_list_item') items.push({ type: 'p', text });
      else if (type === 'quote' || type === 'callout') items.push({ type: 'p', text });
    }
    if (!res.has_more || !res.next_cursor) break;
    cursor = res.next_cursor;
  }
  return items;
}

/**
 * The village's About page content blocks, sensibly ordered.
 * @returns {Promise<Array<{title:string, items:Array<{type:'p'|'h3', text:string}>}>|null>}
 *          null ⇒ caller must fall back to the builtin hardcoded copy.
 */
export async function fetchAboutContent() {
  if (!DATABASE_ID || !process.env.NOTION_API_KEY) return null;
  try {
    const pages = await queryAllPages(notion, { database_id: DATABASE_ID });
    const rows = pages
      .filter((p) => p.properties && isVisible(p.properties) && isAboutRow(p.properties))
      .sort(
        (a, b) =>
          priorityOrder(a.properties) - priorityOrder(b.properties) ||
          plain(a.properties['Title']).localeCompare(plain(b.properties['Title']))
      );
    if (rows.length === 0) return null;

    const blocks = [];
    for (const row of rows) {
      const title = plain(row.properties['Title']);
      let items = [];
      try {
        items = await fetchBodyItems(row.id);
      } catch (e) {
        console.warn(`notion-about: body fetch failed for "${title}":`, e.message);
      }
      if (items.length === 0) {
        const description = plain(row.properties['Description']);
        if (description) items = [{ type: 'p', text: description }];
      }
      if (title && items.length > 0) blocks.push({ title, items });
    }
    return blocks.length > 0 ? blocks : null;
  } catch (error) {
    console.error('notion-about: about fetch failed:', error.message);
    return null;
  }
}

/**
 * The village's Contact page copy (Administration & Reference "contact" row).
 * @returns {Promise<{title:string, paragraphs:string[], contactEmail:string}|null>}
 */
export async function fetchContactContent() {
  if (!DATABASE_ID || !process.env.NOTION_API_KEY) return null;
  try {
    const pages = await queryAllPages(notion, { database_id: DATABASE_ID });
    const rows = pages
      .filter((p) => {
        const props = p.properties;
        if (!props || !isVisible(props)) return false;
        if (plain(props['Section']) !== 'Administration & Reference') return false;
        const slug = rowSlug(props);
        return /(^|-)contact(-|$)/.test(slug) && !slug.includes('emergency');
      })
      .sort((a, b) => priorityOrder(a.properties) - priorityOrder(b.properties));
    if (rows.length === 0) return null;

    const row = rows[0];
    const props = row.properties;
    const title = plain(props['Title']);
    let paragraphs = [];
    try {
      paragraphs = (await fetchBodyItems(row.id)).map((item) => item.text);
    } catch (e) {
      console.warn('notion-about: contact body fetch failed:', e.message);
    }
    if (paragraphs.length === 0) {
      const description = plain(props['Description']);
      if (description) paragraphs = [description];
    }
    if (paragraphs.length === 0) return null;

    const showPublicly = plain(props['Show Contact Publicly']) === 'TRUE';
    return {
      title: title || 'Contact us',
      paragraphs,
      contactEmail: showPublicly ? plain(props['Contact Email']) : '',
    };
  } catch (error) {
    console.error('notion-about: contact fetch failed:', error.message);
    return null;
  }
}

export default { fetchAboutContent, fetchContactContent };

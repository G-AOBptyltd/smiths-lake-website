/**
 * volunteer-groups.js — /api/volunteer-groups   (village admin / steward)
 *
 * Backs the "Sign-up Groups" screen in the Volunteers module of the admin
 * portal. Lets a village admin choose which website cards appear as joinable
 * groups in the Village1st Volunteer sign-up app — WITHOUT touching Notion.
 *
 *   GET  ?village=            → candidate cards + their current on/off state
 *   POST { village, pageId, enabled }
 *                            → set the "Sign-up Group" checkbox on that card
 *
 * The volunteer app reads the same "Sign-up Group" flag via its own function,
 * so this screen is simply the front-end for that flag. Kind (volunteer /
 * interest / club) and whether the WHS safety questions apply are derived from
 * the card's Category — the admin only toggles which cards are offered.
 */

import { requireRole } from './_auth.js';
import { getVillageRecord } from './_villages.js';

const NOTION_VERSION = '2022-06-28';

// Sections whose cards can be offered as sign-up groups.
const SECTIONS = ['Environment & Sustainability', 'Groups & Activities', 'Emergency & Safety'];
// Categories that are never joinable groups (info/reference/venue listings).
const EXCLUDE_CATEGORIES = new Set(['Reference', 'Function Venue']);
// Category → [kind, requiresSafety]. Unmapped falls back by section.
const CATEGORY_KIND = {
  'Sustainability & Conservation': ['volunteer', true],
  'Green Space / Bushland': ['volunteer', true],
  'Waterways': ['volunteer', true],
  'Fire & Rescue': ['volunteer', true],
  'Community Project': ['volunteer', true],
  'Community Service': ['volunteer', false],
  'Art & Culture': ['interest', false],
  'Social & Hobbies': ['interest', false],
  'Sports & Recreation': ['club', false],
};
const VOLUNTEER_SECTIONS = new Set(['Environment & Sustainability', 'Emergency & Safety']);

function corsHeaders() {
  return { 'Content-Type': 'application/json' };
}

function kindFor(category, section) {
  const m = CATEGORY_KIND[category];
  if (m) return { kind: m[0], requiresSafety: m[1] };
  const vol = VOLUNTEER_SECTIONS.has(section);
  return { kind: vol ? 'volunteer' : 'club', requiresSafety: vol };
}

export const handler = async (event, context) => {
  const params = event.queryStringParameters || {};
  const isPost = event.httpMethod === 'POST';
  let body = {};
  if (isPost) {
    try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'Invalid request' }) }; }
  }
  const village = (isPost ? body.village : params.village) || process.env.VILLAGE_NAME || 'Smiths Lake';

  const auth = requireRole(context, { village, anyOf: ['admin'] });
  if (!auth.ok) return { statusCode: auth.status, headers: corsHeaders(), body: JSON.stringify({ error: auth.error }) };

  const rec = await getVillageRecord(village);
  if (!rec.contentDbId) {
    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: "Website content isn't enabled for " + village + ' yet' }) };
  }
  const contentDbId = rec.contentDbId;
  const key = process.env.NOTION_API_KEY;

  // ---- POST: toggle a card's Sign-up Group flag ----
  if (isPost) {
    const pageId = String(body.pageId || '').trim();
    if (!pageId) return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'pageId required' }) };
    const enabled = body.enabled === true || body.enabled === 'true';
    try {
      const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${key}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' },
        body: JSON.stringify({ properties: { 'Sign-up Group': { checkbox: enabled } } }),
      });
      if (!res.ok) throw new Error(`Notion responded ${res.status}`);
      return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ ok: true, pageId, enabled }) };
    } catch (err) {
      return { statusCode: 502, headers: corsHeaders(), body: JSON.stringify({ error: err.message }) };
    }
  }

  // ---- GET: list candidate cards with their current state ----
  const publishedFilter = {
    or: [
      { property: 'Status on Web', select: { equals: 'Published' } },
      { property: 'Show on Website', select: { equals: 'TRUE' } },
    ],
  };
  const sectionOr = { or: SECTIONS.map((s) => ({ property: 'Section', select: { equals: s } })) };

  try {
    const results = [];
    let cursor;
    do {
      const res = await fetch(`https://api.notion.com/v1/databases/${contentDbId}/query`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' },
        body: JSON.stringify({ filter: { and: [publishedFilter, sectionOr] }, page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) }),
      });
      if (!res.ok) throw new Error(`Notion responded ${res.status}`);
      const data = await res.json();
      results.push(...data.results);
      cursor = data.has_more ? data.next_cursor : undefined;
    } while (cursor);

    const groups = results
      .map((page) => {
        const p = page.properties || {};
        const category = p.Category?.select?.name || '';
        if (EXCLUDE_CATEGORIES.has(category)) return null; // info/reference card
        const section = p.Section?.select?.name || '';
        const { kind, requiresSafety } = kindFor(category, section);
        return {
          id: page.id,
          title: p.Title?.title?.[0]?.plain_text || '(untitled)',
          category,
          section,
          kind,
          requiresSafety,
          signupGroup: !!p['Sign-up Group']?.checkbox,
        };
      })
      .filter(Boolean)
      .sort((a, b) => (a.kind).localeCompare(b.kind) || a.title.localeCompare(b.title));

    return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ village, groups }) };
  } catch (err) {
    return { statusCode: 502, headers: corsHeaders(), body: JSON.stringify({ error: err.message }) };
  }
};

/**
 * emergency-list.js — GET /api/emergency-list?village=   (admin / emergency)
 *
 * Every card in the content DB's "Emergency & Safety" section, with the
 * editable fields, for the Emergency module. Gated to the village-wide
 * Emergency Coordinator role (<village>:emergency) or admin — NOT card-scoped
 * (an emergency coordinator manages the whole emergency module for the village).
 */

import { requireRole } from './_auth.js';
import { getVillageRecord } from './_villages.js';

const NOTION_VERSION = '2022-06-28';
const EMERGENCY_SECTION = 'Emergency & Safety';

function nh() {
  return { Authorization: `Bearer ${process.env.NOTION_API_KEY}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' };
}
function resp(statusCode, obj) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}
// MUST match the site-wide generateSlug (CLAUDE.md invariant).
function generateSlug(title) {
  if (!title) return 'untitled';
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').substring(0, 100);
}
const text = (prop) => (prop?.rich_text || []).map((t) => t.plain_text).join('');

export function parseEmergencyCard(page) {
  const p = page.properties || {};
  const title = p.Title?.title?.[0]?.plain_text || '(untitled)';
  return {
    id: page.id,
    title,
    path: 'emergency/' + generateSlug(title),
    section: p.Section?.select?.name || '',
    statusOnWeb: p['Status on Web']?.select?.name || '',
    description: text(p.Description),
    responseInfo: text(p['Emergency Info']),
    contactPerson: text(p['Contact Person']),
    contactEmail: p['Contact Email']?.email || text(p['Contact Email']),
    contactPhone: p['Contact Phone']?.phone_number || text(p['Contact Phone']),
    showContactPublicly: p['Show Contact Publicly']?.select?.name || (p['Show Contact Publicly']?.checkbox ? 'TRUE' : ''),
    websiteUrl: p['Website URL']?.url || '',
    operatingHours: text(p['Operating Hours']),
    address: text(p.Address),
    lastEdited: page.last_edited_time,
  };
}

export const handler = async (event, context) => {
  if (event.httpMethod !== 'GET') return resp(405, { error: 'GET only' });

  const village = event.queryStringParameters?.village || process.env.VILLAGE_NAME || 'Smiths Lake';
  const auth = requireRole(context, { village, anyOf: ['admin', 'emergency'] });
  if (!auth.ok) return resp(auth.status, { error: auth.error });

  const rec = await getVillageRecord(village);
  if (!rec.contentDbId) return resp(400, { error: "Website tools aren't enabled for " + village + ' yet' });

  try {
    const results = [];
    let cursor;
    do {
      const res = await fetch(`https://api.notion.com/v1/databases/${rec.contentDbId}/query`, {
        method: 'POST', headers: nh(),
        body: JSON.stringify({
          filter: { property: 'Section', select: { equals: EMERGENCY_SECTION } },
          page_size: 100,
          ...(cursor ? { start_cursor: cursor } : {}),
        }),
      });
      if (!res.ok) throw new Error(`Notion responded ${res.status}`);
      const data = await res.json();
      results.push(...data.results);
      cursor = data.has_more ? data.next_cursor : undefined;
    } while (cursor);

    const cards = results.map(parseEmergencyCard).sort((a, b) => a.title.localeCompare(b.title));
    return resp(200, { cards, isAdmin: auth.user ? true : false });
  } catch (err) {
    return resp(502, { error: err.message });
  }
};

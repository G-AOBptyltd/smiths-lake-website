/**
 * service-list.js — GET /api/service-list?village=   (admin / steward)
 *
 * The services directory as the Services console sees it: every card in the
 * content DB's Services sections, with the steward-editable fields. Village
 * admins see all; a Service Steward sees only the cards assigned to them in
 * the VF Stewards register (paths "services/<slug>" — the same card-scoping
 * machinery as the Volunteer hub).
 */

import { resolveScope, scopeHasCard } from './_stewards.js';
import { getVillageRecord } from './_villages.js';

const NOTION_VERSION = '2022-06-28';
const SERVICE_SECTIONS = ['Services', 'Services & Amenities'];

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

export function parseService(page) {
  const p = page.properties || {};
  const title = p.Title?.title?.[0]?.plain_text || '(untitled)';
  return {
    id: page.id,
    title,
    path: 'services/' + generateSlug(title),
    section: p.Section?.select?.name || '',
    statusOnWeb: p['Status on Web']?.select?.name || '',
    description: text(p.Description),
    contactPerson: text(p['Contact Person']),
    contactEmail: p['Contact Email']?.email || text(p['Contact Email']),
    contactPhone: p['Contact Phone']?.phone_number || text(p['Contact Phone']),
    showContactPublicly: p['Show Contact Publicly']?.select?.name || (p['Show Contact Publicly']?.checkbox ? 'TRUE' : ''),
    websiteUrl: p['Website URL']?.url || '',
    facebookUrl: p['Facebook URL']?.url || '',
    operatingHours: text(p['Operating Hours']),
    address: text(p.Address),
    lastEdited: page.last_edited_time,
  };
}

export const handler = async (event, context) => {
  if (event.httpMethod !== 'GET') return resp(405, { error: 'GET only' });

  const village = event.queryStringParameters?.village || 'Smiths Lake';
  const scope = await resolveScope(context, village);
  if (!scope.ok) return resp(scope.status, { error: scope.error });

  const rec = await getVillageRecord(village);
  if (!rec.contentDbId) return resp(400, { error: "Website tools aren't enabled for " + village + ' yet' });

  try {
    const results = [];
    let cursor;
    do {
      const res = await fetch(`https://api.notion.com/v1/databases/${rec.contentDbId}/query`, {
        method: 'POST', headers: nh(),
        body: JSON.stringify({
          filter: { or: SERVICE_SECTIONS.map((s) => ({ property: 'Section', select: { equals: s } })) },
          page_size: 100,
          ...(cursor ? { start_cursor: cursor } : {}),
        }),
      });
      if (!res.ok) throw new Error(`Notion responded ${res.status}`);
      const data = await res.json();
      results.push(...data.results);
      cursor = data.has_more ? data.next_cursor : undefined;
    } while (cursor);

    const services = results.map(parseService)
      .filter((s) => scopeHasCard(scope, s.path))
      .sort((a, b) => a.title.localeCompare(b.title));

    return resp(200, { services, scope: { isAdmin: scope.isAdmin, cards: scope.cards } });
  } catch (err) {
    return resp(502, { error: err.message });
  }
};

/**
 * emergency-update.js — POST /api/emergency-update   (admin / emergency)
 *
 * Edits an Emergency & Safety card's fields in the content DB — contacts,
 * hours, address, website, description, and a dedicated "Emergency Info"
 * (response info) field which is self-healed onto the content DB if missing.
 * Gated to the village-wide Emergency Coordinator role or admin. Static build:
 * changes go live when the Publish button fires the build hook (~3 min).
 * Titles are NOT editable (a rename changes the URL/slug — an admin job).
 */

import { requireRole } from './_auth.js';
import { rtChunks } from './_stewards.js';
import { getVillageRecord } from './_villages.js';
import { parseEmergencyCard } from './emergency-list.js';

const NOTION_VERSION = '2022-06-28';
const EMERGENCY_SECTION = 'Emergency & Safety';

function nh() {
  return { Authorization: `Bearer ${process.env.NOTION_API_KEY}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' };
}
function resp(statusCode, obj) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}

export const handler = async (event, context) => {
  if (event.httpMethod !== 'POST') return resp(405, { error: 'POST only' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return resp(400, { error: 'Invalid JSON' }); }

  const village = body.village || process.env.VILLAGE_NAME || 'Smiths Lake';
  const auth = requireRole(context, { village, anyOf: ['admin', 'emergency'] });
  if (!auth.ok) return resp(auth.status, { error: auth.error });
  if (!body.pageId) return resp(400, { error: 'pageId required' });

  try {
    const rec = await getVillageRecord(village);
    if (!rec.contentDbId) return resp(400, { error: "Website tools aren't enabled for " + village + ' yet' });

    const pageRes = await fetch(`https://api.notion.com/v1/pages/${body.pageId}`, { headers: nh() });
    if (!pageRes.ok) return resp(404, { error: 'Card not found' });
    const page = await pageRes.json();
    if (page.parent?.database_id?.replace(/-/g, '') !== rec.contentDbId.replace(/-/g, '')) {
      return resp(404, { error: 'Card not found' });
    }
    const card = parseEmergencyCard(page);
    if (card.section !== EMERGENCY_SECTION) return resp(400, { error: 'That page is not an Emergency & Safety card' });

    const email = (body.contactEmail ?? card.contactEmail ?? '').trim().slice(0, 200);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return resp(400, { error: 'That contact email does not look valid' });
    const url = (v, cur) => {
      let s = (v ?? cur ?? '').trim().slice(0, 300);
      if (s && !/^https?:\/\//i.test(s)) s = 'https://' + s;
      return s || null;
    };

    // Self-heal a dedicated response-info field on the content DB (idempotent).
    const dbRes = await fetch(`https://api.notion.com/v1/databases/${rec.contentDbId}`, { headers: nh() });
    if (!dbRes.ok) throw new Error(`Notion responded ${dbRes.status} reading the content DB schema`);
    let schema = (await dbRes.json()).properties || {};
    if (!schema['Emergency Info']) {
      const patch = await fetch(`https://api.notion.com/v1/databases/${rec.contentDbId}`, {
        method: 'PATCH', headers: nh(), body: JSON.stringify({ properties: { 'Emergency Info': { rich_text: {} } } }),
      });
      if (patch.ok) schema = (await patch.json()).properties || schema;
    }

    const typed = (name, value) => {
      const t = schema[name]?.type;
      if (!t) return null;
      const s = value == null ? '' : String(value);
      if (t === 'rich_text') return { rich_text: rtChunks(s) };
      if (t === 'email') return { email: s || null };
      if (t === 'phone_number') return { phone_number: s || null };
      if (t === 'url') return { url: s || null };
      if (t === 'select') return { select: s ? { name: s } : null };
      if (t === 'checkbox') return { checkbox: s === 'TRUE' || s === 'true' };
      return null;
    };

    const showPub = (body.showContactPublicly ?? (card.showContactPublicly !== 'FALSE')) ? 'TRUE' : 'FALSE';
    const wanted = {
      'Description': String(body.description ?? card.description).trim().slice(0, 2000),
      'Emergency Info': String(body.responseInfo ?? card.responseInfo).trim().slice(0, 2000),
      'Contact Person': String(body.contactPerson ?? card.contactPerson).trim().slice(0, 200),
      'Contact Email': email,
      'Contact Phone': String(body.contactPhone ?? card.contactPhone).trim().slice(0, 50),
      'Show Contact Publicly': showPub,
      'Website URL': url(body.websiteUrl, card.websiteUrl) || '',
      'Operating Hours': String(body.operatingHours ?? card.operatingHours).trim().slice(0, 500),
      'Address': String(body.address ?? card.address).trim().slice(0, 300),
    };
    const properties = {};
    for (const [name, value] of Object.entries(wanted)) {
      const payload = typed(name, value);
      if (payload) properties[name] = payload;
    }

    const res = await fetch(`https://api.notion.com/v1/pages/${body.pageId}`, {
      method: 'PATCH', headers: nh(), body: JSON.stringify({ properties }),
    });
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`Notion responded ${res.status}: ${detail.slice(0, 200)}`);
    }
    return resp(200, { ok: true });
  } catch (err) {
    return resp(502, { error: err.message });
  }
};

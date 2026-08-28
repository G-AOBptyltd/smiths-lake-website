/**
 * service-update.js — POST /api/service-update   (admin / service steward)
 *
 * Updates a service listing's steward-editable fields in the content DB.
 * Body: { village?, pageId, description?, contactPerson?, contactEmail?,
 *         contactPhone?, showContactPublicly? (bool), websiteUrl?,
 *         facebookUrl?, operatingHours?, address? }
 *
 * Card-scoped exactly like the Volunteer hub: a steward may only edit cards
 * (paths "services/<slug>") assigned to them in the VF Stewards register;
 * admins edit any. The site is a static build, so changes go live when the
 * Publish button fires the build hook (~3 min) — saving alone updates Notion.
 * Titles are deliberately NOT editable here: a rename changes the page's URL
 * (slug) and steward card keys — that stays an admin/Notion job.
 */

import { resolveScope, scopeHasCard, rtChunks } from './_stewards.js';
import { getVillageRecord } from './_villages.js';
import { parseService } from './service-list.js';

const NOTION_VERSION = '2022-06-28';

function nh() {
  return { Authorization: `Bearer ${process.env.NOTION_API_KEY}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' };
}

function resp(statusCode, obj) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}

export const handler = async (event, context) => {
  if (event.httpMethod !== 'POST') return resp(405, { error: 'POST only' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch {
    return resp(400, { error: 'Invalid JSON' });
  }

  const village = body.village || process.env.VILLAGE_NAME || 'Smiths Lake';
  const scope = await resolveScope(context, village);
  if (!scope.ok) return resp(scope.status, { error: scope.error });
  if (!body.pageId) return resp(400, { error: 'pageId required' });

  try {
    const rec = await getVillageRecord(village);
    if (!rec.contentDbId) return resp(400, { error: "Website tools aren't enabled for " + village + ' yet' });

    // Fetch + verify the page really is a service card in THIS village's
    // content DB, and inside the caller's card scope.
    const pageRes = await fetch(`https://api.notion.com/v1/pages/${body.pageId}`, { headers: nh() });
    if (!pageRes.ok) return resp(404, { error: 'Service not found' });
    const page = await pageRes.json();
    if (page.parent?.database_id?.replace(/-/g, '') !== rec.contentDbId.replace(/-/g, '')) {
      return resp(404, { error: 'Service not found' });
    }
    const svc = parseService(page);
    if (!['Services', 'Services & Amenities'].includes(svc.section)) {
      return resp(400, { error: 'That page is not a service listing' });
    }
    if (!scopeHasCard(scope, svc.path)) return resp(403, { error: 'That service is outside your scope' });

    const email = (body.contactEmail ?? svc.contactEmail ?? '').trim().slice(0, 200);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return resp(400, { error: 'That contact email does not look valid' });
    const url = (v, cur) => {
      let s = (v ?? cur ?? '').trim().slice(0, 300);
      if (s && !/^https?:\/\//i.test(s)) s = 'https://' + s;
      return s || null;
    };

    // Property TYPES vary in hand-built content DBs (email vs text, select vs
    // checkbox) — introspect the schema and write whatever type each field is.
    const dbRes = await fetch(`https://api.notion.com/v1/databases/${rec.contentDbId}`, { headers: nh() });
    if (!dbRes.ok) throw new Error(`Notion responded ${dbRes.status} reading the content DB schema`);
    const schema = (await dbRes.json()).properties || {};
    const typed = (name, value) => {
      const t = schema[name]?.type;
      if (!t) return null; // property doesn't exist — skip silently
      const s = value == null ? '' : String(value);
      if (t === 'rich_text') return { rich_text: rtChunks(s) };
      if (t === 'email') return { email: s || null };
      if (t === 'phone_number') return { phone_number: s || null };
      if (t === 'url') return { url: s || null };
      if (t === 'select') return { select: s ? { name: s } : null };
      if (t === 'checkbox') return { checkbox: s === 'TRUE' || s === 'true' };
      return null;
    };

    const showPub = (body.showContactPublicly ?? (svc.showContactPublicly !== 'FALSE')) ? 'TRUE' : 'FALSE';
    const wanted = {
      'Description': String(body.description ?? svc.description).trim().slice(0, 2000),
      'Contact Person': String(body.contactPerson ?? svc.contactPerson).trim().slice(0, 200),
      'Contact Email': email,
      'Contact Phone': String(body.contactPhone ?? svc.contactPhone).trim().slice(0, 50),
      'Show Contact Publicly': showPub,
      'Website URL': url(body.websiteUrl, svc.websiteUrl) || '',
      'Facebook URL': url(body.facebookUrl, svc.facebookUrl) || '',
      'Operating Hours': String(body.operatingHours ?? svc.operatingHours).trim().slice(0, 500),
      'Address': String(body.address ?? svc.address).trim().slice(0, 300),
    };
    const properties = {};
    for (const [name, value] of Object.entries(wanted)) {
      const payload = typed(name, value);
      if (payload) properties[name] = payload;
    }

    // Hero image: an absolute stable URL (the Netlify-Blobs pipeline via
    // /api/news-image). Written as an EXTERNAL file on 'Hero Image File' so
    // the build-time card/page image pipeline picks it up on next publish.
    // Only set when provided — never clobbers an existing image with blank.
    if (body.imageUrl && /^https:\/\//i.test(body.imageUrl)) {
      if (schema['Hero Image File']?.type === 'files') {
        properties['Hero Image File'] = { files: [{ type: 'external', name: 'hero-image', external: { url: String(body.imageUrl).slice(0, 500) } }] };
      }
      if (schema['Image URL']?.type === 'url') {
        properties['Image URL'] = { url: String(body.imageUrl).slice(0, 500) };
      }
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

/**
 * facility-admin.js — manage the hireable-spaces register.
 *
 * GET  /api/facility-admin?village=      → { facilities }   (admin)
 * POST /api/facility-admin { village?, action, ... }        (admin)
 *   save    { pageId?, name, description?, rates?, hourlyRate?, halfDayRate?,
 *             fullDayRate?, bond?, conditions?, order? }    create or update
 *   status  { pageId, status }           Active | Inactive  (Inactive hides it
 *             from the public page; existing bookings are untouched)
 */

import { requireRole } from './_auth.js';
import {
  FACILITIES_DB_ID, notionHeaders, jsonResp, notProvisioned,
  rtChunks, queryAll, parseFacility, getFacility,
} from './_bookings.js';

const num = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : null; };

export const handler = async (event, context) => {
  if (!FACILITIES_DB_ID) return notProvisioned();

  if (event.httpMethod === 'GET') {
    const village = event.queryStringParameters?.village || process.env.VILLAGE_NAME || 'Smiths Lake';
    const auth = requireRole(context, { village, anyOf: ['admin'] });
    if (!auth.ok) return jsonResp(auth.status, { error: auth.error });
    try {
      const facilities = (await queryAll(FACILITIES_DB_ID, { property: 'Village', rich_text: { equals: village } }))
        .map(parseFacility).sort((a, b) => a.order - b.order);
      return jsonResp(200, { facilities });
    } catch (err) {
      return jsonResp(502, { error: err.message });
    }
  }

  if (event.httpMethod !== 'POST') return jsonResp(405, { error: 'GET or POST only' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch {
    return jsonResp(400, { error: 'Invalid JSON' });
  }

  const village = body.village || process.env.VILLAGE_NAME || 'Smiths Lake';
  const auth = requireRole(context, { village, anyOf: ['admin'] });
  if (!auth.ok) return jsonResp(auth.status, { error: auth.error });

  try {
    if (body.action === 'save') {
      const name = (body.name || '').trim().slice(0, 200);
      if (!name) return jsonResp(400, { error: 'The facility needs a name' });
      const properties = {
        'Facility': { title: [{ text: { content: name } }] },
        'Village': { rich_text: rtChunks(village.slice(0, 100)) },
        'Description': { rich_text: rtChunks((body.description || '').trim().slice(0, 2000)) },
        'Rates': { rich_text: rtChunks((body.rates || '').trim().slice(0, 500)) },
        'Hourly Rate': { number: num(body.hourlyRate) },
        'Half Day Rate': { number: num(body.halfDayRate) },
        'Full Day Rate': { number: num(body.fullDayRate) },
        'Bond': { number: num(body.bond) },
        'Conditions': { rich_text: rtChunks((body.conditions || '').trim().slice(0, 2000)) },
        'Order': { number: num(body.order) ?? 99 },
      };
      let res;
      if (body.pageId) {
        const existing = await getFacility(body.pageId);
        if (!existing || existing.village !== village) return jsonResp(404, { error: 'Facility not found' });
        res = await fetch(`https://api.notion.com/v1/pages/${body.pageId}`, {
          method: 'PATCH', headers: notionHeaders(), body: JSON.stringify({ properties }),
        });
      } else {
        properties['Status'] = { select: { name: 'Active' } };
        res = await fetch('https://api.notion.com/v1/pages', {
          method: 'POST', headers: notionHeaders(),
          body: JSON.stringify({ parent: { database_id: FACILITIES_DB_ID }, properties }),
        });
      }
      if (!res.ok) {
        const detail = await res.text();
        throw new Error(`Notion responded ${res.status}: ${detail.slice(0, 200)}`);
      }
      const page = await res.json();
      return jsonResp(200, { ok: true, pageId: page.id });
    }

    if (body.action === 'status') {
      if (!['Active', 'Inactive'].includes(body.status)) return jsonResp(400, { error: 'Status must be Active or Inactive' });
      const existing = await getFacility(body.pageId);
      if (!existing || existing.village !== village) return jsonResp(404, { error: 'Facility not found' });
      const res = await fetch(`https://api.notion.com/v1/pages/${body.pageId}`, {
        method: 'PATCH', headers: notionHeaders(),
        body: JSON.stringify({ properties: { 'Status': { select: { name: body.status } } } }),
      });
      if (!res.ok) throw new Error(`Notion responded ${res.status}`);
      return jsonResp(200, { ok: true });
    }

    return jsonResp(400, { error: 'Unknown action' });
  } catch (err) {
    return jsonResp(502, { error: err.message });
  }
};

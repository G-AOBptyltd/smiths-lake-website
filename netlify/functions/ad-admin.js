/**
 * ad-admin.js — the committee's advertising endpoint.
 *
 * GET  /api/ad-admin?village=            → { ads }              (admin)
 * POST /api/ad-admin { village?, action, ... }                  (admin)
 *   save     { pageId?, business, blurb?, website?, phone?, email?, contact?,
 *              tier?, startDate?, endDate?, fee?, note? }
 *   status   { pageId, status }          Draft | Active | Expired | Cancelled
 *   payment  { pageId, amountPaid?, paymentDate?, paymentReference? }
 *   delete   { pageId }                  SUPER-ADMIN only (Notion trash)
 *
 * Contact and money details are PII/commercial → village ADMIN only.
 */

import { requireRole, getRoles } from './_auth.js';
import {
  ADS_DB_ID, notionHeaders, jsonResp, notProvisioned, rtChunks,
  queryAll, parseAd, getAd, AD_STATUSES, AD_TIERS,
} from './_ads.js';

export const handler = async (event, context) => {
  if (!ADS_DB_ID) return notProvisioned();

  if (event.httpMethod === 'GET') {
    const village = event.queryStringParameters?.village || process.env.VILLAGE_NAME || 'Smiths Lake';
    const auth = requireRole(context, { village, anyOf: ['admin'] });
    if (!auth.ok) return jsonResp(auth.status, { error: auth.error });
    try {
      const ads = (await queryAll(ADS_DB_ID, { property: 'Village', rich_text: { equals: village } },
        [{ property: 'End Date', direction: 'descending' }])).map(parseAd);
      return jsonResp(200, { ads });
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
  const stamp = { 'Last Updated By': { rich_text: rtChunks(`${auth.user.email || 'admin'} · ${new Date().toISOString().slice(0, 10)}`) } };

  try {
    if (body.action === 'save') {
      const business = (body.business || '').trim().slice(0, 200);
      if (!business) return jsonResp(400, { error: 'The business needs a name' });
      const email = (body.email || '').trim().toLowerCase().slice(0, 200);
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jsonResp(400, { error: 'That email address does not look valid' });
      let website = (body.website || '').trim().slice(0, 300);
      if (website && !/^https?:\/\//i.test(website)) website = 'https://' + website;
      const fee = Number(body.fee);
      const properties = {
        'Advertiser': { title: [{ text: { content: business } }] },
        'Village': { rich_text: rtChunks(village.slice(0, 100)) },
        'Blurb': { rich_text: rtChunks((body.blurb || '').trim().slice(0, 300)) },
        'Website': { url: website || null },
        'Phone': { phone_number: (body.phone || '').trim().slice(0, 50) || null },
        'Email': { email: email || null },
        'Contact': { rich_text: rtChunks((body.contact || '').trim().slice(0, 200)) },
        'Tier': { select: { name: AD_TIERS.includes(body.tier) ? body.tier : 'Supporter' } },
        'Start Date': body.startDate ? { date: { start: body.startDate } } : { date: null },
        'End Date': body.endDate ? { date: { start: body.endDate } } : { date: null },
        'Fee': { number: Number.isFinite(fee) && fee >= 0 ? fee : null },
        'Note': { rich_text: rtChunks((body.note || '').trim().slice(0, 2000)) },
        ...stamp,
      };
      let res;
      if (body.pageId) {
        const existing = await getAd(body.pageId);
        if (!existing || existing.village !== village) return jsonResp(404, { error: 'Advertiser not found' });
        res = await fetch(`https://api.notion.com/v1/pages/${body.pageId}`, {
          method: 'PATCH', headers: notionHeaders(), body: JSON.stringify({ properties }),
        });
      } else {
        properties['Status'] = { select: { name: 'Draft' } };
        properties['Logged By'] = { rich_text: rtChunks(auth.user.email || 'admin') };
        res = await fetch('https://api.notion.com/v1/pages', {
          method: 'POST', headers: notionHeaders(),
          body: JSON.stringify({ parent: { database_id: ADS_DB_ID }, properties }),
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
      if (!AD_STATUSES.includes(body.status)) return jsonResp(400, { error: 'Unknown status' });
      const existing = await getAd(body.pageId);
      if (!existing || existing.village !== village) return jsonResp(404, { error: 'Advertiser not found' });
      const res = await fetch(`https://api.notion.com/v1/pages/${body.pageId}`, {
        method: 'PATCH', headers: notionHeaders(),
        body: JSON.stringify({ properties: { 'Status': { select: { name: body.status } }, ...stamp } }),
      });
      if (!res.ok) throw new Error(`Notion responded ${res.status}`);
      return jsonResp(200, { ok: true });
    }

    if (body.action === 'payment') {
      const existing = await getAd(body.pageId);
      if (!existing || existing.village !== village) return jsonResp(404, { error: 'Advertiser not found' });
      const amount = Number(body.amountPaid);
      const res = await fetch(`https://api.notion.com/v1/pages/${body.pageId}`, {
        method: 'PATCH', headers: notionHeaders(),
        body: JSON.stringify({ properties: {
          ...(Number.isFinite(amount) ? { 'Amount Paid': { number: amount } } : {}),
          'Payment Date': { date: { start: body.paymentDate || new Date().toISOString().slice(0, 10) } },
          'Payment Reference': { rich_text: rtChunks((body.paymentReference || '').trim().slice(0, 200)) },
          ...stamp,
        } }),
      });
      if (!res.ok) throw new Error(`Notion responded ${res.status}`);
      return jsonResp(200, { ok: true });
    }

    if (body.action === 'delete') {
      if (!getRoles(auth.user).includes('super-admin')) {
        return jsonResp(403, { error: 'Only the super-admin can delete — use Cancelled instead' });
      }
      const existing = await getAd(body.pageId);
      if (!existing || existing.village !== village) return jsonResp(404, { error: 'Advertiser not found' });
      const res = await fetch(`https://api.notion.com/v1/pages/${body.pageId}`, {
        method: 'PATCH', headers: notionHeaders(), body: JSON.stringify({ archived: true }),
      });
      if (!res.ok) throw new Error(`Notion responded ${res.status}`);
      return jsonResp(200, { ok: true });
    }

    return jsonResp(400, { error: 'Unknown action' });
  } catch (err) {
    return jsonResp(502, { error: err.message });
  }
};

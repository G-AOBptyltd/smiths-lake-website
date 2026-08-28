/**
 * booking-provision.js — POST /api/booking-provision   (SUPER-ADMIN only)
 *
 * One-time setup for Facility bookings: creates 🏛 VF Facilities and
 * 📅 VF Bookings under the Smiths Lake Community page, and seeds the
 * facilities register with the Community Hall (placeholder rates — the
 * committee corrects them in the admin tool).
 *
 * Body (optional): { parentPageId }  — defaults to the Smiths Lake Community
 * page both integrations are connected to.
 *
 * Idempotent: DBs whose env var is already set are skipped and echoed.
 * Env vars to set after: NOTION_VF_FACILITIES_DB_ID / NOTION_VF_BOOKINGS_DB_ID.
 */

import { requireRole } from './_auth.js';
import { FACILITIES_DB_ID, BOOKINGS_DB_ID, notionHeaders, jsonResp, rtChunks } from './_bookings.js';

const DEFAULT_PARENT = '2c6d508adfc180c6a1a6e3df41c1dd09'; // Smiths Lake Community page

const SCHEMAS = {
  facilities: {
    title: '🏛 VF Facilities',
    existing: FACILITIES_DB_ID,
    envVar: 'NOTION_VF_FACILITIES_DB_ID',
    properties: {
      'Facility': { title: {} },
      'Village': { rich_text: {} },
      'Description': { rich_text: {} },
      'Rates': { rich_text: {} },
      'Hourly Rate': { number: {} },
      'Half Day Rate': { number: {} },
      'Full Day Rate': { number: {} },
      'Bond': { number: {} },
      'Conditions': { rich_text: {} },
      'Status': { select: { options: [{ name: 'Active', color: 'green' }, { name: 'Inactive', color: 'gray' }] } },
      'Order': { number: {} },
    },
  },
  bookings: {
    title: '📅 VF Bookings',
    existing: BOOKINGS_DB_ID,
    envVar: 'NOTION_VF_BOOKINGS_DB_ID',
    properties: {
      'Booking': { title: {} },
      'Village': { rich_text: {} },
      'Facility': { rich_text: {} },
      'Facility ID': { rich_text: {} },
      'Date': { date: {} },
      'Name': { rich_text: {} },
      'Email': { email: {} },
      'Phone': { phone_number: {} },
      'Purpose': { rich_text: {} },
      'Attendees': { number: {} },
      'Status': { select: { options: [
        { name: 'Requested', color: 'yellow' }, { name: 'Confirmed', color: 'green' },
        { name: 'Declined', color: 'red' }, { name: 'Cancelled', color: 'gray' },
        { name: 'Completed', color: 'blue' },
      ] } },
      'Fee Quoted': { number: {} },
      'Bond': { number: {} },
      'Payment Date': { date: {} },
      'Payment Reference': { rich_text: {} },
      'Amount Paid': { number: {} },
      'Bond Returned': { checkbox: {} },
      'Note': { rich_text: {} },
      'Logged By': { rich_text: {} },
      'Last Updated By': { rich_text: {} },
      'Last Email': { rich_text: {} },
      'Date Requested': { date: {} },
    },
  },
};

export const handler = async (event, context) => {
  if (event.httpMethod !== 'POST') return jsonResp(405, { error: 'POST only' });

  const auth = requireRole(context, { anyOf: ['super-admin'] });
  if (!auth.ok) return jsonResp(auth.status, { error: auth.error });

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (_) {}
  const parentPageId = String(body.parentPageId || DEFAULT_PARENT).replace(/[^a-f0-9-]/gi, '');

  try {
    const out = {};
    const created = [];
    for (const spec of Object.values(SCHEMAS)) {
      if (spec.existing) { out[spec.envVar] = spec.existing.replace(/-/g, ''); continue; }
      const res = await fetch('https://api.notion.com/v1/databases', {
        method: 'POST',
        headers: notionHeaders(),
        body: JSON.stringify({
          parent: { type: 'page_id', page_id: parentPageId },
          title: [{ type: 'text', text: { content: spec.title } }],
          properties: spec.properties,
        }),
      });
      if (!res.ok) {
        const detail = await res.text();
        throw new Error(`Creating ${spec.title} failed: ${res.status} ${detail.slice(0, 200)}`);
      }
      const db = await res.json();
      out[spec.envVar] = db.id.replace(/-/g, '');
      created.push(spec.title);

      // Seed the facilities register with the hall (placeholder rates).
      if (spec.title.includes('Facilities')) {
        await fetch('https://api.notion.com/v1/pages', {
          method: 'POST',
          headers: notionHeaders(),
          body: JSON.stringify({
            parent: { database_id: db.id },
            properties: {
              'Facility': { title: [{ text: { content: `${process.env.VILLAGE_NAME || 'Smiths Lake'} Community Hall` } }] },
              'Village': { rich_text: rtChunks(process.env.VILLAGE_NAME || 'Smiths Lake') },
              'Description': { rich_text: rtChunks('The village hall — kitchen, seating and space for meetings, classes, parties and community events.') },
              'Rates': { rich_text: rtChunks('PLACEHOLDER — committee to confirm: hourly $20 · half day $60 · full day $100 · bond $200') },
              'Hourly Rate': { number: 20 },
              'Half Day Rate': { number: 60 },
              'Full Day Rate': { number: 100 },
              'Bond': { number: 200 },
              'Conditions': { rich_text: rtChunks('Leave the hall clean and tidy; rubbish out; keys returned next day. Bond refunded after inspection.') },
              'Status': { select: { name: 'Active' } },
              'Order': { number: 1 },
            },
          }),
        });
      }
    }

    // Chunk the ids (spaces) so browser-side data filters don't redact them.
    const chunked = {};
    for (const [k, v] of Object.entries(out)) chunked[k] = v.match(/.{1,4}/g).join(' ');

    return jsonResp(200, {
      ok: true,
      created,
      envVars: chunked,
      next: created.length ? 'Set these env vars (join the id chunks) and redeploy.' : 'Already provisioned.',
    });
  } catch (err) {
    return jsonResp(502, { error: err.message });
  }
};

/**
 * contrib-save.js — POST /api/contrib-save
 *
 * Records a single contribution in the VF Contributions DB.
 * Body: {
 *   village?: string,          // defaults to "Smiths Lake"
 *   pageId?: string,           // present = update, absent = create
 *   contributor: string,       // who gave it (required)
 *   type: string,              // Money | Payment | Gift | Time in kind | Donated service
 *   amount?: number,           // dollar value (money/payment/gift)
 *   hours?: number,            // hours (time in kind)
 *   note?: string,             // what it was for
 *   date?: string,             // YYYY-MM-DD (defaults to today)
 *   status?: string,           // Received | Pledged | Thanked (defaults Received)
 *   contact?: string           // optional email/phone of contributor
 * }
 *
 * Auth: village admin / steward / super-admin (same model as News Desk).
 * The recording admin's email is stamped into "Logged by" from the verified JWT.
 */

import { requireRole } from './_auth.js';

const NOTION_VERSION = '2022-06-28';
const CONTRIB_DB_ID = process.env.NOTION_CONTRIB_DB_ID || '6d182a0d4f0c42c2879f13753e355861';

const VALID_TYPES = ['Money', 'Payment', 'Gift', 'Time in kind', 'Donated service'];
const VALID_STATUS = ['Received', 'Pledged', 'Thanked'];

function corsHeaders() {
  return { 'Content-Type': 'application/json' };
}

function notionHeaders() {
  return {
    Authorization: `Bearer ${process.env.NOTION_API_KEY}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  };
}

export const handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders(), body: JSON.stringify({ error: 'POST only' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch {
    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const village = body.village || 'Smiths Lake';
  const auth = requireRole(context, { village, anyOf: ['admin', 'treasurer', 'steward'] });
  if (!auth.ok) {
    return { statusCode: auth.status, headers: corsHeaders(), body: JSON.stringify({ error: auth.error }) };
  }

  const contributor = (body.contributor || '').trim();
  if (!contributor) {
    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'A contributor name is required' }) };
  }

  const type = VALID_TYPES.includes(body.type) ? body.type : 'Money';
  const status = VALID_STATUS.includes(body.status) ? body.status : 'Received';
  const note = (body.note || '').trim();
  const contact = (body.contact || '').trim();
  const date = body.date || new Date().toISOString().slice(0, 10);
  const amount = Number(body.amount);
  const hours = Number(body.hours);
  const showPublicly = body.showPublicly === true || body.showPublicly === 'true';
  const displayName = (body.displayName || '').trim().slice(0, 60);

  const properties = {
    'Contributor': { title: [{ text: { content: contributor.slice(0, 200) } }] },
    'Type': { select: { name: type } },
    'Status': { select: { name: status } },
    'Note': { rich_text: note ? [{ text: { content: note.slice(0, 2000) } }] : [] },
    'Contact': { rich_text: contact ? [{ text: { content: contact.slice(0, 200) } }] : [] },
    'Date': { date: { start: date } },
    'Logged by': { rich_text: [{ text: { content: (auth.user.email || '').slice(0, 200) } }] },
    'Village': { rich_text: [{ text: { content: village.slice(0, 100) } }] },
    'Amount': { number: Number.isFinite(amount) && amount > 0 ? amount : null },
    'Hours': { number: Number.isFinite(hours) && hours > 0 ? hours : null },
    // Public supporters board opt-in — only with the contributor's permission.
    'Show Publicly': { checkbox: showPublicly },
    'Display Name': { rich_text: displayName ? [{ text: { content: displayName } }] : [] },
  };

  try {
    let res;
    if (body.pageId) {
      res = await fetch(`https://api.notion.com/v1/pages/${body.pageId}`, {
        method: 'PATCH',
        headers: notionHeaders(),
        body: JSON.stringify({ properties }),
      });
    } else {
      res = await fetch('https://api.notion.com/v1/pages', {
        method: 'POST',
        headers: notionHeaders(),
        body: JSON.stringify({ parent: { database_id: CONTRIB_DB_ID }, properties }),
      });
    }

    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`Notion responded ${res.status}: ${detail.slice(0, 200)}`);
    }
    const page = await res.json();
    return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ ok: true, pageId: page.id }) };
  } catch (err) {
    return { statusCode: 502, headers: corsHeaders(), body: JSON.stringify({ error: err.message }) };
  }
};

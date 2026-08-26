/**
 * contrib-list.js — GET /api/contrib-list?village=Smiths Lake
 *
 * Returns recent contributions plus headline totals for the portal dashboard.
 * Auth: village admin / steward / super-admin.
 *
 * Multi-village: village param filters the "Village" text column; v1 stores
 * every village in one Contributions DB. When the network grows, resolve a
 * per-village DB id from the Villages registry here (mirrors the News Desk).
 */

import { requireRole } from './_auth.js';

const NOTION_VERSION = '2022-06-28';
const CONTRIB_DB_ID = process.env.NOTION_CONTRIB_DB_ID || '6d182a0d4f0c42c2879f13753e355861';

function corsHeaders() {
  return { 'Content-Type': 'application/json' };
}

function parseItem(page) {
  const p = page.properties || {};
  return {
    id: page.id,
    contributor: p.Contributor?.title?.[0]?.plain_text || '(no name)',
    type: p.Type?.select?.name || '',
    amount: p.Amount?.number ?? null,
    hours: p.Hours?.number ?? null,
    note: (p.Note?.rich_text || []).map(t => t.plain_text).join(''),
    contact: (p.Contact?.rich_text || []).map(t => t.plain_text).join(''),
    status: p.Status?.select?.name || '',
    archived: p.Status?.select?.name === 'Archived',
    date: p.Date?.date?.start || null,
    loggedBy: (p['Logged by']?.rich_text || []).map(t => t.plain_text).join(''),
    village: (p.Village?.rich_text || []).map(t => t.plain_text).join(''),
    showPublicly: p['Show Publicly']?.checkbox === true,
    displayName: (p['Display Name']?.rich_text || []).map(t => t.plain_text).join(''),
  };
}

export const handler = async (event, context) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: corsHeaders(), body: JSON.stringify({ error: 'GET only' }) };
  }

  const village = event.queryStringParameters?.village || 'Smiths Lake';
  const auth = requireRole(context, { village, anyOf: ['admin', 'treasurer'] });
  if (!auth.ok) {
    return { statusCode: auth.status, headers: corsHeaders(), body: JSON.stringify({ error: auth.error }) };
  }

  try {
    const results = [];
    let cursor = undefined;
    do {
      const res = await fetch(`https://api.notion.com/v1/databases/${CONTRIB_DB_ID}/query`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.NOTION_API_KEY}`,
          'Notion-Version': NOTION_VERSION,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filter: { property: 'Village', rich_text: { equals: village } },
          sorts: [{ property: 'Date', direction: 'descending' }],
          page_size: 100,
          ...(cursor ? { start_cursor: cursor } : {}),
        }),
      });
      if (!res.ok) throw new Error(`Notion responded ${res.status}`);
      const data = await res.json();
      results.push(...data.results);
      cursor = data.has_more ? data.next_cursor : undefined;
    } while (cursor);

    const items = results.map(parseItem);

    // Headline totals — received money vs pledged, plus hours in kind.
    // Archived entries stay in `items` (so the Ledger can still show/restore
    // them) but are excluded from every headline total.
    const totals = { count: 0, moneyReceived: 0, moneyPledged: 0, hours: 0 };
    for (const it of items) {
      if (it.archived) continue;
      totals.count += 1;
      if (Number.isFinite(it.hours)) totals.hours += it.hours;
      if (Number.isFinite(it.amount)) {
        if (it.status === 'Pledged') totals.moneyPledged += it.amount;
        else totals.moneyReceived += it.amount;
      }
    }
    totals.moneyReceived = Math.round(totals.moneyReceived * 100) / 100;
    totals.moneyPledged = Math.round(totals.moneyPledged * 100) / 100;

    return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ items, totals }) };
  } catch (err) {
    return { statusCode: 502, headers: corsHeaders(), body: JSON.stringify({ error: err.message }) };
  }
};

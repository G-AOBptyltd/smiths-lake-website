/**
 * member-list.js — GET /api/member-list?village=Smiths Lake
 *
 * Returns the full member register for a village plus headline totals for the
 * Membership admin dashboard.
 *
 * Auth: village ADMIN / super-admin only — the register holds member PII
 * (addresses, phone numbers), so stewards and viewers are deliberately out.
 *
 * Multi-village: village param filters the "Village" text column; v1 stores
 * every village in one Members DB (mirrors the Contributions portal).
 */

import { requireRole } from './_auth.js';
import { MEMBERS_DB_ID, notionHeaders, parseMember, membershipYear } from './_members.js';

function corsHeaders() {
  return { 'Content-Type': 'application/json' };
}

export const handler = async (event, context) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: corsHeaders(), body: JSON.stringify({ error: 'GET only' }) };
  }

  const village = event.queryStringParameters?.village || 'Smiths Lake';
  const auth = requireRole(context, { village, anyOf: ['admin'] });
  if (!auth.ok) {
    return { statusCode: auth.status, headers: corsHeaders(), body: JSON.stringify({ error: auth.error }) };
  }

  try {
    const results = [];
    let cursor = undefined;
    do {
      const res = await fetch(`https://api.notion.com/v1/databases/${MEMBERS_DB_ID}/query`, {
        method: 'POST',
        headers: notionHeaders(),
        body: JSON.stringify({
          filter: { property: 'Village', rich_text: { equals: village } },
          sorts: [{ property: 'Date Applied', direction: 'descending' }],
          page_size: 100,
          ...(cursor ? { start_cursor: cursor } : {}),
        }),
      });
      if (!res.ok) throw new Error(`Notion responded ${res.status}`);
      const data = await res.json();
      results.push(...data.results);
      cursor = data.has_more ? data.next_cursor : undefined;
    } while (cursor);

    const items = results.map(parseMember);

    // Headline totals for the current membership year.
    const currentYear = membershipYear(new Date());
    const totals = { applied: 0, approved: 0, paid: 0, lapsed: 0, feesCollected: 0, rows: items.length };
    for (const it of items) {
      if (it.year !== currentYear) continue;
      if (it.status === 'Applied') totals.applied += 1;
      else if (it.status === 'Approved') totals.approved += 1;
      else if (it.status === 'Paid') {
        totals.paid += 1;
        const amount = Number.isFinite(it.amountPaid) ? it.amountPaid : it.fee;
        if (Number.isFinite(amount)) totals.feesCollected += amount;
      } else if (it.status === 'Lapsed') totals.lapsed += 1;
    }
    totals.feesCollected = Math.round(totals.feesCollected * 100) / 100;

    return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ items, totals, currentYear }) };
  } catch (err) {
    return { statusCode: 502, headers: corsHeaders(), body: JSON.stringify({ error: err.message }) };
  }
};

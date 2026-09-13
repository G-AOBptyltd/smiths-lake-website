/**
 * member-list.js — GET /api/member-list?village=Smiths Lake
 *
 * Returns the full member register for a village plus headline totals for the
 * Membership admin dashboard.
 *
 * Auth: village ADMIN / super-admin only — the register holds member PII
 * (addresses, phone numbers), so stewards and viewers are deliberately out.
 *
 * Multi-village: rows carry village_id (the tenant slug) and every query
 * filters on it. The register lives in Supabase — see _members.js.
 */

import { requireRole } from './_auth.js';
import { listMembers, membershipYear, jsonResp } from './_members.js';

export const handler = async (event, context) => {
  if (event.httpMethod !== 'GET') return jsonResp(405, { error: 'GET only' });

  const village = event.queryStringParameters?.village || process.env.VILLAGE_NAME || 'Smiths Lake';
  const auth = requireRole(context, { village, anyOf: ['admin'] });
  if (!auth.ok) return jsonResp(auth.status, { error: auth.error });

  try {
    const items = await listMembers(village);

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

    return jsonResp(200, { items, totals, currentYear });
  } catch (err) {
    return jsonResp(502, { error: err.message });
  }
};

/**
 * contrib-list.js — GET /api/contrib-list?village=Smiths Lake
 *
 * Returns the ledger (newest first) plus headline totals for the portal
 * dashboard. Auth: village admin / treasurer / super-admin.
 *
 * Archived entries are INCLUDED in `items` with archived:true — the ledger
 * shows them greyed out with a Restore button — but excluded from every
 * headline total. Pass ?archived=0 to leave them out entirely.
 *
 * Storage: Supabase (Phase 3 of the PII plan). Rows carry village_id (the
 * tenant slug) and every query filters on it — see _contrib.js.
 */

import { requireRole } from './_auth.js';
import { listContributions, jsonResp } from './_contrib.js';

export const handler = async (event, context) => {
  if (event.httpMethod !== 'GET') return jsonResp(405, { error: 'GET only' });

  const qs = event.queryStringParameters || {};
  const village = qs.village || process.env.VILLAGE_NAME || 'Smiths Lake';
  const auth = requireRole(context, { village, anyOf: ['admin', 'treasurer'] });
  if (!auth.ok) return jsonResp(auth.status, { error: auth.error });

  const includeArchived = !['0', 'false', 'no'].includes(String(qs.archived || '').toLowerCase());

  try {
    const items = await listContributions(village, { includeArchived });

    // Headline totals — received money vs pledged, plus hours in kind.
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
    totals.hours = Math.round(totals.hours * 100) / 100;

    return jsonResp(200, { items, totals });
  } catch (err) {
    return jsonResp(502, { error: err.message });
  }
};

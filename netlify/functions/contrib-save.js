/**
 * contrib-save.js — POST /api/contrib-save
 *
 * Records (or corrects) a single contribution in the ledger.
 * Body: {
 *   village?: string,          // defaults to "Smiths Lake"
 *   pageId?: string,           // present = update, absent = create (row uuid)
 *   contributor: string,       // who gave it (required)
 *   type: string,              // Money | Payment | Gift | Time in kind | Donated service
 *   amount?: number,           // dollar value (money/payment/gift)
 *   hours?: number,            // hours (time in kind)
 *   note?: string,             // what it was for
 *   date?: string,             // YYYY-MM-DD (defaults to today)
 *   status?: string,           // Received | Pledged | Thanked (defaults Received)
 *   contact?: string,          // optional email/phone of contributor
 *   showPublicly?: boolean,    // supporters-board opt-in (needs the contributor's OK)
 *   displayName?: string       // how they'd like to be thanked
 * }
 *
 * Auth: village admin / treasurer / steward / super-admin (same model as News Desk).
 * Storage: Supabase (Phase 3 of the PII plan) — see _contrib.js. The row is
 * fetched WITH the village predicate before any update, so an admin JWT from
 * one village can't touch another village's entry.
 *
 * Audit: a create stamps logged_by with the recording admin's verified JWT
 * email; an update leaves logged_by as the original recorder and stamps
 * last_updated_by instead (the Notion version overwrote "Logged by" on edit).
 */

import { requireRole } from './_auth.js';
import { requireEntitlement } from './_entitlements.js';
import {
  CONTRIB_STATUSES, contributionValues,
  getContribution, createContribution, patchContribution,
  slugVillage, jsonResp, stampBy,
} from './_contrib.js';

export const handler = async (event, context) => {
  if (event.httpMethod !== 'POST') return jsonResp(405, { error: 'POST only' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch {
    return jsonResp(400, { error: 'Invalid JSON' });
  }

  const village = body.village || process.env.VILLAGE_NAME || 'Smiths Lake';
  const auth = requireRole(context, { village, anyOf: ['admin', 'treasurer', 'steward'] });
  if (!auth.ok) return jsonResp(auth.status, { error: auth.error });
  const ent = await requireEntitlement(village, 'contrib');
  if (!ent.ok) return jsonResp(ent.status, { error: ent.error });

  const contributor = (body.contributor || '').trim();
  if (!contributor) return jsonResp(400, { error: 'A contributor name is required' });

  const status = CONTRIB_STATUSES.includes(body.status) ? body.status : 'Received';
  const values = { ...contributionValues({ ...body, contributor }), status };

  try {
    if (body.pageId) {
      const existing = await getContribution(body.pageId, village);
      if (!existing) return jsonResp(404, { error: 'Contribution not found' });
      await patchContribution(body.pageId, village, { ...values, last_updated_by: stampBy(auth.user) });
      return jsonResp(200, { ok: true, pageId: existing.id });
    }
    const id = await createContribution({
      village_id: slugVillage(village),
      ...values,
      logged_by: (auth.user.email || '').slice(0, 200),
    });
    return jsonResp(200, { ok: true, pageId: id });
  } catch (err) {
    return jsonResp(502, { error: err.message });
  }
};

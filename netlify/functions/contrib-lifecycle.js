/**
 * contrib-lifecycle.js — POST /api/contrib-lifecycle
 *
 * Archive / restore / delete for Contributions Ledger entries — mirrors the
 * News Desk lifecycle model (see news-lifecycle.js), adapted for a
 * financial-style ledger:
 *   - archive | restore  → village admin / treasurer (super passes too).
 *   - delete              → SUPER-ADMIN or VILLAGE ADMIN only, server-enforced.
 *                           Stewards cannot remove ledger entries.
 *
 * Body: { village, pageId, action }
 *   action ∈ "archive" | "restore" | "delete"
 *
 * Model (Supabase, Phase 3 of the PII plan — see _contrib.js):
 *   archive → sets archived_at. The entry stays in the Ledger list (shown
 *             greyed-out), excluded from the headline totals and from the
 *             public supporters board. Restore anytime.
 *   restore → clears archived_at. The entry's REAL status (Received /
 *             Pledged / Thanked) is untouched — the Notion version forced it
 *             back to "Received" because "Archived" was itself a status.
 *   delete  → the same soft delete, gated to admins. A hard DELETE is
 *             deliberately not offered (same rule as the member register): a
 *             ledger entry should never be unrecoverable. Restore brings it back.
 *
 * The target row is fetched WITH the village predicate before any write, so
 * an admin JWT from one village can't touch another village's entry.
 */

import { requireRole } from './_auth.js';
import {
  getContribution, archiveContribution, restoreContribution, jsonResp, stampBy,
} from './_contrib.js';

export const handler = async (event, context) => {
  if (event.httpMethod !== 'POST') return jsonResp(405, { error: 'POST only' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return jsonResp(400, { error: 'Invalid JSON' }); }

  const village = body.village || process.env.VILLAGE_NAME || 'Smiths Lake';
  const pageId = body.pageId;
  const action = body.action;
  if (!pageId) return jsonResp(400, { error: 'Missing pageId' });

  try {
    switch (action) {
      case 'archive': {
        const auth = requireRole(context, { village, anyOf: ['admin', 'treasurer'] });
        if (!auth.ok) return jsonResp(auth.status, { error: auth.error });
        const it = await getContribution(pageId, village);
        if (!it) return jsonResp(404, { error: 'Contribution not found' });
        await archiveContribution(pageId, village);
        return jsonResp(200, { ok: true, state: 'archived' });
      }

      case 'restore': {
        const auth = requireRole(context, { village, anyOf: ['admin', 'treasurer'] });
        if (!auth.ok) return jsonResp(auth.status, { error: auth.error });
        const it = await getContribution(pageId, village, { includeArchived: true });
        if (!it) return jsonResp(404, { error: 'Contribution not found' });
        if (!it.archived) return jsonResp(200, { ok: true, state: 'restored' }); // already live
        await restoreContribution(pageId, village, { last_updated_by: stampBy(auth.user) });
        return jsonResp(200, { ok: true, state: 'restored', status: it.status });
      }

      case 'delete': {
        // Super Village Admin or Village Admin only — stewards cannot remove entries.
        const auth = requireRole(context, { village, anyOf: ['admin'] });
        if (!auth.ok) return jsonResp(auth.status, { error: 'Only a Village Admin or Super Village Admin can delete a ledger entry' });
        const it = await getContribution(pageId, village, { includeArchived: true });
        if (!it) return jsonResp(404, { error: 'Contribution not found' });
        if (!it.archived) await archiveContribution(pageId, village);
        return jsonResp(200, { ok: true, state: 'deleted', note: 'Ledger entries are never hard-deleted — this entry was archived and can be restored.' });
      }

      default:
        return jsonResp(400, { error: `Unknown action: ${action}` });
    }
  } catch (err) {
    return jsonResp(502, { error: err.message });
  }
};

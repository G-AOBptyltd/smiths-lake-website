/**
 * contrib-lifecycle.js — POST /api/contrib-lifecycle
 *
 * Archive / restore / delete for Contributions Ledger entries — mirrors the
 * News Desk lifecycle model (see news-lifecycle.js), adapted for a
 * financial-style ledger:
 *   - archive | restore  → village admin / steward (super passes too) — same
 *                           gate as logging a contribution (contrib-save.js).
 *   - delete              → SUPER-ADMIN or VILLAGE ADMIN only, server-enforced.
 *                           Stewards cannot hard-delete ledger entries.
 *
 * Body: { village, pageId, action }
 *   action ∈ "archive" | "restore" | "delete"
 *
 * Model:
 *   archive → Status = "Archived". Entry stays in Notion and in the Ledger
 *             list (shown greyed-out), excluded from the headline totals.
 *             Restore anytime.
 *   restore → Status = "Received". Edit the entry afterwards if it should be
 *             Pledged or Thanked instead — we don't track the pre-archive
 *             status.
 *   delete  → archives the Notion page itself (Notion's own trash flag,
 *             recoverable from Notion) and disappears from the Ledger's
 *             Notion query immediately.
 */

import { requireRole } from './_auth.js';

const NOTION_VERSION = '2022-06-28';

function json(statusCode, obj) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}

function notionHeaders() {
  return {
    Authorization: `Bearer ${process.env.NOTION_API_KEY}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  };
}

async function patchPage(pageId, payload) {
  const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: 'PATCH',
    headers: notionHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Notion responded ${res.status}: ${detail.slice(0, 200)}`);
  }
  return res.json();
}

export const handler = async (event, context) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Invalid JSON' }); }

  const village = body.village || 'Smiths Lake';
  const pageId = body.pageId;
  const action = body.action;
  if (!pageId) return json(400, { error: 'Missing pageId' });

  try {
    switch (action) {
      case 'archive': {
        const auth = requireRole(context, { village, anyOf: ['admin', 'treasurer'] });
        if (!auth.ok) return json(auth.status, { error: auth.error });
        await patchPage(pageId, { properties: { 'Status': { select: { name: 'Archived' } } } });
        return json(200, { ok: true, state: 'archived' });
      }

      case 'restore': {
        const auth = requireRole(context, { village, anyOf: ['admin', 'treasurer'] });
        if (!auth.ok) return json(auth.status, { error: auth.error });
        await patchPage(pageId, { properties: { 'Status': { select: { name: 'Received' } } } });
        return json(200, { ok: true, state: 'restored' });
      }

      case 'delete': {
        // Super Village Admin or Village Admin only — stewards cannot hard-delete.
        const auth = requireRole(context, { village, anyOf: ['admin'] });
        if (!auth.ok) return json(auth.status, { error: 'Only a Village Admin or Super Village Admin can delete a ledger entry' });
        await patchPage(pageId, { archived: true }); // moves the page to Notion trash (recoverable)
        return json(200, { ok: true, state: 'deleted' });
      }

      default:
        return json(400, { error: `Unknown action: ${action}` });
    }
  } catch (err) {
    return json(502, { error: err.message });
  }
};

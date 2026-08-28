/**
 * cocon-lifecycle.js — POST /api/cocon-lifecycle
 *
 * Archive / restore / reorder / delete for Co-Contribution schedule & budget
 * line items. Mirrors contrib-lifecycle.js.
 *
 * Body: { village, pageId, action, order? }
 *   action ∈ "archive" | "restore" | "reorder" | "delete"
 *
 * Model:
 *   archive → Archived checkbox = true. Row stays in Notion and in the editor
 *             (greyed out), excluded from every total. Restore anytime.
 *   restore → Archived checkbox = false.
 *   reorder → sets the row's Order number (drives the "#" column ordering).
 *   delete  → archives the Notion page itself (Notion trash, recoverable).
 *
 * Auth: archive / restore / reorder → village admin / steward / super-admin.
 *       delete → VILLAGE ADMIN or SUPER-ADMIN only (stewards cannot hard-delete).
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
    method: 'PATCH', headers: notionHeaders(), body: JSON.stringify(payload),
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
        const auth = requireRole(context, { village, anyOf: ['admin', 'treasurer', 'pm'] });
        if (!auth.ok) return json(auth.status, { error: auth.error });
        await patchPage(pageId, { properties: { 'Archived': { checkbox: true } } });
        return json(200, { ok: true, state: 'archived' });
      }
      case 'restore': {
        const auth = requireRole(context, { village, anyOf: ['admin', 'treasurer', 'pm'] });
        if (!auth.ok) return json(auth.status, { error: auth.error });
        await patchPage(pageId, { properties: { 'Archived': { checkbox: false } } });
        return json(200, { ok: true, state: 'restored' });
      }
      case 'reorder': {
        const auth = requireRole(context, { village, anyOf: ['admin', 'treasurer', 'pm'] });
        if (!auth.ok) return json(auth.status, { error: auth.error });
        await patchPage(pageId, { properties: { 'Order': { number: Number(body.order) || 0 } } });
        return json(200, { ok: true, state: 'reordered' });
      }
      case 'delete': {
        const auth = requireRole(context, { village, anyOf: ['admin'] });
        if (!auth.ok) return json(auth.status, { error: 'Only a Village Admin or Super Village Admin can delete a line item' });
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

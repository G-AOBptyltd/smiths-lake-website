/**
 * news-lifecycle.js — POST /api/news-lifecycle
 *
 * Archive / restore / delete-request / delete for News Desk stories, with
 * role-based gating:
 *   - archive | restore | request-delete | cancel-request  → admin / steward (super passes too)
 *   - delete                                                → SUPER-ADMIN ONLY (server-enforced)
 *
 * Body: { village, pageId, action }
 *   action ∈ "archive" | "restore" | "request-delete" | "cancel-request" | "delete"
 *
 * Model:
 *   archive  → Status on Web = UnPublished, Show on Website = FALSE, Show in News Feed = off
 *              (story leaves the site + feed on next Publish, but stays in Notion to restore)
 *   restore  → Status on Web = Published, Show on Website = TRUE (not auto-added to the feed)
 *   request-delete → writes "Requested by <email> on <date>" into the Delete Request property
 *                    (super-admin sees the badge in the Stories list — in-app notification)
 *   cancel-request → clears Delete Request
 *   delete   → archives the Notion page (recoverable from Notion trash) and clears the request
 */

import { requireRole, getRoles } from './_auth.js';

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

  const auth = requireRole(context, { village, anyOf: ['admin', 'steward'] });
  if (!auth.ok) return json(auth.status, { error: auth.error });

  const today = new Date().toISOString().slice(0, 10);

  try {
    switch (action) {
      case 'archive':
        await patchPage(pageId, { properties: {
          'Status on Web': { select: { name: 'UnPublished' } },
          'Show on Website': { select: { name: 'FALSE' } },
          'Show in News Feed': { checkbox: false },
        } });
        return json(200, { ok: true, state: 'archived' });

      case 'restore':
        await patchPage(pageId, { properties: {
          'Status on Web': { select: { name: 'Published' } },
          'Show on Website': { select: { name: 'TRUE' } },
        } });
        return json(200, { ok: true, state: 'restored' });

      case 'request-delete': {
        const who = auth.user?.email || 'an admin';
        await patchPage(pageId, { properties: {
          'Delete Request': { rich_text: [{ text: { content: `Requested by ${who} on ${today}` } }] },
        } });
        return json(200, { ok: true, state: 'delete-requested' });
      }

      case 'cancel-request':
        await patchPage(pageId, { properties: { 'Delete Request': { rich_text: [] } } });
        return json(200, { ok: true, state: 'request-cancelled' });

      case 'delete': {
        // SUPER-ADMIN ONLY — server-side enforcement (UI also hides the button).
        if (!getRoles(auth.user).includes('super-admin')) {
          return json(403, { error: 'Only a Super Village Admin can delete a story' });
        }
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

/**
 * survey-moderate.js — POST /api/survey-moderate
 *
 * Hide/show a public comment for a moderated survey. Hidden comments are stored
 * (by exact text) in the survey's "Hidden Comments" JSON field; the public
 * results function filters them out. Admin-only.
 *
 * Body: { surveyNotionId, commentText, hidden: true|false }
 */

import { requireRole } from './_auth.js';

const NOTION_VERSION = '2022-06-28';

export const handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors() };
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  const auth = requireRole(context, { anyOf: ['admin'] });
  if (!auth.ok) return { statusCode: auth.status, headers: cors(), body: JSON.stringify({ error: auth.error }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_) { return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: 'Invalid JSON' }) }; }
  const { surveyNotionId, commentText, hidden } = body;
  if (!surveyNotionId || commentText === undefined) return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: 'Missing fields' }) };

  try {
    const pageRes = await fetch(`https://api.notion.com/v1/pages/${surveyNotionId}`, { headers: nh() });
    if (!pageRes.ok) return { statusCode: 502, headers: cors(), body: JSON.stringify({ error: 'Failed to read survey' }) };
    const page = await pageRes.json();
    let list = [];
    try { list = JSON.parse(page.properties['Hidden Comments']?.rich_text?.[0]?.plain_text || '[]'); } catch (_) {}
    if (!Array.isArray(list)) list = [];
    const set = new Set(list);
    if (hidden) set.add(commentText); else set.delete(commentText);
    const updated = JSON.stringify([...set]).slice(0, 1990);   // Notion rich_text cap

    const patch = await fetch(`https://api.notion.com/v1/pages/${surveyNotionId}`, {
      method: 'PATCH', headers: nh(),
      body: JSON.stringify({ properties: { 'Hidden Comments': { rich_text: [{ text: { content: updated } }] } } }),
    });
    if (!patch.ok) return { statusCode: 502, headers: cors(), body: JSON.stringify({ error: 'Failed to update' }) };
    return { statusCode: 200, headers: cors(), body: JSON.stringify({ success: true, hidden: !!hidden }) };
  } catch (e) {
    console.error('survey-moderate error:', e);
    return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: 'Internal error' }) };
  }
};

function nh() { return { Authorization: `Bearer ${process.env.NOTION_API_KEY}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' }; }
function cors() { return { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' }; }

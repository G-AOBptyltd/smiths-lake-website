/**
 * survey-delete.js — POST /api/survey-delete
 *
 * "Deletes" a survey by ARCHIVING its Notion record (archived: true). This is a
 * safe, recoverable delete: the row leaves the dashboard and Notion DB views but
 * stays in Notion's trash, and the survey's Google Sheet (responses) is untouched.
 *
 * Body: { surveyNotionId }
 * Auth: verified Netlify Identity token (Authorization: Bearer) + admin role.
 *
 * Response: { success: true }
 */

import { requireRole } from './_auth.js';

const NOTION_VERSION = '2022-06-28';

export const handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors() };
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  const auth = requireRole(context, { anyOf: ['admin'] });
  if (!auth.ok) return { statusCode: auth.status, headers: cors(), body: JSON.stringify({ error: auth.error }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_) {
    return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: 'Invalid JSON' }) };
  }
  const { surveyNotionId } = body;
  if (!surveyNotionId) return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: 'Missing surveyNotionId' }) };

  try {
    const res = await fetch(`https://api.notion.com/v1/pages/${surveyNotionId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${process.env.NOTION_API_KEY}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' },
      body: JSON.stringify({ archived: true }),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error('survey-delete Notion error:', err);
      return { statusCode: 502, headers: cors(), body: JSON.stringify({ error: 'Failed to delete survey' }) };
    }
    return { statusCode: 200, headers: cors(), body: JSON.stringify({ success: true }) };
  } catch (e) {
    console.error('survey-delete error:', e);
    return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: 'Internal error' }) };
  }
};

function cors() {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

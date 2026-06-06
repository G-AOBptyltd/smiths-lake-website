/**
 * survey-toggle.js — POST /api/survey-toggle
 *
 * Toggles the Active checkbox on a VF Surveys Notion record.
 * Used by the admin dashboard toggle switches.
 *
 * Body: { surveyNotionId, active: true|false }
 * Auth: verified Netlify Identity token (Authorization: Bearer) + admin role
 *
 * Response: { success: true, active: boolean }
 */

import { requireRole } from './_auth.js';

const NOTION_VERSION = '2022-06-28';

export const handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders() };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // Auth check — verified Identity token + admin role (no spoofable header)
  const auth = requireRole(context, { anyOf: ['admin'] });
  if (!auth.ok) {
    return { statusCode: auth.status, headers: corsHeaders(), body: JSON.stringify({ error: auth.error }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_) {
    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { surveyNotionId, active } = body;
  if (!surveyNotionId || active === undefined) {
    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'Missing surveyNotionId or active' }) };
  }

  try {
    const res = await fetch(`https://api.notion.com/v1/pages/${surveyNotionId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${process.env.NOTION_API_KEY}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        properties: {
          'Active': { checkbox: !!active },
        },
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('Notion PATCH error:', err);
      return { statusCode: 502, headers: corsHeaders(), body: JSON.stringify({ error: 'Failed to update Notion' }) };
    }

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({ success: true, active: !!active }),
    };
  } catch (err) {
    console.error('survey-toggle error:', err);
    return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ error: 'Internal error' }) };
  }
};

function corsHeaders() {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

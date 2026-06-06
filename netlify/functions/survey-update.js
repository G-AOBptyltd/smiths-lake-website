/**
 * survey-update.js — POST /api/survey-update
 *
 * Safe edits to an existing survey (Phase 1 / decision D4). Editable any time:
 * name, purpose, open/close dates, results visibility, eligible respondent
 * types, snapshot label, linked project, and lifecycle status. Structural
 * question changes are NOT done here — those use duplicate-and-relaunch.
 *
 * Body: { surveyNotionId, surveyName?, purpose?, openDate?, closeDate?,
 *         resultsVisibility?, respondentTypes?, snapshotLabel?,
 *         projectName?, projectNotionId?, status? }
 * Auth: verified Netlify Identity token (Authorization: Bearer) + admin role.
 *
 * Response: { success: true }
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

  const auth = requireRole(context, { anyOf: ['admin'] });
  if (!auth.ok) {
    return { statusCode: auth.status, headers: corsHeaders(), body: JSON.stringify({ error: auth.error }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_) {
    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const {
    surveyNotionId, surveyName, purpose, openDate, closeDate,
    resultsVisibility, respondentTypes, snapshotLabel,
    projectName, projectNotionId, status, commentsModerated,
  } = body;

  if (!surveyNotionId) {
    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'Missing surveyNotionId' }) };
  }

  // Build a patch containing only the safe fields that were provided.
  const properties = {};
  if (surveyName !== undefined) properties['Survey Name'] = { title: [{ text: { content: String(surveyName) } }] };
  if (purpose !== undefined) properties['Purpose'] = { rich_text: [{ text: { content: String(purpose) } }] };
  if (snapshotLabel !== undefined) properties['Snapshot Label'] = { rich_text: [{ text: { content: String(snapshotLabel) } }] };
  if (projectName !== undefined) properties['Project Name'] = { rich_text: [{ text: { content: String(projectName) } }] };
  if (projectNotionId !== undefined) properties['Project Notion ID'] = { rich_text: [{ text: { content: String(projectNotionId) } }] };
  if (resultsVisibility !== undefined) properties['Results Visibility'] = { select: { name: String(resultsVisibility) } };
  if (Array.isArray(respondentTypes)) properties['Respondent Types'] = { rich_text: [{ text: { content: JSON.stringify(respondentTypes) } }] };
  if (commentsModerated !== undefined) properties['Comments Moderated'] = { checkbox: !!commentsModerated };
  if (openDate !== undefined) properties['Open Date'] = openDate ? { date: { start: openDate } } : { date: null };
  if (closeDate !== undefined) properties['Close Date'] = closeDate ? { date: { start: closeDate } } : { date: null };
  if (status !== undefined) {
    const st = String(status).toLowerCase();
    properties['Status'] = { select: { name: st } };
    properties['Active'] = { checkbox: st === 'live' };   // keep legacy flag in sync
  }
  properties['Updated By'] = { rich_text: [{ text: { content: auth.user.email || 'admin' } }] };

  if (Object.keys(properties).length === 1) { // only Updated By
    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'No editable fields supplied' }) };
  }

  try {
    const res = await fetch(`https://api.notion.com/v1/pages/${surveyNotionId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${process.env.NOTION_API_KEY}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ properties }),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error('Notion PATCH error:', err);
      return { statusCode: 502, headers: corsHeaders(), body: JSON.stringify({ error: 'Failed to update survey' }) };
    }
    return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ success: true }) };
  } catch (err) {
    console.error('survey-update error:', err);
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

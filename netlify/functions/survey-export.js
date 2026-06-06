/**
 * survey-export.js — GET /api/survey-export?slug=[slug]
 *
 * Returns the survey's raw responses as a CSV download. Admin-only.
 */

import { requireRole } from './_auth.js';

const NOTION_VERSION = '2022-06-28';
const DB_ID = process.env.NOTION_VF_SURVEYS_DB_ID || 'dd226ceaec144baaac9fddc63a767596';

export const handler = async (event, context) => {
  if (event.httpMethod !== 'GET') return { statusCode: 405, body: 'Method Not Allowed' };

  const auth = requireRole(context, { anyOf: ['admin'] });
  if (!auth.ok) return { statusCode: auth.status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: auth.error }) };

  const slug = event.queryStringParameters?.slug;
  if (!slug) return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Missing slug' }) };

  try {
    const survey = await getSurveyBySlug(slug);
    if (!survey || !survey.sheetId) return { statusCode: 404, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Survey or sheet not found' }) };

    const sheets = await getSheets();
    if (!sheets) return { statusCode: 503, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Sheets not configured' }) };

    const res = await sheets.spreadsheets.values.get({ spreadsheetId: survey.sheetId, range: 'Sheet1!A:Z' });
    const rows = res.data.values || [];
    const csv = rows.map(r => r.map(csvCell).join(',')).join('\r\n');
    const fname = `${slug}-responses-${new Date().toISOString().slice(0, 10)}.csv`;

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${fname}"`,
        'Access-Control-Allow-Origin': '*',
      },
      body: csv,
    };
  } catch (err) {
    console.error('survey-export error:', err);
    return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Internal error' }) };
  }
};

function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function getSurveyBySlug(slug) {
  const headers = { Authorization: `Bearer ${process.env.NOTION_API_KEY}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' };
  let page = null;
  const filtered = await fetch(`https://api.notion.com/v1/databases/${DB_ID}/query`, { method: 'POST', headers, body: JSON.stringify({ filter: { property: 'Slug', rich_text: { equals: slug } } }) });
  if (filtered.ok) page = ((await filtered.json()).results || [])[0] || null;
  if (!page) {
    const all = await fetch(`https://api.notion.com/v1/databases/${DB_ID}/query`, { method: 'POST', headers, body: JSON.stringify({}) });
    if (!all.ok) return null;
    const data = await all.json();
    page = (data.results || []).find(p => (p.properties['Survey URL']?.url || '').includes(slug)) || null;
  }
  if (!page) return null;
  return { sheetId: page.properties['Sheet ID']?.rich_text?.[0]?.plain_text || '' };
}

async function getSheets() {
  const clientId = process.env.GOOGLE_CLIENT_ID, clientSecret = process.env.GOOGLE_CLIENT_SECRET, refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) return null;
  try {
    const { google } = await import('googleapis');
    const auth = new google.auth.OAuth2(clientId, clientSecret);
    auth.setCredentials({ refresh_token: refreshToken });
    return google.sheets({ version: 'v4', auth });
  } catch (e) { console.error(e); return null; }
}

/**
 * survey-health.js — GET /api/survey-health?slug=[slug]
 *
 * Lightweight, read-only health for one survey: lifecycle status, response
 * count, and whether the Google Sheet is reachable (sync state). Used by the
 * admin dashboard cards and, later, the support agent. Does NOT return any
 * response content — counts and status only.
 *
 * Response: { slug, status, responseCount, sheetOk, sheetId }
 */

const NOTION_VERSION = '2022-06-28';
const DB_ID = process.env.NOTION_VF_SURVEYS_DB_ID || 'dd226ceaec144baaac9fddc63a767596';

function notionHeaders() {
  return {
    Authorization: `Bearer ${process.env.NOTION_API_KEY}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  };
}

function slugify(str) {
  return String(str || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function effectiveStatus(s) {
  const now = new Date();
  const st = (s.status || '').toLowerCase();
  if (st === 'draft') return 'draft';
  if (st === 'paused') return 'paused';
  if (st === 'closed') return 'closed';
  const open = st === 'live' || st === 'scheduled' ? true : !!s.active;
  if (!open) return 'closed';
  if (s.openDate && new Date(s.openDate) > now) return 'scheduled';
  if (s.closeDate && new Date(s.closeDate) < now) return 'closed';
  return 'live';
}

export const handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  const slug = event.queryStringParameters?.slug;
  if (!slug) {
    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'Missing slug' }) };
  }

  try {
    const survey = await getSurveyBySlug(slug);
    if (!survey) {
      return { statusCode: 404, headers: corsHeaders(), body: JSON.stringify({ error: 'Survey not found' }) };
    }

    const status = effectiveStatus(survey);
    let responseCount = 0;
    let sheetOk = false;

    if (survey.sheetId) {
      const sheets = await getSheets();
      if (sheets) {
        try {
          const res = await sheets.spreadsheets.values.get({
            spreadsheetId: survey.sheetId,
            range: 'Sheet1!A:A',
          });
          const rows = res.data.values || [];
          responseCount = Math.max(0, rows.length - 1); // minus header
          sheetOk = true;
        } catch (e) {
          sheetOk = false; // sheet missing / permission / sync issue
        }
      }
    }

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({ slug, status, responseCount, sheetOk, sheetId: survey.sheetId || '' }),
    };
  } catch (err) {
    console.error('survey-health error:', err);
    return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ error: 'Internal error' }) };
  }
};

async function getSurveyBySlug(slug) {
  let page = null;
  const filtered = await fetch(`https://api.notion.com/v1/databases/${DB_ID}/query`, {
    method: 'POST', headers: notionHeaders(),
    body: JSON.stringify({ filter: { property: 'Slug', rich_text: { equals: slug } } }),
  });
  if (filtered.ok) page = ((await filtered.json()).results || [])[0] || null;
  if (!page) {
    const res = await fetch(`https://api.notion.com/v1/databases/${DB_ID}/query`, {
      method: 'POST', headers: notionHeaders(), body: JSON.stringify({}),
    });
    if (!res.ok) return null;
    const data = await res.json();
    page = (data.results || []).find(p => {
      const url = p.properties['Survey URL']?.url || '';
      const name = p.properties['Survey Name']?.title?.[0]?.plain_text || '';
      return url.includes(slug) || slugify(name) === slug;
    }) || null;
  }
  if (!page) return null;
  const p = page.properties;
  return {
    sheetId: p['Sheet ID']?.rich_text?.[0]?.plain_text || '',
    active: p['Active']?.checkbox || false,
    status: p['Status']?.select?.name || '',
    openDate: p['Open Date']?.date?.start || null,
    closeDate: p['Close Date']?.date?.start || null,
  };
}

async function getSheets() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) return null;
  try {
    const { google } = await import('googleapis');
    const auth = new google.auth.OAuth2(clientId, clientSecret);
    auth.setCredentials({ refresh_token: refreshToken });
    return google.sheets({ version: 'v4', auth });
  } catch (e) {
    console.error('Sheets auth failed:', e);
    return null;
  }
}

function corsHeaders() {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };
}

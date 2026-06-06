/**
 * survey-submit.js — POST /api/survey-submit
 *
 * Receives a survey response and appends it as a row to the survey's Google Sheet.
 * Rate-limited to 5 submissions per IP per hour (in-memory, resets on cold start).
 *
 * Body: { slug, respondentType, planReviewed, ...templateFields }
 *
 * Response: { success: true } | { error: '...' }
 */

// Simple in-memory rate limiter (resets on function cold start)
const rateLimitMap = new Map();
const RATE_LIMIT = 5;        // max submissions
const RATE_WINDOW = 60 * 60 * 1000; // 1 hour in ms

function isRateLimited(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip) || { count: 0, windowStart: now };
  if (now - entry.windowStart > RATE_WINDOW) {
    // New window
    rateLimitMap.set(ip, { count: 1, windowStart: now });
    return false;
  }
  if (entry.count >= RATE_LIMIT) return true;
  entry.count++;
  rateLimitMap.set(ip, entry);
  return false;
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders() };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const ip = event.headers['x-forwarded-for']?.split(',')[0] || 'unknown';
  if (isRateLimited(ip)) {
    return {
      statusCode: 429,
      headers: corsHeaders(),
      body: JSON.stringify({ error: 'Too many submissions. Please try again later.' }),
    };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (_) {
    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  // Ignore any client-supplied sheetId — never trust the browser (security).
  const { sheetId: _ignoredClientSheetId, slug, ...responseData } = body;

  if (!slug) {
    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'Missing slug' }) };
  }

  // Resolve the survey server-side from its slug: get the real sheetId + status.
  let survey;
  try {
    survey = await resolveSurvey(slug);
  } catch (e) {
    console.error('resolveSurvey error:', e);
    return { statusCode: 502, headers: corsHeaders(), body: JSON.stringify({ error: 'Could not verify survey' }) };
  }
  if (!survey) {
    return { statusCode: 404, headers: corsHeaders(), body: JSON.stringify({ error: 'Survey not found' }) };
  }
  // Re-check status + window: block submissions to draft/scheduled/paused/closed surveys.
  if (effectiveStatus(survey) !== 'active') {
    return { statusCode: 409, headers: corsHeaders(), body: JSON.stringify({ error: 'This survey is not currently open for responses.' }) };
  }
  if (!survey.sheetId) {
    return { statusCode: 503, headers: corsHeaders(), body: JSON.stringify({ error: 'Survey has no data store yet. Contact admin.' }) };
  }

  const sheetId = survey.sheetId;

  // Build the row — id, submittedAt, [template-ordered fields], then slug (isolation/audit key, trailing so it never shifts existing columns)
  const id = Date.now().toString();
  const submittedAt = new Date().toISOString();
  const row = [id, submittedAt, ...buildRowValues(responseData), slug];

  try {
    const sheets = await getSheets();
    if (!sheets) {
      // Sheets API not configured — log and return graceful error
      console.warn('Google Sheets API not configured. Set GOOGLE_SERVICE_ACCOUNT_KEY env var.');
      return {
        statusCode: 503,
        headers: corsHeaders(),
        body: JSON.stringify({ error: 'Data store not configured. Contact admin.' }),
      };
    }

    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: 'Sheet1!A:Z',
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [row] },
    });

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({ success: true, id }),
    };
  } catch (err) {
    console.error('survey-submit error:', err);
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ error: 'Failed to save response' }),
    };
  }
};

// ─── Survey resolution + status (server-side; never trust the client) ─────────

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

async function resolveSurvey(slug) {
  // Prefer an exact Slug-property match; fall back to URL/name scan for un-migrated rows.
  let page = null;
  const filtered = await fetch(`https://api.notion.com/v1/databases/${DB_ID}/query`, {
    method: 'POST',
    headers: notionHeaders(),
    body: JSON.stringify({ filter: { property: 'Slug', rich_text: { equals: slug } } }),
  });
  if (filtered.ok) {
    const data = await filtered.json();
    page = (data.results || [])[0] || null;
  }
  if (!page) {
    const all = await fetch(`https://api.notion.com/v1/databases/${DB_ID}/query`, {
      method: 'POST', headers: notionHeaders(), body: JSON.stringify({}),
    });
    if (!all.ok) return null;
    const data = await all.json();
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

// 'active' means open for responses. Explicit Status wins; else derive from Active + dates.
function effectiveStatus(s) {
  const now = new Date();
  const st = (s.status || '').toLowerCase();
  if (st === 'draft') return 'draft';
  if (st === 'paused' || st === 'closed') return 'closed';
  const open = st === 'live' || st === 'scheduled' ? true : !!s.active;
  if (!open) return 'closed';
  if (s.openDate && new Date(s.openDate) > now) return 'scheduled';
  if (s.closeDate && new Date(s.closeDate) < now) return 'closed';
  return 'active';
}

/**
 * Convert the response data object into an ordered array of values.
 * Uses template-specific column order to match the sheet header exactly.
 */
function buildRowValues(data) {
  // Auto-detect template from field names if not explicitly provided
  // This handles browser-cached versions of survey-engine.js
  let template = data.template || '';
  if (!template) {
    if (data.item1 !== undefined || data.item2 !== undefined) template = 'priority-ranking';
    else if (data.s1 !== undefined) template = 'annual-satisfaction';
    else template = 'conjoint-design-options';
  }

  // Ordered numeric keys present in the data for a given prefix (e.g. l1,l2,…)
  const numKeys = (pfx) => Object.keys(data)
    .filter(k => new RegExp(`^${pfx}\\d+$`).test(k))
    .sort((a, b) => parseInt(a.slice(pfx.length)) - parseInt(b.slice(pfx.length)));

  let fieldOrder;
  if (template === 'likert-agreement') {
    fieldOrder = ['respondentType', ...numKeys('l'), 'comment'];
  } else if (template === 'star-rating') {
    fieldOrder = ['respondentType', ...numKeys('r'), 'comment'];
  } else if (template === 'quick-poll') {
    fieldOrder = ['respondentType', 'choice'];
  } else if (template === 'open-feedback') {
    fieldOrder = ['respondentType', ...numKeys('q')];
  } else if (template === 'priority-ranking') {
    fieldOrder = [
      'respondentType',
      'item1','item2','item3','item4','item5','item6','item7','item8',
      'priorityText',
    ];
  } else if (template === 'annual-satisfaction') {
    fieldOrder = [
      'respondentType',
      's1','s2','s3','s4','s5','s6','s7','s8','s9','s10',
      'nps','priorityText','additionalComments',
    ];
  } else {
    // conjoint-design-options (default)
    fieldOrder = [
      'respondentType', 'planReviewed',
      'a1','a2','a3','a4','a5','a6','a7','a8','a9','a10',
      'b1','b2','b3',
      'c1','c2','c3','c4',
      'd1_a','d1_b','d1_c',
      'e1','e2','e3',
    ];
  }

  const used = new Set(['sheetId', 'slug', 'template']);
  const ordered = fieldOrder.map(k => {
    used.add(k);
    return data[k] !== undefined ? String(data[k]) : '';
  });

  // Append any extra fields not in known order
  Object.entries(data).forEach(([k, v]) => {
    if (!used.has(k)) ordered.push(String(v));
  });

  return ordered;
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
    console.error('Failed to init Google Sheets auth:', e);
    return null;
  }
}

function corsHeaders() {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

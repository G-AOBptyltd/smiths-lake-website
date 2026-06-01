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

  const { sheetId, ...responseData } = body;

  if (!sheetId) {
    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'Missing sheetId' }) };
  }

  // Build the row — generic approach: id, submittedAt, then all remaining fields
  const id = Date.now().toString();
  const submittedAt = new Date().toISOString();
  const row = [id, submittedAt, ...buildRowValues(responseData)];

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

  let fieldOrder;
  if (template === 'priority-ranking') {
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

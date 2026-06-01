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
 * Field order matches column layout for each template.
 */
function buildRowValues(data) {
  // Known field order based on template schema
  const knownOrder = [
    'respondentType', 'planReviewed',
    // conjoint-design-options: Part A shared features
    'a1','a2','a3','a4','a5','a6','a7','a8','a9','a10',
    // Part B key differences
    'b1','b2','b3',
    // Part C conjoint tasks
    'c1','c2','c3','c4',
    // Part D priorities
    'd1_a','d1_b','d1_c',
    // Part E overall + open text
    'e1','e2','e3',
    // priority-ranking: utility scores
    'item1','item2','item3','item4','item5','item6','item7','item8',
    // annual-satisfaction: ratings + NPS + open text
    's1','s2','s3','s4','s5','s6','s7','s8','s9','s10',
    'nps','priorityText','additionalComments',
  ];

  const used = new Set();
  const ordered = knownOrder.map(k => {
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
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!keyJson) return null;
  try {
    const { google } = await import('googleapis');
    const credentials = JSON.parse(keyJson);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
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

/**
 * survey-provision.js — POST /api/survey-provision
 *
 * Called by the admin panel when a survey is activated.
 * 1. Creates a new Google Sheet for the survey
 * 2. Sets up the header row based on template
 * 3. Writes Sheet ID back to the Notion survey record
 * 4. Writes Survey URL + Results URL back to the linked PPCA project record
 *
 * Body: { surveyNotionId, slug, template, surveyName, config }
 * Auth: requires X-Admin-Email header matching SURVEY_ADMIN_EMAILS env var
 *
 * Response: { success: true, sheetId, surveyUrl, resultsUrl }
 */

const { google } = await import('googleapis').catch(() => null);

const NOTION_VERSION = '2022-06-28';
const SITE_BASE = process.env.SITE_URL || 'https://villagefirst.org.au';

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders() };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // Auth check — admin emails
  const adminEmail = event.headers['x-admin-email'] || '';
  const allowedEmails = (process.env.SURVEY_ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase());
  if (!allowedEmails.includes(adminEmail.toLowerCase())) {
    return { statusCode: 403, headers: corsHeaders(), body: JSON.stringify({ error: 'Unauthorised' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_) {
    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { surveyNotionId, slug, template, surveyName, projectNotionId, config } = body;

  if (!surveyNotionId || !slug || !template) {
    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'Missing required fields' }) };
  }

  try {
    // 1. Create Google Sheet
    const sheetId = await createSurveySheet(surveyName || slug, template, config);
    if (!sheetId) {
      return {
        statusCode: 503,
        headers: corsHeaders(),
        body: JSON.stringify({ error: 'Google Sheets not configured. Add GOOGLE_SERVICE_ACCOUNT_KEY to Netlify env vars.' }),
      };
    }

    // 2. Build URLs
    const surveyUrl = `${SITE_BASE}/survey/?slug=${slug}`;
    const resultsUrl = `${SITE_BASE}/results/?slug=${slug}`;

    // 3. Update Notion survey record
    await updateNotionSurveyPage(surveyNotionId, { sheetId, surveyUrl, resultsUrl });

    // 4. Write URLs back to linked PPCA project (if provided)
    if (projectNotionId) {
      await updateNotionProjectPage(projectNotionId, { surveyUrl, resultsUrl });
    }

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({ success: true, sheetId, surveyUrl, resultsUrl }),
    };
  } catch (err) {
    console.error('survey-provision error:', err);
    return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ error: err.message || 'Internal error' }) };
  }
};

// ─── Google Sheets ────────────────────────────────────────────────────────────

async function createSurveySheet(surveyName, template, config) {
  const sheets = await getSheets();
  if (!sheets) return null;

  const title = `VF Survey — ${surveyName} — ${new Date().getFullYear()}`;

  // Create spreadsheet
  const createRes = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title },
      sheets: [{ properties: { title: 'Sheet1' } }],
    },
  });
  const sheetId = createRes.data.spreadsheetId;

  // Write header row based on template
  const header = buildHeader(template, config);
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: 'Sheet1!A1',
    valueInputOption: 'RAW',
    requestBody: { values: [header] },
  });

  // Make readable by anyone with link (for admin@villagefirst.org.au to access easily)
  const drive = await getDrive();
  if (drive) {
    await drive.permissions.create({
      fileId: sheetId,
      requestBody: { role: 'writer', type: 'user', emailAddress: 'admin@villagefirst.org.au' },
    }).catch(() => {}); // non-fatal
  }

  return sheetId;
}

function buildHeader(template, config) {
  const base = ['id', 'submittedAt', 'respondentType'];

  if (template === 'conjoint-design-options') {
    const sharedFeatures = config?.sharedFeatures || [];
    const attributes = config?.attributes || [];
    const conjointTasks = config?.conjointTasks || [];
    const priorityLabels = config?.priorityLabels || ['a', 'b', 'c'];

    return [
      ...base,
      'planReviewed',
      ...sharedFeatures.map((_, i) => `a${i + 1}`),
      ...attributes.map((_, i) => `b${i + 1}`),
      ...conjointTasks.map((_, i) => `c${i + 1}`),
      'd1_a', 'd1_b', 'd1_c',
      'e1', 'e2', 'e3',
    ];
  }

  if (template === 'priority-ranking') {
    const items = config?.items || [];
    return [
      ...base,
      ...items.map((_, i) => `item${i + 1}`),
      'priorityText',
    ];
  }

  if (template === 'annual-satisfaction') {
    const services = config?.serviceRatings || [];
    return [
      ...base,
      ...services.map((_, i) => `s${i + 1}`),
      'nps',
      'priorityText',
      'additionalComments',
    ];
  }

  // Generic fallback
  return [...base, 'data'];
}

// ─── Notion ───────────────────────────────────────────────────────────────────

function notionHeaders() {
  return {
    Authorization: `Bearer ${process.env.NOTION_API_KEY}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  };
}

async function updateNotionSurveyPage(pageId, { sheetId, surveyUrl, resultsUrl }) {
  await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: 'PATCH',
    headers: notionHeaders(),
    body: JSON.stringify({
      properties: {
        'Sheet ID': { rich_text: [{ text: { content: sheetId } }] },
        'Survey URL': { url: surveyUrl },
        'Results URL': { url: resultsUrl },
      },
    }),
  });
}

async function updateNotionProjectPage(pageId, { surveyUrl, resultsUrl }) {
  await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: 'PATCH',
    headers: notionHeaders(),
    body: JSON.stringify({
      properties: {
        'Survey URL': { url: surveyUrl },
        'Results URL': { url: resultsUrl },
      },
    }),
  });
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

async function getSheets() {
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!keyJson || !google) return null;
  try {
    const credentials = JSON.parse(keyJson);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive.file'],
    });
    return google.sheets({ version: 'v4', auth });
  } catch (e) { console.error(e); return null; }
}

async function getDrive() {
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!keyJson || !google) return null;
  try {
    const credentials = JSON.parse(keyJson);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/drive.file'],
    });
    return google.drive({ version: 'v3', auth });
  } catch (e) { return null; }
}

function corsHeaders() {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Email',
  };
}

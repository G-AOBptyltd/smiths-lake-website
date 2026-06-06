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
 * Auth: verified Netlify Identity token (Authorization: Bearer) + admin role
 *
 * Response: { success: true, sheetId, surveyUrl, resultsUrl }
 */

import { requireRole } from './_auth.js';

const NOTION_VERSION = '2022-06-28';
const SITE_BASE = process.env.SITE_URL || 'https://villagefirst.org.au';

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

  const {
    surveyNotionId: existingNotionId,
    slug, template, surveyName, projectNotionId, config,
    // Fields for creating a new Notion record (when no surveyNotionId provided)
    village, openDate, closeDate, respondentTypes, resultsVisibility, snapshotLabel, commentsModerated,
  } = body;

  if (!slug || !template) {
    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'Missing required fields: slug and template' }) };
  }

  try {
    // 1. Create Google Sheet
    const sheetId = await createSurveySheet(surveyName || slug, template, config || {});
    if (!sheetId) {
      return {
        statusCode: 503,
        headers: corsHeaders(),
        body: JSON.stringify({ error: 'Google Sheets not configured. Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN to Netlify env vars.' }),
      };
    }

    // 2. Build URLs
    const surveyUrl = `${SITE_BASE}/survey/?slug=${slug}`;
    const resultsUrl = `${SITE_BASE}/results/?slug=${slug}`;

    // 3. Create or update Notion survey record
    let surveyNotionId = existingNotionId;
    if (!surveyNotionId) {
      // Create new Notion record
      surveyNotionId = await createNotionSurveyRecord({
        surveyName: surveyName || slug,
        slug,
        purpose: (config && config.description) || '',
        village: village || 'Smiths Lake',
        template,
        openDate,
        closeDate,
        respondentTypes: respondentTypes || ['Village Resident', 'Property Owner', 'Regular Visitor', 'Other'],
        config: config || {},
        visibility: resultsVisibility || 'public',
        snapshotLabel: snapshotLabel || '',
        commentsModerated: !!commentsModerated,
        projectNotionId: projectNotionId || '',
        sheetId,
        surveyUrl,
        resultsUrl,
      });
    } else {
      // Update existing record
      await updateNotionSurveyPage(surveyNotionId, { sheetId, surveyUrl, resultsUrl });
    }

    // 4. Write URLs back to linked PPCA project (if provided)
    if (projectNotionId) {
      await updateNotionProjectPage(projectNotionId, { surveyUrl, resultsUrl });
    }

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({ success: true, sheetId, surveyUrl, resultsUrl, surveyNotionId }),
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

  if (template === 'likert-agreement') {
    const statements = config?.statements || config?.items || [];
    return [...base, ...statements.map((_, i) => `l${i + 1}`), 'comment'];
  }

  if (template === 'star-rating') {
    const items = config?.items || config?.serviceRatings || [];
    return [...base, ...items.map((_, i) => `r${i + 1}`), 'comment'];
  }

  if (template === 'quick-poll') {
    return [...base, 'choice'];
  }

  if (template === 'open-feedback') {
    const prompts = config?.prompts || config?.items || [];
    const cols = prompts.length ? prompts.map((_, i) => `q${i + 1}`) : ['q1'];
    return [...base, ...cols];
  }

  if (template === 'ranked-choice') {
    const items = config?.items || [];
    return [...base, ...items.map((_, i) => `rk${i + 1}`)];
  }

  if (template === 'budget-allocation') {
    const items = config?.items || [];
    return [...base, ...items.map((_, i) => `al${i + 1}`)];
  }

  if (template === 'importance-performance') {
    const items = config?.items || [];
    return [...base, ...items.map((_, i) => `imp${i + 1}`), ...items.map((_, i) => `perf${i + 1}`)];
  }

  if (template === 'demographic') {
    const fields = config?.fields || [];
    return [...base, ...fields.map((_, i) => `d${i + 1}`)];
  }

  if (template === 'multi-section') {
    return [...base, ...multiSectionColumns(config)];
  }

  // Generic fallback
  return [...base, 'data'];
}

// Deterministic per-section column order for multi-section surveys.
// Shared shape used by both survey-provision (header) and survey-submit (row order).
function multiSectionColumns(config) {
  const sections = config?.sections || [];
  const cols = [];
  sections.forEach((sec, si) => {
    const idx = si + 1;
    const c = sec.config || {};
    const t = sec.template;
    if (t === 'likert-agreement') { (c.statements || c.items || []).forEach((_, i) => cols.push(`s${idx}_l${i + 1}`)); cols.push(`s${idx}_comment`); }
    else if (t === 'star-rating') { (c.items || c.serviceRatings || []).forEach((_, i) => cols.push(`s${idx}_r${i + 1}`)); cols.push(`s${idx}_comment`); }
    else if (t === 'quick-poll') { cols.push(`s${idx}_choice`); }
    else if (t === 'open-feedback') { const pr = c.prompts || c.items || []; (pr.length ? pr : ['x']).forEach((_, i) => cols.push(`s${idx}_q${i + 1}`)); }
    else if (t === 'ranked-choice') { (c.items || []).forEach((_, i) => cols.push(`s${idx}_rk${i + 1}`)); }
    else if (t === 'budget-allocation') { (c.items || []).forEach((_, i) => cols.push(`s${idx}_al${i + 1}`)); }
    else if (t === 'importance-performance') { (c.items || []).forEach((_, i) => cols.push(`s${idx}_imp${i + 1}`)); (c.items || []).forEach((_, i) => cols.push(`s${idx}_perf${i + 1}`)); }
    else if (t === 'demographic') { (c.fields || []).forEach((_, i) => cols.push(`s${idx}_d${i + 1}`)); }
  });
  return cols;
}

// ─── Notion ───────────────────────────────────────────────────────────────────

async function createNotionSurveyRecord({ surveyName, slug, purpose, village, template, openDate, closeDate, respondentTypes, config, visibility, snapshotLabel, commentsModerated, projectNotionId, sheetId, surveyUrl, resultsUrl }) {
  const DB_ID = process.env.NOTION_VF_SURVEYS_DB_ID || 'dd226ceaec144baaac9fddc63a767596';
  // NOTE: Slug, Status and Purpose require the Phase 0 schema migration to exist
  // on the VF Surveys DB before this runs in production.
  const properties = {
    'Survey Name': { title: [{ text: { content: surveyName } }] },
    'Slug': { rich_text: [{ text: { content: slug || '' } }] },
    'Status': { select: { name: 'live' } },
    'Purpose': { rich_text: [{ text: { content: purpose || '' } }] },
    'Village': { select: { name: village } },
    'Template': { select: { name: template } },
    'Active': { checkbox: true },
    'Results Visibility': { select: { name: visibility || 'public' } },
    'Comments Moderated': { checkbox: !!commentsModerated },
    'Respondent Types': { rich_text: [{ text: { content: JSON.stringify(respondentTypes) } }] },
    'Config': { rich_text: [{ text: { content: JSON.stringify(config) } }] },
    'Snapshot Label': { rich_text: [{ text: { content: snapshotLabel || '' } }] },
    'Sheet ID': { rich_text: [{ text: { content: sheetId } }] },
    'Survey URL': { url: surveyUrl },
    'Results URL': { url: resultsUrl },
  };
  if (openDate) properties['Open Date'] = { date: { start: openDate } };
  if (closeDate) properties['Close Date'] = { date: { start: closeDate } };
  if (projectNotionId) properties['Project Notion ID'] = { rich_text: [{ text: { content: projectNotionId } }] };

  const res = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: notionHeaders(),
    body: JSON.stringify({ parent: { database_id: DB_ID }, properties }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to create Notion record: ${err}`);
  }
  const page = await res.json();
  return page.id;
}

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

async function getOAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) return null;
  try {
    const { google } = await import('googleapis');
    const auth = new google.auth.OAuth2(clientId, clientSecret);
    auth.setCredentials({ refresh_token: refreshToken });
    return { google, auth };
  } catch (e) { console.error(e); return null; }
}

async function getSheets() {
  const client = await getOAuthClient();
  if (!client) return null;
  return client.google.sheets({ version: 'v4', auth: client.auth });
}

async function getDrive() {
  const client = await getOAuthClient();
  if (!client) return null;
  return client.google.drive({ version: 'v3', auth: client.auth });
}

function corsHeaders() {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

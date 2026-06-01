/**
 * VillageFirst Survey Platform — Notion Client
 * Reads and writes survey config from the VF Surveys Notion database.
 *
 * DB: VF Surveys (dd226ceaec144baaac9fddc63a767596)
 * Data Source: collection://dbc81fce-7935-49cd-b9e2-cb051bbba29c
 *
 * Used by Netlify Functions (process.env) — NOT Astro build-time (import.meta.env).
 */

const NOTION_VERSION = '2022-06-28';

function notionHeaders() {
  return {
    Authorization: `Bearer ${process.env.NOTION_API_KEY}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  };
}

const DB_ID = process.env.NOTION_VF_SURVEYS_DB_ID || 'dd226ceaec144baaac9fddc63a767596';

// ─── READ ────────────────────────────────────────────────────────────────────

/**
 * Fetch a single active survey config by slug (Survey URL ends with slug).
 * Returns null if no active survey found for that slug.
 */
export async function getSurveyBySlug(slug) {
  const res = await fetch(`https://api.notion.com/v1/databases/${DB_ID}/query`, {
    method: 'POST',
    headers: notionHeaders(),
    body: JSON.stringify({
      filter: {
        and: [
          { property: 'Active', checkbox: { equals: true } },
        ],
      },
    }),
  });
  if (!res.ok) return null;
  const data = await res.json();

  const page = data.results.find(p => {
    const surveyUrl = p.properties['Survey URL']?.url || '';
    return surveyUrl.includes(slug);
  });

  return page ? parseSurveyPage(page) : null;
}

/**
 * Fetch ALL surveys for a village (for the admin dashboard).
 */
export async function getSurveysByVillage(village) {
  const res = await fetch(`https://api.notion.com/v1/databases/${DB_ID}/query`, {
    method: 'POST',
    headers: notionHeaders(),
    body: JSON.stringify({
      filter: {
        property: 'Village',
        select: { equals: village },
      },
      sorts: [{ timestamp: 'created_time', direction: 'descending' }],
    }),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.results.map(parseSurveyPage);
}

/**
 * Fetch a survey page by its Notion page ID directly.
 */
export async function getSurveyById(pageId) {
  const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    headers: notionHeaders(),
  });
  if (!res.ok) return null;
  const page = await res.json();
  return parseSurveyPage(page);
}

// ─── WRITE ───────────────────────────────────────────────────────────────────

/**
 * Update Survey URL, Results URL, and Sheet ID on a survey page after provisioning.
 */
export async function updateSurveyUrls(pageId, { surveyUrl, resultsUrl, sheetId }) {
  const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: 'PATCH',
    headers: notionHeaders(),
    body: JSON.stringify({
      properties: {
        'Survey URL': { url: surveyUrl },
        'Results URL': { url: resultsUrl },
        'Sheet ID': { rich_text: [{ text: { content: sheetId } }] },
      },
    }),
  });
  return res.ok;
}

/**
 * Write Survey URL back to the linked PPCA project record.
 * Uses the Project Notion ID field on the survey to find the project page.
 */
export async function writeUrlToProject(projectNotionId, surveyUrl, resultsUrl) {
  if (!projectNotionId) return false;
  const res = await fetch(`https://api.notion.com/v1/pages/${projectNotionId}`, {
    method: 'PATCH',
    headers: notionHeaders(),
    body: JSON.stringify({
      properties: {
        'Survey URL': { url: surveyUrl },
        'Results URL': { url: resultsUrl },
      },
    }),
  });
  return res.ok;
}

// ─── PARSE ───────────────────────────────────────────────────────────────────

function parseSurveyPage(page) {
  const p = page.properties;

  // Parse respondent types (stored as JSON string)
  let respondentTypes = ['Village Resident', 'Property Owner', 'Regular Visitor', 'Other'];
  try {
    const raw = p['Respondent Types']?.rich_text?.[0]?.plain_text || '';
    if (raw) respondentTypes = JSON.parse(raw);
  } catch (_) {}

  // Parse config blob (template-specific JSON)
  let config = {};
  try {
    const raw = p['Config']?.rich_text?.[0]?.plain_text || '';
    if (raw) config = JSON.parse(raw);
  } catch (_) {}

  return {
    id: page.id,
    surveyName: p['Survey Name']?.title?.[0]?.plain_text || 'Untitled Survey',
    village: p['Village']?.select?.name || '',
    template: p['Template']?.select?.name || '',
    active: p['Active']?.checkbox || false,
    openDate: p['Open Date']?.date?.start || null,
    closeDate: p['Close Date']?.date?.start || null,
    projectName: p['Project Name']?.rich_text?.[0]?.plain_text || '',
    projectNotionId: p['Project Notion ID']?.rich_text?.[0]?.plain_text || '',
    sheetId: p['Sheet ID']?.rich_text?.[0]?.plain_text || '',
    surveyUrl: p['Survey URL']?.url || '',
    resultsUrl: p['Results URL']?.url || '',
    snapshotLabel: p['Snapshot Label']?.rich_text?.[0]?.plain_text || '',
    resultsVisibility: p['Results Visibility']?.select?.name || 'public',
    respondentTypes,
    config,
  };
}

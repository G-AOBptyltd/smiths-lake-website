/**
 * survey-config.js — GET /api/survey-config?slug=[slug]
 *
 * Returns the survey definition for a given slug.
 * The survey engine calls this on page load to know what to render.
 *
 * Response shape:
 *   { survey: {...}, status: 'active' | 'closed' | 'scheduled' | 'not-found' }
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

export const handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const slug = event.queryStringParameters?.slug;
  if (!slug) {
    return {
      statusCode: 400,
      headers: corsHeaders(),
      body: JSON.stringify({ error: 'Missing slug parameter' }),
    };
  }

  try {
    // Query all surveys matching this slug in Survey URL
    const res = await fetch(`https://api.notion.com/v1/databases/${DB_ID}/query`, {
      method: 'POST',
      headers: notionHeaders(),
      body: JSON.stringify({}), // fetch all, filter client-side on slug
    });

    if (!res.ok) {
      console.error('Notion API error:', res.status);
      return {
        statusCode: 502,
        headers: corsHeaders(),
        body: JSON.stringify({ error: 'Failed to load survey config' }),
      };
    }

    const data = await res.json();

    // Find the survey whose URL contains this slug
    const page = data.results.find(p => {
      const url = p.properties['Survey URL']?.url || '';
      const name = p.properties['Survey Name']?.title?.[0]?.plain_text || '';
      // Match on slug in URL, or slugified survey name as fallback
      return url.includes(slug) || slugify(name) === slug;
    });

    if (!page) {
      return {
        statusCode: 404,
        headers: corsHeaders(),
        body: JSON.stringify({ status: 'not-found' }),
      };
    }

    const survey = parseSurveyPage(page);
    const status = getSurveyStatus(survey);

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({ survey, status }),
    };
  } catch (err) {
    console.error('survey-config error:', err);
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ error: 'Internal error' }),
    };
  }
};

function getSurveyStatus(survey) {
  const now = new Date();
  if (!survey.active) return 'closed';
  if (survey.openDate && new Date(survey.openDate) > now) return 'scheduled';
  if (survey.closeDate && new Date(survey.closeDate) < now) return 'closed';
  return 'active';
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function parseSurveyPage(page) {
  const p = page.properties;
  let respondentTypes = ['Village Resident', 'Property Owner', 'Regular Visitor', 'Other'];
  try {
    const raw = p['Respondent Types']?.rich_text?.[0]?.plain_text || '';
    if (raw) respondentTypes = JSON.parse(raw);
  } catch (_) {}
  let config = {};
  try {
    const raw = p['Config']?.rich_text?.[0]?.plain_text || '';
    if (raw) config = JSON.parse(raw);
  } catch (_) {}

  return {
    id: page.id,
    surveyName: p['Survey Name']?.title?.[0]?.plain_text || 'Community Survey',
    village: p['Village']?.select?.name || '',
    template: p['Template']?.select?.name || '',
    active: p['Active']?.checkbox || false,
    openDate: p['Open Date']?.date?.start || null,
    closeDate: p['Close Date']?.date?.start || null,
    projectName: p['Project Name']?.rich_text?.[0]?.plain_text || '',
    sheetId: p['Sheet ID']?.rich_text?.[0]?.plain_text || '',
    surveyUrl: p['Survey URL']?.url || '',
    resultsUrl: p['Results URL']?.url || '',
    snapshotLabel: p['Snapshot Label']?.rich_text?.[0]?.plain_text || '',
    resultsVisibility: p['Results Visibility']?.select?.name || 'public',
    respondentTypes,
    config,
  };
}

function corsHeaders() {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };
}

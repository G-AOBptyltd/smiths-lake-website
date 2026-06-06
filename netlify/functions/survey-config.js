/**
 * survey-config.js — GET /api/survey-config?slug=[slug]
 *
 * Returns the survey definition for a given slug.
 * The survey engine calls this on page load to know what to render.
 *
 * Response shape:
 *   { survey: {...}, status: 'active' | 'closed' | 'scheduled' | 'not-found' }
 */

import { getVillageStatus } from './_villages.js';

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
    // Prefer an exact Slug-property match (fast, collision-safe); fall back to a
    // full scan by URL/name for rows not yet migrated to the Slug property.
    let page = null;
    const filtered = await fetch(`https://api.notion.com/v1/databases/${DB_ID}/query`, {
      method: 'POST',
      headers: notionHeaders(),
      body: JSON.stringify({ filter: { property: 'Slug', rich_text: { equals: slug } } }),
    });
    if (filtered.ok) {
      const fdata = await filtered.json();
      page = (fdata.results || [])[0] || null;
    }

    if (!page) {
      const res = await fetch(`https://api.notion.com/v1/databases/${DB_ID}/query`, {
        method: 'POST',
        headers: notionHeaders(),
        body: JSON.stringify({}),
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
      page = data.results.find(p => {
        const url = p.properties['Survey URL']?.url || '';
        const name = p.properties['Survey Name']?.title?.[0]?.plain_text || '';
        return url.includes(slug) || slugify(name) === slug;
      });
    }

    if (!page) {
      return {
        statusCode: 404,
        headers: corsHeaders(),
        body: JSON.stringify({ status: 'not-found' }),
      };
    }

    const survey = parseSurveyPage(page);
    let status = getSurveyStatus(survey);

    // Village override gate: a suspended/archived village closes its surveys to the public.
    const vStatus = await getVillageStatus(survey.village);
    if (vStatus === 'suspended' || vStatus === 'archived') status = 'closed';

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
  const st = (survey.status || '').toLowerCase();
  if (st === 'draft') return 'scheduled';        // not publicly open; show "not yet" page
  if (st === 'paused' || st === 'closed') return 'closed';
  const open = st === 'live' || st === 'scheduled' ? true : !!survey.active;
  if (!open) return 'closed';
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
    status: p['Status']?.select?.name || '',
    slug: p['Slug']?.rich_text?.[0]?.plain_text || '',
    purpose: p['Purpose']?.rich_text?.[0]?.plain_text || '',
    commentsModerated: p['Comments Moderated']?.checkbox || false,
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

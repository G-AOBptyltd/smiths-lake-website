/**
 * survey-list.js — GET /api/survey-list?village=Smiths Lake
 *
 * Returns all surveys in the VF Surveys Notion DB for a given village.
 * Used by the admin dashboard to populate the survey list dynamically.
 *
 * Response: { surveys: [...] }
 */

const NOTION_VERSION = '2022-06-28';
const DB_ID = process.env.NOTION_VF_SURVEYS_DB_ID || 'dd226ceaec144baaac9fddc63a767596';

export const handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const village = event.queryStringParameters?.village || 'Smiths Lake';

  try {
    const res = await fetch(`https://api.notion.com/v1/databases/${DB_ID}/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.NOTION_API_KEY}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        filter: {
          property: 'Village',
          select: { equals: village },
        },
        sorts: [{ timestamp: 'created_time', direction: 'descending' }],
      }),
    });

    if (!res.ok) {
      return {
        statusCode: 502,
        headers: corsHeaders(),
        body: JSON.stringify({ error: 'Failed to load surveys from Notion' }),
      };
    }

    const data = await res.json();
    const surveys = data.results.map(parsePage);

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({ surveys }),
    };
  } catch (err) {
    console.error('survey-list error:', err);
    return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ error: 'Internal error' }) };
  }
};

function parsePage(page) {
  const p = page.properties;
  return {
    id: page.id,
    surveyName: p['Survey Name']?.title?.[0]?.plain_text || 'Untitled',
    village: p['Village']?.select?.name || '',
    template: p['Template']?.select?.name || '',
    active: p['Active']?.checkbox || false,
    status: p['Status']?.select?.name || '',
    openDate: p['Open Date']?.date?.start || null,
    closeDate: p['Close Date']?.date?.start || null,
    surveyUrl: p['Survey URL']?.url || '',
    resultsUrl: p['Results URL']?.url || '',
    sheetId: p['Sheet ID']?.rich_text?.[0]?.plain_text || '',
    snapshotLabel: p['Snapshot Label']?.rich_text?.[0]?.plain_text || '',
  };
}

function corsHeaders() {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };
}

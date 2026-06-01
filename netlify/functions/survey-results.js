/**
 * survey-results.js — GET /api/survey-results?slug=[slug]
 *
 * Reads all responses from the survey's Google Sheet and returns
 * aggregated results based on the template type.
 *
 * Response shape (conjoint-design-options):
 *   { count, template, respondentBreakdown, partA, partB, conjoint, partD, overall, openText }
 *
 * Response shape (priority-ranking):
 *   { count, template, respondentBreakdown, utilityScores, openText }
 *
 * Response shape (annual-satisfaction):
 *   { count, template, respondentBreakdown, serviceRatings, nps, openText }
 */

const NOTION_VERSION = '2022-06-28';
const DB_ID = process.env.NOTION_VF_SURVEYS_DB_ID || 'dd226ceaec144baaac9fddc63a767596';

export const handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const slug = event.queryStringParameters?.slug;
  if (!slug) {
    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'Missing slug' }) };
  }

  try {
    // 1. Get survey config from Notion
    const survey = await getSurveyBySlug(slug);
    if (!survey) {
      return { statusCode: 404, headers: corsHeaders(), body: JSON.stringify({ error: 'Survey not found' }) };
    }

    if (!survey.sheetId) {
      return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ count: 0, template: survey.template, survey }) };
    }

    // 2. Fetch rows from Google Sheet
    const sheets = await getSheets();
    if (!sheets) {
      return {
        statusCode: 200,
        headers: corsHeaders(),
        body: JSON.stringify({ count: 0, template: survey.template, survey, error: 'Results store not configured' }),
      };
    }

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: survey.sheetId,
      range: 'Sheet1!A:Z',
    });

    const rows = res.data.values || [];
    if (rows.length <= 1) {
      // Only header row or empty
      return {
        statusCode: 200,
        headers: corsHeaders(),
        body: JSON.stringify({ count: 0, template: survey.template, survey }),
      };
    }

    const header = rows[0];
    const dataRows = rows.slice(1);

    // 3. Aggregate based on template
    const aggregated = aggregate(dataRows, header, survey.template, survey.config);

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({ ...aggregated, template: survey.template, survey }),
    };
  } catch (err) {
    console.error('survey-results error:', err);
    return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ error: 'Internal error' }) };
  }
};

function aggregate(rows, header, template, config) {
  const count = rows.length;

  // Respondent breakdown (always)
  const respondentBreakdown = {};
  const rtIdx = header.indexOf('respondentType');
  rows.forEach(row => {
    const rt = row[rtIdx] || 'Unknown';
    respondentBreakdown[rt] = (respondentBreakdown[rt] || 0) + 1;
  });

  if (template === 'conjoint-design-options') {
    return aggregateConjoint(rows, header, count, respondentBreakdown, config);
  } else if (template === 'priority-ranking') {
    return aggregateMaxDiff(rows, header, count, respondentBreakdown, config);
  } else if (template === 'annual-satisfaction') {
    return aggregateSatisfaction(rows, header, count, respondentBreakdown, config);
  }

  return { count, respondentBreakdown, raw: rows.slice(0, 5) };
}

function aggregateConjoint(rows, header, count, respondentBreakdown, config) {
  const getCol = (name) => header.indexOf(name);

  // Part A — shared feature ratings (a1–a10)
  const sharedFeatures = config.sharedFeatures || [];
  const partA = sharedFeatures.map((label, i) => {
    const col = getCol(`a${i + 1}`);
    const ratings = rows.map(r => Number(r[col])).filter(v => !isNaN(v) && v > 0);
    const avg = ratings.length ? ratings.reduce((s, v) => s + v, 0) / ratings.length : 0;
    return { label, avg: Math.round(avg * 100) / 100, n: ratings.length };
  });

  // Part B — key differences importance (b1–b3)
  const attributes = config.attributes || [];
  const partB = attributes.map((attr, i) => {
    const col = getCol(`b${i + 1}`);
    const ratings = rows.map(r => Number(r[col])).filter(v => !isNaN(v) && v > 0);
    const avg = ratings.length ? ratings.reduce((s, v) => s + v, 0) / ratings.length : 0;
    return { label: attr.label, avg: Math.round(avg * 100) / 100, n: ratings.length };
  });

  // Part C — conjoint tasks (c1–c4: x or y choice)
  const tasks = config.conjointTasks || [];
  const conjoint = tasks.map((task, i) => {
    const col = getCol(`c${i + 1}`);
    const responses = rows.map(r => r[col]).filter(Boolean);
    const xCount = responses.filter(v => v === 'x').length;
    const yCount = responses.filter(v => v === 'y').length;
    const n = xCount + yCount;
    return {
      task: task.label || `Task ${i + 1}`,
      option1: task.option1Label || 'Option 1',
      option2: task.option2Label || 'Option 2',
      option1Count: xCount,
      option2Count: yCount,
      option1Pct: n ? Math.round((xCount / n) * 100) : 0,
      option2Pct: n ? Math.round((yCount / n) * 100) : 0,
      n,
    };
  });

  // Part D — priority allocation (d1_a, d1_b, d1_c)
  const priorityLabels = config.priorityLabels || ['Option A', 'Option B', 'Option C'];
  const partD = priorityLabels.map((label, i) => {
    const keys = ['d1_a', 'd1_b', 'd1_c'];
    const col = getCol(keys[i]);
    const vals = rows.map(r => Number(r[col])).filter(v => !isNaN(v));
    const avg = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
    return { label, avg: Math.round(avg) };
  });

  // Part E — overall preference (e1 = a/b/c/hybrid)
  const e1Col = getCol('e1');
  const overallCounts = {};
  rows.forEach(r => {
    const v = r[e1Col];
    if (v) overallCounts[v] = (overallCounts[v] || 0) + 1;
  });

  // Open text (e2, e3)
  const e2Col = getCol('e2');
  const e3Col = getCol('e3');
  const openText = rows
    .map((r, i) => ({
      person: `Person ${i + 1}`,
      comments: r[e2Col] || '',
      additionalComments: r[e3Col] || '',
    }))
    .filter(r => r.comments || r.additionalComments);

  return { count, respondentBreakdown, partA, partB, conjoint, partD, overall: overallCounts, openText };
}

function aggregateMaxDiff(rows, header, count, respondentBreakdown, config) {
  const items = config.items || [];

  // Score each item: +1 for each "best" selection, -1 for each "worst"
  const scores = {};
  items.forEach((item, i) => {
    const key = `item${i + 1}`;
    scores[key] = { label: item.label || item, best: 0, worst: 0, total: 0 };
  });

  rows.forEach(row => {
    items.forEach((_, i) => {
      const key = `item${i + 1}`;
      const idx = header.indexOf(key);
      if (idx === -1) return;
      const val = row[idx];
      if (val === 'best') { scores[key].best++; scores[key].total++; }
      if (val === 'worst') { scores[key].worst++; scores[key].total--; }
    });
  });

  // Convert to utility scores (best% - worst% relative to n)
  const utilityScores = Object.entries(scores).map(([, s]) => ({
    label: s.label,
    bestCount: s.best,
    worstCount: s.worst,
    utilityScore: count > 0 ? Math.round(((s.best - s.worst) / count) * 100) : 0,
    bestPct: count > 0 ? Math.round((s.best / count) * 100) : 0,
  })).sort((a, b) => b.utilityScore - a.utilityScore);

  // Open text
  const textCol = header.indexOf('priorityText');
  const openText = rows
    .map((r, i) => ({ person: `Person ${i + 1}`, text: r[textCol] || '' }))
    .filter(r => r.text);

  return { count, respondentBreakdown, utilityScores, openText };
}

function aggregateSatisfaction(rows, header, count, respondentBreakdown, config) {
  const services = config.serviceRatings || [];

  const serviceRatings = services.map((label, i) => {
    const col = header.indexOf(`s${i + 1}`);
    const ratings = rows.map(r => Number(r[col])).filter(v => !isNaN(v) && v > 0);
    const avg = ratings.length ? ratings.reduce((s, v) => s + v, 0) / ratings.length : 0;
    return { label, avg: Math.round(avg * 100) / 100, n: ratings.length };
  });

  const npsCol = header.indexOf('nps');
  const npsScores = rows.map(r => Number(r[npsCol])).filter(v => !isNaN(v) && v >= 0 && v <= 10);
  const promoters = npsScores.filter(v => v >= 9).length;
  const detractors = npsScores.filter(v => v <= 6).length;
  const nps = npsScores.length ? Math.round(((promoters - detractors) / npsScores.length) * 100) : null;

  const textCol = header.indexOf('priorityText');
  const openText = rows
    .map((r, i) => ({ person: `Person ${i + 1}`, text: r[textCol] || '' }))
    .filter(r => r.text);

  return { count, respondentBreakdown, serviceRatings, nps, npsCount: npsScores.length, openText };
}

async function getSurveyBySlug(slug) {
  const res = await fetch(`https://api.notion.com/v1/databases/${DB_ID}/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.NOTION_API_KEY}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });
  if (!res.ok) return null;
  const data = await res.json();

  const page = data.results.find(p => {
    const url = p.properties['Survey URL']?.url || '';
    const name = p.properties['Survey Name']?.title?.[0]?.plain_text || '';
    return url.includes(slug) || slugify(name) === slug;
  });
  if (!page) return null;

  const p = page.properties;
  let config = {};
  try { config = JSON.parse(p['Config']?.rich_text?.[0]?.plain_text || '{}'); } catch (_) {}

  return {
    id: page.id,
    template: p['Template']?.select?.name || '',
    sheetId: p['Sheet ID']?.rich_text?.[0]?.plain_text || '',
    surveyName: p['Survey Name']?.title?.[0]?.plain_text || '',
    snapshotLabel: p['Snapshot Label']?.rich_text?.[0]?.plain_text || '',
    resultsVisibility: p['Results Visibility']?.select?.name || 'public',
    config,
  };
}

async function getSheets() {
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!keyJson) return null;
  try {
    const { google } = await import('googleapis');
    const credentials = JSON.parse(keyJson);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    return google.sheets({ version: 'v4', auth });
  } catch (e) {
    console.error('Failed to init Google Sheets auth:', e);
    return null;
  }
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function corsHeaders() {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };
}

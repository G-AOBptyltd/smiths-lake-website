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

import { getIdentityUser, hasRole } from './_auth.js';
import { getVillageStatus } from './_villages.js';

const NOTION_VERSION = '2022-06-28';
const DB_ID = process.env.NOTION_VF_SURVEYS_DB_ID || 'dd226ceaec144baaac9fddc63a767596';

export const handler = async (event, context) => {
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

    // 1b. Enforce per-survey results visibility (the v1.0 gap).
    const user = getIdentityUser(context);
    const isStaff = hasRole(user, { village: survey.village, anyOf: ['admin', 'steward', 'viewer'] });
    const vis = (survey.resultsVisibility || 'public').toLowerCase();
    const status = effectiveStatus(survey);
    const justCompleted = event.queryStringParameters?.completed === '1';
    let allowed = false;
    if (isStaff) allowed = true;                                   // admins/committee always
    else if (vis === 'public') allowed = true;                     // open to everyone
    else if (vis === 'after-close') allowed = status === 'closed'; // public only once closed
    else if (vis === 'respondent-after-completion') allowed = justCompleted; // shown right after submitting
    // 'committee' / 'committee-only' / 'admin' → not public
    // Archived village removes public access to its results (super-admin still allowed).
    if (!isStaff && (await getVillageStatus(survey.village)) === 'archived') allowed = false;
    if (!allowed) {
      return {
        statusCode: 200,
        headers: corsHeaders(),
        body: JSON.stringify({
          restricted: true,
          visibility: vis,
          status,
          message: vis === 'after-close'
            ? 'Results will be published when this survey closes.'
            : 'Results for this survey are not publicly available.',
        }),
      };
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

    // 3b. Comment moderation — for the public (non-staff), drop hidden comments (by text).
    if (!isStaff && survey.commentsModerated) {
      const hidden = new Set(survey.hiddenComments || []);
      const strip = arr => (arr || []).filter(o => !hidden.has(o.text || o.comments || ''));
      if (aggregated.openText) aggregated.openText = strip(aggregated.openText);
      if (aggregated.sections) aggregated.sections.forEach(s => { if (s.openText) s.openText = strip(s.openText); });
    }

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

// Per-value 1–5 distribution counts → [n1,n2,n3,n4,n5]. Drives the histogram cards.
function dist5(vals) {
  const d = [0, 0, 0, 0, 0];
  vals.forEach(v => { const k = Math.round(v); if (k >= 1 && k <= 5) d[k - 1]++; });
  return d;
}

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
  } else if (template === 'likert-agreement') {
    return aggregateRatingList(rows, header, count, respondentBreakdown, 'l', (config.statements || config.items || []), 'comment');
  } else if (template === 'star-rating') {
    return aggregateRatingList(rows, header, count, respondentBreakdown, 'r', (config.items || config.serviceRatings || []), 'comment');
  } else if (template === 'quick-poll') {
    return aggregateQuickPoll(rows, header, count, respondentBreakdown);
  } else if (template === 'name-vote') {
    return aggregateNameVote(rows, header, count, respondentBreakdown, config);
  } else if (template === 'open-feedback') {
    return aggregateOpenFeedback(rows, header, count, respondentBreakdown, config);
  } else if (template === 'ranked-choice') {
    return aggregateRanked(rows, header, count, respondentBreakdown, config);
  } else if (template === 'budget-allocation') {
    return aggregateBudget(rows, header, count, respondentBreakdown, config);
  } else if (template === 'importance-performance') {
    return aggregateIPA(rows, header, count, respondentBreakdown, config);
  } else if (template === 'demographic') {
    return aggregateDemographic(rows, header, count, respondentBreakdown, config);
  } else if (template === 'multi-section') {
    return aggregateMultiSection(rows, header, count, respondentBreakdown, config);
  }

  return { count, respondentBreakdown, raw: rows.slice(0, 5) };
}

function aggregateRanked(rows, header, count, respondentBreakdown, config) {
  const items = config.items || [];
  const N = items.length;
  const serviceRatings = items.map((item, i) => {
    const label = (item && item.label) ? item.label : item;
    const col = header.indexOf(`rk${i + 1}`);
    const vals = rows.map(r => Number(r[col])).filter(v => !isNaN(v) && v > 0);
    const avg = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
    const score = avg ? Math.round(((N - avg + 1) / N) * 100) : 0;
    return { label: `${label} (avg rank ${avg ? avg.toFixed(1) : '–'})`, bestPct: score, n: vals.length };
  }).sort((a, b) => b.bestPct - a.bestPct);
  return { count, respondentBreakdown, serviceRatings };
}

function aggregateBudget(rows, header, count, respondentBreakdown, config) {
  const items = config.items || [];
  const total = config.total || 100;
  const serviceRatings = items.map((item, i) => {
    const label = (item && item.label) ? item.label : item;
    const col = header.indexOf(`al${i + 1}`);
    const vals = rows.map(r => Number(r[col])).filter(v => !isNaN(v));
    const avg = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
    return { label: `${label} (avg ${avg.toFixed(0)} pts)`, bestPct: Math.round((avg / total) * 100), n: vals.length };
  }).sort((a, b) => b.bestPct - a.bestPct);
  return { count, respondentBreakdown, serviceRatings };
}

function aggregateIPA(rows, header, count, respondentBreakdown, config) {
  const items = config.items || [];
  const ipa = [];
  const serviceRatings = items.map((item, i) => {
    const label = (item && item.label) ? item.label : item;
    const ic = header.indexOf(`imp${i + 1}`), pc = header.indexOf(`perf${i + 1}`);
    const iv = rows.map(r => Number(r[ic])).filter(v => !isNaN(v) && v > 0);
    const pv = rows.map(r => Number(r[pc])).filter(v => !isNaN(v) && v > 0);
    const ia = iv.length ? iv.reduce((s, v) => s + v, 0) / iv.length : 0;
    const pa = pv.length ? pv.reduce((s, v) => s + v, 0) / pv.length : 0;
    const gap = ia - pa;
    ipa.push({ label, importance: Math.round(ia * 100) / 100, performance: Math.round(pa * 100) / 100, gap: Math.round(gap * 100) / 100 });
    return { label: `${label} (imp ${ia.toFixed(1)} / perf ${pa.toFixed(1)})`, bestPct: Math.round((Math.max(0, gap) / 4) * 100), n: iv.length };
  }).sort((a, b) => b.bestPct - a.bestPct);
  return { count, respondentBreakdown, serviceRatings, ipa };
}

function aggregateDemographic(rows, header, count, respondentBreakdown, config) {
  const fields = (config.fields || []).map(f => (typeof f === 'string') ? { label: f, options: [] } : f);
  const serviceRatings = [];
  const openText = [];
  fields.forEach((f, i) => {
    const col = header.indexOf(`d${i + 1}`);
    if ((f.options || []).length) {
      const counts = {};
      rows.forEach(r => { const v = r[col]; if (v) counts[v] = (counts[v] || 0) + 1; });
      Object.entries(counts).forEach(([opt, n]) => serviceRatings.push({ label: `${f.label}: ${opt}`, bestPct: count ? Math.round((n / count) * 100) : 0, n }));
    } else {
      rows.forEach((r, ri) => { const v = r[col]; if (v) openText.push({ person: `Person ${ri + 1}`, text: `${f.label}: ${v}` }); });
    }
  });
  return { count, respondentBreakdown, serviceRatings, openText };
}

// Aggregate each section independently → { sections: [{title, template, serviceRatings?, openText?}] }
function aggregateMultiSection(rows, header, count, respondentBreakdown, config) {
  const sections = (config.sections || []).map((sec, si) => {
    const idx = si + 1;
    const c = sec.config || {};
    const t = sec.template;
    const title = sec.title || t;
    if (t === 'likert-agreement' || t === 'star-rating') {
      const items = (t === 'likert-agreement' ? (c.statements || c.items) : (c.items || c.serviceRatings)) || [];
      const pfx = t === 'likert-agreement' ? 'l' : 'r';
      const serviceRatings = items.map((item, i) => {
        const label = (item && item.label) ? item.label : item;
        const col = header.indexOf(`s${idx}_${pfx}${i + 1}`);
        const vals = rows.map(r => Number(r[col])).filter(v => !isNaN(v) && v > 0);
        const avg = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
        return { label, avg: Math.round(avg * 100) / 100, n: vals.length, dist: dist5(vals) };
      });
      const cCol = header.indexOf(`s${idx}_comment`);
      const openText = rows.map((r, i) => ({ person: `Person ${i + 1}`, text: cCol > -1 ? (r[cCol] || '') : '' })).filter(r => r.text);
      return { title, template: t, serviceRatings, openText };
    } else if (t === 'quick-poll') {
      const col = header.indexOf(`s${idx}_choice`);
      const counts = {};
      rows.forEach(r => { const v = r[col]; if (v) counts[v] = (counts[v] || 0) + 1; });
      const serviceRatings = Object.entries(counts).map(([label, n]) => ({ label, bestPct: count ? Math.round((n / count) * 100) : 0, n })).sort((a, b) => b.n - a.n);
      return { title, template: t, serviceRatings };
    } else if (t === 'open-feedback') {
      const pr = c.prompts || c.items || [];
      const cols = (pr.length ? pr.map((_, i) => `s${idx}_q${i + 1}`) : [`s${idx}_q1`]).map(k => header.indexOf(k)).filter(i => i > -1);
      const openText = [];
      rows.forEach((r, i) => { const parts = cols.map(cc => r[cc]).filter(Boolean); if (parts.length) openText.push({ person: `Person ${i + 1}`, text: parts.join(' — ') }); });
      return { title, template: t, openText };
    } else if (t === 'ranked-choice') {
      const items = c.items || []; const N = items.length;
      const serviceRatings = items.map((item, i) => {
        const label = (item && item.label) ? item.label : item;
        const col = header.indexOf(`s${idx}_rk${i + 1}`);
        const vals = rows.map(r => Number(r[col])).filter(v => !isNaN(v) && v > 0);
        const avg = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
        return { label: `${label} (avg rank ${avg ? avg.toFixed(1) : '–'})`, bestPct: avg ? Math.round(((N - avg + 1) / N) * 100) : 0, n: vals.length };
      }).sort((a, b) => b.bestPct - a.bestPct);
      return { title, template: t, serviceRatings };
    } else if (t === 'budget-allocation') {
      const items = c.items || []; const total = c.total || 100;
      const serviceRatings = items.map((item, i) => {
        const label = (item && item.label) ? item.label : item;
        const col = header.indexOf(`s${idx}_al${i + 1}`);
        const vals = rows.map(r => Number(r[col])).filter(v => !isNaN(v));
        const avg = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
        return { label: `${label} (avg ${avg.toFixed(0)} pts)`, bestPct: Math.round((avg / total) * 100), n: vals.length };
      }).sort((a, b) => b.bestPct - a.bestPct);
      return { title, template: t, serviceRatings };
    } else if (t === 'importance-performance') {
      const items = c.items || [];
      const serviceRatings = items.map((item, i) => {
        const label = (item && item.label) ? item.label : item;
        const ic = header.indexOf(`s${idx}_imp${i + 1}`), pc = header.indexOf(`s${idx}_perf${i + 1}`);
        const iv = rows.map(r => Number(r[ic])).filter(v => !isNaN(v) && v > 0);
        const pv = rows.map(r => Number(r[pc])).filter(v => !isNaN(v) && v > 0);
        const ia = iv.length ? iv.reduce((s, v) => s + v, 0) / iv.length : 0;
        const pa = pv.length ? pv.reduce((s, v) => s + v, 0) / pv.length : 0;
        return { label: `${label} (imp ${ia.toFixed(1)} / perf ${pa.toFixed(1)})`, bestPct: Math.round((Math.max(0, ia - pa) / 4) * 100), n: iv.length };
      }).sort((a, b) => b.bestPct - a.bestPct);
      return { title, template: t, serviceRatings };
    } else if (t === 'demographic') {
      const fields = (c.fields || []).map(f => (typeof f === 'string') ? { label: f, options: [] } : f);
      const serviceRatings = []; const openText = [];
      fields.forEach((f, i) => {
        const col = header.indexOf(`s${idx}_d${i + 1}`);
        if ((f.options || []).length) {
          const counts = {}; rows.forEach(r => { const v = r[col]; if (v) counts[v] = (counts[v] || 0) + 1; });
          Object.entries(counts).forEach(([opt, n]) => serviceRatings.push({ label: `${f.label}: ${opt}`, bestPct: count ? Math.round((n / count) * 100) : 0, n }));
        } else {
          rows.forEach((r, ri) => { const v = r[col]; if (v) openText.push({ person: `Person ${ri + 1}`, text: `${f.label}: ${v}` }); });
        }
      });
      return { title, template: t, serviceRatings, openText };
    }
    return { title, template: t };
  });
  return { count, respondentBreakdown, sections };
}

// Average 1–5 ratings per item → serviceRatings shape (reuses existing bar rendering).
function aggregateRatingList(rows, header, count, respondentBreakdown, prefix, items, commentField) {
  const serviceRatings = items.map((item, i) => {
    const label = (item && item.label) ? item.label : item;
    const col = header.indexOf(`${prefix}${i + 1}`);
    const vals = rows.map(r => Number(r[col])).filter(v => !isNaN(v) && v > 0);
    const avg = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
    return { label, avg: Math.round(avg * 100) / 100, n: vals.length, dist: dist5(vals) };
  });
  const cCol = header.indexOf(commentField);
  const openText = rows.map((r, i) => ({ person: `Person ${i + 1}`, text: cCol > -1 ? (r[cCol] || '') : '' })).filter(r => r.text);
  return { count, respondentBreakdown, serviceRatings, openText };
}

// Count choices → serviceRatings shape with bestPct so existing bar rendering shows %.
function aggregateQuickPoll(rows, header, count, respondentBreakdown) {
  const col = header.indexOf('choice');
  const counts = {};
  rows.forEach(r => { const v = r[col]; if (v) counts[v] = (counts[v] || 0) + 1; });
  const serviceRatings = Object.entries(counts)
    .map(([label, n]) => ({ label, bestPct: count ? Math.round((n / count) * 100) : 0, n }))
    .sort((a, b) => b.n - a.n);
  return { count, respondentBreakdown, serviceRatings };
}

// Count votes per candidate name (zero-vote candidates included) → serviceRatings shape.
function aggregateNameVote(rows, header, count, respondentBreakdown, config) {
  const candidates = (config.candidates || []).map(c => (c && c.label) ? c.label : c);
  const col = header.indexOf('choice');
  const counts = {};
  candidates.forEach(c => { counts[c] = 0; });
  rows.forEach(r => { const v = r[col]; if (v) counts[v] = (counts[v] || 0) + 1; });
  const serviceRatings = Object.entries(counts)
    .map(([label, n]) => ({ label, bestPct: count ? Math.round((n / count) * 100) : 0, n }))
    .sort((a, b) => b.n - a.n);
  const cCol = header.indexOf('comment');
  const openText = rows
    .map((r, i) => ({ person: `Person ${i + 1}`, text: cCol > -1 ? (r[cCol] || '') : '' }))
    .filter(r => r.text);
  return { count, respondentBreakdown, serviceRatings, openText };
}

// Collect all open-text answers → openText list.
function aggregateOpenFeedback(rows, header, count, respondentBreakdown, config) {
  const prompts = config.prompts || config.items || [];
  const cols = (prompts.length ? prompts.map((_, i) => `q${i + 1}`) : ['q1']).map(k => header.indexOf(k)).filter(i => i > -1);
  const openText = [];
  rows.forEach((r, i) => {
    const parts = cols.map(c => r[c]).filter(Boolean);
    if (parts.length) openText.push({ person: `Person ${i + 1}`, text: parts.join(' — ') });
  });
  return { count, respondentBreakdown, openText };
}

function aggregateConjoint(rows, header, count, respondentBreakdown, config) {
  const getCol = (name) => header.indexOf(name);

  // Part A — shared feature ratings (a1–a10)
  const sharedFeatures = config.sharedFeatures || [];
  const partA = sharedFeatures.map((label, i) => {
    const col = getCol(`a${i + 1}`);
    const ratings = rows.map(r => Number(r[col])).filter(v => !isNaN(v) && v > 0);
    const avg = ratings.length ? ratings.reduce((s, v) => s + v, 0) / ratings.length : 0;
    return { label, avg: Math.round(avg * 100) / 100, n: ratings.length, dist: dist5(ratings) };
  });

  // Part B — key differences importance (b1–b3)
  const attributes = config.attributes || [];
  const partB = attributes.map((attr, i) => {
    const col = getCol(`b${i + 1}`);
    const ratings = rows.map(r => Number(r[col])).filter(v => !isNaN(v) && v > 0);
    const avg = ratings.length ? ratings.reduce((s, v) => s + v, 0) / ratings.length : 0;
    return { label: attr.label, avg: Math.round(avg * 100) / 100, n: ratings.length, dist: dist5(ratings) };
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
    return { label, avg: Math.round(avg * 100) / 100, n: ratings.length, dist: dist5(ratings) };
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

function notionHeaders() {
  return {
    Authorization: `Bearer ${process.env.NOTION_API_KEY}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  };
}

async function getSurveyBySlug(slug) {
  // Prefer exact Slug-property match; fall back to URL/name scan for un-migrated rows.
  let page = null;
  const filtered = await fetch(`https://api.notion.com/v1/databases/${DB_ID}/query`, {
    method: 'POST', headers: notionHeaders(),
    body: JSON.stringify({ filter: { property: 'Slug', rich_text: { equals: slug } } }),
  });
  if (filtered.ok) {
    const fdata = await filtered.json();
    page = (fdata.results || [])[0] || null;
  }
  if (!page) {
    const res = await fetch(`https://api.notion.com/v1/databases/${DB_ID}/query`, {
      method: 'POST', headers: notionHeaders(), body: JSON.stringify({}),
    });
    if (!res.ok) return null;
    const data = await res.json();
    page = data.results.find(p => {
      const url = p.properties['Survey URL']?.url || '';
      const name = p.properties['Survey Name']?.title?.[0]?.plain_text || '';
      return url.includes(slug) || slugify(name) === slug;
    });
  }
  if (!page) return null;

  const p = page.properties;
  let config = {};
  try { config = JSON.parse(p['Config']?.rich_text?.[0]?.plain_text || '{}'); } catch (_) {}

  return {
    id: page.id,
    template: p['Template']?.select?.name || '',
    village: p['Village']?.select?.name || '',
    sheetId: p['Sheet ID']?.rich_text?.[0]?.plain_text || '',
    surveyName: p['Survey Name']?.title?.[0]?.plain_text || '',
    snapshotLabel: p['Snapshot Label']?.rich_text?.[0]?.plain_text || '',
    resultsVisibility: p['Results Visibility']?.select?.name || 'public',
    active: p['Active']?.checkbox || false,
    status: p['Status']?.select?.name || '',
    commentsModerated: p['Comments Moderated']?.checkbox || false,
    hiddenComments: parseJsonArray(p['Hidden Comments']?.rich_text?.[0]?.plain_text),
    openDate: p['Open Date']?.date?.start || null,
    closeDate: p['Close Date']?.date?.start || null,
    config,
  };
}

function parseJsonArray(raw) {
  try { const a = JSON.parse(raw || '[]'); return Array.isArray(a) ? a : []; } catch (_) { return []; }
}

// 'closed' once past close date / paused / Active off; mirrors survey-config + survey-submit.
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

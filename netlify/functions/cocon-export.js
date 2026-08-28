/**
 * cocon-export.js — GET /api/cocon-export?village=Smiths Lake&project=slug[&table=schedule|budget]
 *
 * Streams the Co-Contribution Schedule and Project Budget as a CSV download
 * that reproduces the workbook layout (line items → subtotals → funding
 * summary → budget). Admin/steward only. CSV cell escaping mirrors
 * survey-export.js.
 *
 * table param (optional): 'schedule' or 'budget' to export just one; default
 * exports both in one file.
 */

import { requireRole } from './_auth.js';
import { computeRollups } from './_cocon-calc.js';

const NOTION_VERSION = '2022-06-28';
const PROJECTS_DB = process.env.NOTION_COCON_PROJECTS_DB_ID || '';
const SCHEDULE_DB = process.env.NOTION_COCON_SCHEDULE_DB_ID || '';
const BUDGET_DB = process.env.NOTION_COCON_BUDGET_DB_ID || '';

function jsonErr(status, error) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error }) };
}
function notionHeaders() {
  return {
    Authorization: `Bearer ${process.env.NOTION_API_KEY}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  };
}
function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const rt = (p) => (p?.rich_text || []).map(t => t.plain_text).join('');
const sel = (p) => p?.select?.name || '';
const num = (p) => (p?.number ?? null);
const money = (n) => (n == null ? '' : '$' + (Math.round(n * 100) / 100).toLocaleString('en-AU'));

async function queryAll(dbId, filter, extra = {}) {
  const results = [];
  let cursor;
  do {
    const res = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
      method: 'POST', headers: notionHeaders(),
      body: JSON.stringify({ ...(filter ? { filter } : {}), page_size: 100, ...(cursor ? { start_cursor: cursor } : {}), ...extra }),
    });
    if (!res.ok) throw new Error(`Notion responded ${res.status}`);
    const data = await res.json();
    results.push(...data.results);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return results;
}

export const handler = async (event, context) => {
  if (event.httpMethod !== 'GET') return jsonErr(405, 'GET only');

  const village = event.queryStringParameters?.village || 'Smiths Lake';
  const projectSlug = event.queryStringParameters?.project || '';
  const table = event.queryStringParameters?.table || 'both';

  const auth = requireRole(context, { village, anyOf: ['admin', 'treasurer', 'pm'] });
  if (!auth.ok) return jsonErr(auth.status, auth.error);
  if (!projectSlug) return jsonErr(400, 'Missing project slug');
  if (!PROJECTS_DB || !SCHEDULE_DB || !BUDGET_DB) return jsonErr(503, 'Co-Contribution databases not configured');

  try {
    const villageFilter = { property: 'Village', rich_text: { equals: village } };
    const projectFilter = { and: [villageFilter, { property: 'Project', rich_text: { equals: projectSlug } }] };

    const [projPages, schedPages, budgetPages] = await Promise.all([
      queryAll(PROJECTS_DB, { and: [villageFilter, { property: 'Slug', rich_text: { equals: projectSlug } }] }),
      queryAll(SCHEDULE_DB, projectFilter),
      queryAll(BUDGET_DB, projectFilter),
    ]);

    const project = projPages.length ? {
      name: projPages[0].properties.Name?.title?.[0]?.plain_text || projectSlug,
      grantRequestAmount: num(projPages[0].properties['Grant Request Amount']),
      grantProgram: rt(projPages[0].properties['Grant Program']),
      notes: rt(projPages[0].properties['Notes / Rate Card']),
    } : { name: projectSlug, grantRequestAmount: null };

    const schedule = schedPages.map(p => ({
      name: p.properties.Name?.title?.[0]?.plain_text || '',
      order: num(p.properties.Order) ?? 0,
      party: sel(p.properties.Party) || 'Community',
      description: rt(p.properties.Description),
      type: sel(p.properties.Type),
      value: num(p.properties.Value),
      confirmed: sel(p.properties.Confirmed),
      archived: p.properties.Archived?.checkbox === true,
    })).filter(r => !r.archived).sort((a, b) => a.order - b.order);

    const budget = budgetPages.map(p => ({
      name: p.properties.Name?.title?.[0]?.plain_text || '',
      order: num(p.properties.Order) ?? 0,
      phase: rt(p.properties.Phase),
      amount: num(p.properties.Amount),
      archived: p.properties.Archived?.checkbox === true,
    })).filter(r => !r.archived).sort((a, b) => a.order - b.order);

    const r = computeRollups(schedule, budget, project);
    const rows = [];
    const push = (...cells) => rows.push(cells.map(csvCell).join(','));

    if (table === 'both' || table === 'schedule') {
      push(`WIK Co-Contribution — ${project.name}`);
      push('PPCA Co-Contribution Schedule — Cash and Works in Kind (WIK)');
      if (project.grantProgram) push(project.grantProgram);
      push('');
      push('#', 'Contribution Item', 'Description / Calculation Basis', 'Type', 'Value (ex GST)', 'Confirmed?');
      schedule.filter(s => s.party !== 'External').forEach((s, i) => {
        push(i + 1, s.name, s.description, s.type, money(s.value), s.confirmed);
      });
      push('');
      push('SUBTOTAL — Cash Contributions PAID (prior investment + fundraising)', '', '', '', money(r.paid));
      push('SUBTOTAL — Cash Contributions ANTICIPATED (investment + fundraising)', '', '', '', money(r.cashAnticipated));
      push('SUBTOTAL — Works-in-Kind (WIK) PLEDGED / COMMITTED', '', '', '', money(r.wikPledged));
      push('TOTAL PPCA / COMMUNITY CO-CONTRIBUTION (Cash + WIK)', '', '', '', money(r.totalCommunity));
      push('');
      push('TOTAL PROJECT CO-CONTRIBUTION SUMMARY');
      schedule.filter(s => s.party === 'External').forEach(s => {
        push(s.name, '', '', '', money(s.value), s.confirmed);
      });
      push('PPCA / Community — Cash and Works in Kind (this schedule)', '', '', '', money(r.totalCommunity));
      push('TOTAL CO-CONTRIBUTION', '', '', '', money(r.totalCoContribution), (r.coContributionPct * 100).toFixed(1) + '%');
      push('Grant request', '', '', '', money(r.grantRequest));
      push('TOTAL PROJECT VALUE', '', '', '', money(r.totalProjectValue));
      if (project.notes) { push(''); push('NOTES', project.notes); }
    }

    if (table === 'both' || table === 'budget') {
      push('');
      push(`Project Budget — ${project.name}`);
      push('');
      push('Budget Item', 'Phase', 'Amount (ex GST)');
      budget.forEach(b => push(b.name, b.phase, money(b.amount)));
      push('');
      push('ESTIMATED TOTAL PROJECT COST', '', money(r.estimatedTotalProjectCost));
    }

    const fname = `${projectSlug}-cocontribution-${new Date().toISOString().slice(0, 10)}.csv`;
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${fname}"`,
        'Access-Control-Allow-Origin': '*',
      },
      body: rows.join('\r\n'),
    };
  } catch (err) {
    return jsonErr(502, err.message);
  }
};

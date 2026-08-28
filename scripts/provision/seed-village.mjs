#!/usr/bin/env node
/**
 * Village factory — seed cloned preview DBs with authored content.
 * Usage: netlify dev:exec node scripts/provision/seed-village.mjs <envpackPath> <contentDir> [--only=ENV_VAR,ENV_VAR]
 * (NOTION_API_KEY injected in-process by netlify dev:exec — never written anywhere.)
 *
 * For each <contentDir>/<ENV_VAR>.json ({ envVar, rows: [{ properties, body? }] }):
 *   - resolves the target DB id from the env pack
 *   - reads the LIVE schema of that DB via the API
 *   - converts simple values into typed Notion payloads
 *     (title/rich_text/select/multi_select/status/date/number/checkbox/url/email/phone_number)
 *   - skips formula/rollup/relation/people/files/created_by etc. properties with a log line
 *   - skips rows whose exact title already exists in the target DB (idempotent re-runs)
 *   - creates pages ~400ms apart; body strings become paragraph blocks
 * Continue-on-error per row; summary JSON printed at the end.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';

const [envpackPath, contentDir, ...flags] = process.argv.slice(2);
if (!envpackPath || !contentDir) { console.error('usage: seed-village.mjs <envpackPath> <contentDir> [--only=ENV_VAR,...]'); process.exit(1); }
const KEY = process.env.NOTION_API_KEY;
if (!KEY) { console.error('NOTION_API_KEY not in env — run under netlify dev:exec'); process.exit(1); }
const onlyFlag = flags.find((f) => f.startsWith('--only='));
const only = onlyFlag ? new Set(onlyFlag.slice(7).split(',').map((s) => s.trim()).filter(Boolean)) : null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function notion(method, path, body) {
  for (let attempt = 1; ; attempt++) {
    await sleep(400); // stay well under 2 req/s
    const r = await fetch(`https://api.notion.com/v1/${path}`, {
      method,
      headers: { Authorization: `Bearer ${KEY}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    if (r.status === 429 && attempt <= 5) {
      const retryAfter = Number(r.headers.get('retry-after')) || 10;
      console.log(`429 rate limited on ${method} ${path} — waiting ${retryAfter}s (attempt ${attempt}/5)`);
      await sleep(retryAfter * 1000 + 500);
      continue;
    }
    if (!r.ok) { const e = new Error(`${method} ${path}: ${r.status} ${text.slice(0, 500)}`); e.status = r.status; throw e; }
    return JSON.parse(text);
  }
}

const UNSETTABLE = new Set([
  'formula', 'rollup', 'relation', 'people', 'files', 'created_by', 'created_time',
  'last_edited_by', 'last_edited_time', 'unique_id', 'button', 'verification',
]);

const toBool = (v) => v === true || v === 'true' || v === 'TRUE' || v === 'True' || v === 1;
const asList = (v) => (Array.isArray(v) ? v : String(v).split(/\s*[;,]\s*/)).map((x) => String(x).trim()).filter(Boolean);

/** Convert a simple JS value into a typed Notion property payload; return undefined to skip. */
function convert(type, value) {
  if (value === null || value === undefined || value === '') return { clear: true, payload: undefined };
  switch (type) {
    case 'title': return { payload: { title: [{ text: { content: String(value) } }] } };
    case 'rich_text': return { payload: { rich_text: [{ text: { content: String(value).slice(0, 2000) } }] } };
    case 'select': return { payload: { select: { name: String(value) } } };
    case 'status': return { payload: { status: { name: String(value) } } };
    case 'multi_select': return { payload: { multi_select: asList(value).map((name) => ({ name })) } };
    case 'date': {
      if (typeof value === 'object') return { payload: { date: value } };
      return { payload: { date: { start: String(value) } } };
    }
    case 'number': {
      const n = Number(value);
      if (Number.isNaN(n)) return undefined;
      return { payload: { number: n } };
    }
    case 'checkbox': return { payload: { checkbox: toBool(value) } };
    case 'url': return { payload: { url: String(value) } };
    case 'email': return { payload: { email: String(value) } };
    case 'phone_number': return { payload: { phone_number: String(value) } };
    default: return undefined;
  }
}

async function existingTitles(dbId, titleProp) {
  const titles = new Set();
  let cursor;
  do {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const res = await notion('POST', `databases/${dbId}/query`, body);
    for (const pg of res.results || []) {
      const t = pg.properties?.[titleProp]?.title ?? [];
      titles.add(t.map((x) => x.plain_text).join(''));
    }
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return titles;
}

async function main() {
  const pack = JSON.parse(readFileSync(envpackPath, 'utf8'));
  const envVars = pack.envVars || pack;
  const created = {};
  const failures = [];
  const skippedProps = new Set();

  const files = readdirSync(contentDir).filter((f) => f.endsWith('.json') && !f.startsWith('_')).sort();
  for (const file of files) {
    const content = JSON.parse(readFileSync(join(contentDir, file), 'utf8'));
    const envVar = content.envVar || basename(file, '.json');
    if (only && !only.has(envVar)) continue;
    const dbId = envVars[envVar];
    if (!dbId) { failures.push(`${envVar}: no DB id in env pack`); continue; }

    let schema;
    try { schema = await notion('GET', `databases/${dbId}`); }
    catch (e) { failures.push(`${envVar}: schema fetch failed: ${e.message}`); continue; }
    const props = schema.properties || {};
    const titleProp = Object.keys(props).find((k) => props[k].type === 'title');
    if (!titleProp) { failures.push(`${envVar}: no title property found`); continue; }

    let titles;
    try { titles = await existingTitles(dbId, titleProp); }
    catch (e) { failures.push(`${envVar}: existing-title query failed: ${e.message}`); continue; }

    created[envVar] = created[envVar] || 0;
    for (const row of content.rows || []) {
      const src = row.properties || {};
      const rowTitle = String(src[titleProp] ?? '');
      if (rowTitle && titles.has(rowTitle)) { console.log(`skip (exists) ${envVar}: "${rowTitle}"`); continue; }

      const payload = {};
      for (const [name, value] of Object.entries(src)) {
        const def = props[name];
        if (!def) { skippedProps.add(`${envVar}.${name} (not in schema)`); continue; }
        if (UNSETTABLE.has(def.type)) { skippedProps.add(`${envVar}.${name} (type ${def.type} not settable)`); continue; }
        const conv = convert(def.type, value);
        if (!conv) { skippedProps.add(`${envVar}.${name} (no converter for ${def.type})`); continue; }
        if (conv.payload !== undefined) payload[name] = conv.payload;
      }

      const body = { parent: { database_id: dbId }, properties: payload };
      if (Array.isArray(row.body) && row.body.length) {
        body.children = row.body.map((para) => ({
          object: 'block', type: 'paragraph',
          paragraph: { rich_text: [{ text: { content: String(para).slice(0, 2000) } }] },
        }));
      }
      try {
        await notion('POST', 'pages', body);
        created[envVar] += 1;
        titles.add(rowTitle);
        console.log(`created ${envVar}: "${rowTitle}"`);
      } catch (e) {
        failures.push(`${envVar} "${rowTitle}": ${e.message}`);
        console.log(`FAIL ${envVar}: "${rowTitle}" — ${e.message}`);
      }
    }
  }

  if (skippedProps.size) console.log('skipped properties:\n  ' + [...skippedProps].join('\n  '));
  console.log('SUMMARY ' + JSON.stringify({ created, failures }, null, 2));
  if (failures.length) process.exitCode = 3;
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });

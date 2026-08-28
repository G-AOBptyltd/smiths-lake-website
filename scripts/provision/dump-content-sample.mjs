#!/usr/bin/env node
/**
 * Village factory — step 0b: dump SAMPLE ROW DATA (values, not schema) so we can
 * see how Smiths Lake structures content pages + register rows.
 *
 * Run via:
 *   netlify dev:exec node scripts/provision/dump-content-sample.mjs <content-sample.json path>
 * (NOTION_API_KEY injected in-process; never written to disk.)
 *
 * Output:
 *   <arg path>                       — up to 60 rows from the content DB
 *   <same dir>/register-samples.json — 5 rows each from VF Events, VF Facilities,
 *                                      VF Activities, Section Settings
 *
 * PII guard: any property of type people/email/phone_number, or whose NAME looks
 * like email/phone/mobile/contact, is dropped (defensive — content DB should
 * have none).
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const OUT_CONTENT = process.argv[2];
if (!OUT_CONTENT) { console.error('usage: dump-content-sample.mjs <content-sample.json>'); process.exit(1); }
const OUT_DIR = dirname(OUT_CONTENT);

const KEY = process.env.NOTION_API_KEY;
if (!KEY) { console.error('NOTION_API_KEY not in env — run under netlify dev:exec'); process.exit(1); }

const CONTENT_DB = process.env.NOTION_CONTENT_DB_ID || '2cad508adfc1809d8438c8f3a5dd8d42';
const REGISTERS = {
  'VF Events':        process.env.NOTION_VF_EVENTS_DB_ID || '3bfd508adfc1814488d5f68e3f6e99b7',
  'VF Facilities':    process.env.NOTION_VF_FACILITIES_DB_ID || '3bfd508adfc18115882be11adc1f7c01',
  'VF Activities':    process.env.NOTION_VF_ACTIVITIES_DB_ID || null,
  'Section Settings': process.env.NOTION_SECTION_SETTINGS_DB || null,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function notion(path, body) {
  const r = await fetch(`https://api.notion.com/v1/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${KEY}`,
      'Notion-Version': '2022-06-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${path}: ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

const PII_TYPES = new Set(['people', 'email', 'phone_number', 'created_by', 'last_edited_by']);
const PII_NAME_RE = /email|phone|mobile|contact\s*(no|number)|e-mail/i;

function rt(arr) { return (arr || []).map((t) => t.plain_text).join(''); }

function simplify(prop) {
  switch (prop.type) {
    case 'title': return rt(prop.title);
    case 'rich_text': return rt(prop.rich_text);
    case 'select': return prop.select ? prop.select.name : null;
    case 'status': return prop.status ? prop.status.name : null;
    case 'multi_select': return (prop.multi_select || []).map((s) => s.name);
    case 'checkbox': return prop.checkbox;
    case 'number': return prop.number;
    case 'url': return prop.url;
    case 'date': return prop.date;
    case 'files': return (prop.files || []).map((f) => ({ name: f.name, kind: f.type, url: (f.file?.url || f.external?.url || '').split('?')[0].slice(0, 120) }));
    case 'relation': return { relation_ids: (prop.relation || []).map((r) => r.id), has_more: !!prop.has_more };
    case 'formula': {
      const f = prop.formula;
      return { formula: f.type, value: f[f.type] };
    }
    case 'rollup': {
      const ro = prop.rollup;
      if (ro.type === 'array') return { rollup: 'array', values: ro.array.slice(0, 3).map(simplify) };
      return { rollup: ro.type, value: ro[ro.type] };
    }
    case 'unique_id': return prop.unique_id ? `${prop.unique_id.prefix || ''}${prop.unique_id.number}` : null;
    case 'created_time': return prop.created_time;
    case 'last_edited_time': return prop.last_edited_time;
    default: return { unhandled_type: prop.type };
  }
}

function rowToSample(page) {
  const props = {};
  for (const [name, prop] of Object.entries(page.properties)) {
    if (PII_TYPES.has(prop.type)) continue;          // defensive PII filter
    if (PII_NAME_RE.test(name)) continue;            // defensive name filter
    props[name] = simplify(prop);
  }
  return { id: page.id, archived: page.archived, props };
}

async function dumpDb(id, max) {
  const rows = [];
  let cursor;
  while (rows.length < max) {
    const body = { page_size: Math.min(100, max - rows.length) };
    if (cursor) body.start_cursor = cursor;
    const res = await notion(`databases/${id}/query`, body);
    rows.push(...res.results.map(rowToSample));
    if (!res.has_more || rows.length >= max) break;
    cursor = res.next_cursor;
    await sleep(400);
  }
  return rows.slice(0, max);
}

mkdirSync(OUT_DIR, { recursive: true });

// 1. content DB — up to 60 rows
const contentRows = await dumpDb(CONTENT_DB, 60);
writeFileSync(OUT_CONTENT, JSON.stringify({ db: 'content', id: CONTENT_DB, count: contentRows.length, rows: contentRows }, null, 2));
console.log(`content: ${contentRows.length} rows -> ${OUT_CONTENT}`);

// 2. register samples — 5 rows each
const registers = {};
for (const [name, id] of Object.entries(REGISTERS)) {
  await sleep(400);
  if (!id) { registers[name] = { status: 'no-id' }; console.log(`${name}: no id`); continue; }
  try {
    const rows = await dumpDb(id, 5);
    registers[name] = { id, count: rows.length, rows };
    console.log(`${name}: ${rows.length} rows`);
  } catch (e) {
    registers[name] = { id, status: 'error', error: String(e.message).slice(0, 160) };
    console.log(`${name}: ERROR ${String(e.message).slice(0, 120)}`);
  }
}
const regOut = join(OUT_DIR, 'register-samples.json');
writeFileSync(regOut, JSON.stringify(registers, null, 2));
console.log(`registers -> ${regOut}`);

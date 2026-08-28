#!/usr/bin/env node
/**
 * Content polish — find (and optionally fix) flagship Smiths Lake sample text
 * that leaked into a PREVIEW village's cloned+seeded Notion estate.
 *
 * Usage (always under netlify dev:exec so NOTION_API_KEY is injected in-process):
 *   scan : netlify dev:exec node scripts/provision/polish-content.mjs <envpackPath> [--out=hits.json] [--dbs=ENV_VAR,..] [--no-bodies]
 *   apply: netlify dev:exec node scripts/provision/polish-content.mjs <envpackPath> --fixes=fixes.json [--out=hits.json]
 *
 * Scan: queries every DB in the env pack (or --dbs subset) and reports any
 * title/rich_text/select/multi_select/status/url/email/phone property value —
 * and any text-bearing BODY block — matching:
 *   Smiths Lake | PPCA | Pacific Palms | villagefirst.org.au   (case-insensitive)
 * Nothing is changed in scan mode. Hits print to stdout and (with --out) JSON.
 *
 * Apply: reads a fixes file:
 *   { "propertyFixes": [{ "pageId", "property", "type", "newText" }],
 *     "blockFixes":    [{ "blockId", "blockType", "newText" }] }
 * Safety before every write: the page/block's parent chain is fetched live and
 * its database must be one of the env pack's DB ids (all 3cad508a… preview
 * clones). Any id starting with 2cad508a (flagship Smiths Lake) is refused
 * outright. After applying, a full re-scan runs and reports remaining hits.
 *
 * Throttle: every API call waits 400ms (shared helper), 429-aware retry.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const [envpackPath, ...flags] = process.argv.slice(2);
if (!envpackPath) { console.error('usage: polish-content.mjs <envpackPath> [--fixes=f.json] [--out=hits.json] [--dbs=A,B] [--no-bodies]'); process.exit(1); }
const KEY = process.env.NOTION_API_KEY;
if (!KEY) { console.error('NOTION_API_KEY not in env — run under netlify dev:exec'); process.exit(1); }

const getFlag = (name) => { const f = flags.find((x) => x.startsWith(`--${name}=`)); return f ? f.slice(name.length + 3) : undefined; };
const fixesPath = getFlag('fixes');
const outPath = getFlag('out');
const dbsFilter = getFlag('dbs') ? new Set(getFlag('dbs').split(',').map((s) => s.trim()).filter(Boolean)) : null;
const scanBodies = !flags.includes('--no-bodies');

const PATTERN = /smiths\s*lake|ppca|pacific\s*palms|villagefirst\.org\.au/i;
const FLAGSHIP_PREFIX = '2cad508a'; // flagship Smiths Lake estate — NEVER touch
const norm = (id) => String(id || '').replace(/-/g, '');

const pack = JSON.parse(readFileSync(envpackPath, 'utf8'));
const envVars = pack.envVars || pack;
const packDbIds = new Map(); // normalised id -> env var name
for (const [k, v] of Object.entries(envVars)) {
  if (norm(v).startsWith(FLAGSHIP_PREFIX)) { console.error(`REFUSING: env pack maps ${k} to a flagship (2cad508a…) DB`); process.exit(2); }
  packDbIds.set(norm(v), k);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function notion(method, path, body) {
  for (let attempt = 1; ; attempt++) {
    await sleep(400); // throttle every call, reads included
    const r = await fetch(`https://api.notion.com/v1/${path}`, {
      method,
      headers: { Authorization: `Bearer ${KEY}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    if (r.status === 429 && attempt <= 5) {
      const retryAfter = Number(r.headers.get('retry-after')) || 10;
      console.log(`429 on ${method} ${path} — waiting ${retryAfter}s (attempt ${attempt}/5)`);
      await sleep(retryAfter * 1000 + 500);
      continue;
    }
    if (!r.ok) { const e = new Error(`${method} ${path}: ${r.status} ${text.slice(0, 400)}`); e.status = r.status; throw e; }
    return JSON.parse(text);
  }
}

const plain = (arr) => (arr || []).map((x) => x.plain_text ?? x.text?.content ?? '').join('');

/** Extract scannable text from a property value; returns { type, text } or null. */
function propText(prop) {
  switch (prop.type) {
    case 'title': return { type: 'title', text: plain(prop.title) };
    case 'rich_text': return { type: 'rich_text', text: plain(prop.rich_text) };
    case 'select': return { type: 'select', text: prop.select?.name ?? '' };
    case 'status': return { type: 'status', text: prop.status?.name ?? '' };
    case 'multi_select': return { type: 'multi_select', text: (prop.multi_select || []).map((o) => o.name).join('; ') };
    case 'url': return { type: 'url', text: prop.url ?? '' };
    case 'email': return { type: 'email', text: prop.email ?? '' };
    case 'phone_number': return { type: 'phone_number', text: prop.phone_number ?? '' };
    default: return null;
  }
}

const TEXT_BLOCK_TYPES = new Set(['paragraph', 'heading_1', 'heading_2', 'heading_3', 'bulleted_list_item', 'numbered_list_item', 'quote', 'callout', 'toggle', 'to_do']);

async function scanBlocks(pageId, dbEnvVar, pageTitle, hits, depth = 0) {
  if (depth > 2) return;
  let cursor;
  do {
    const res = await notion('GET', `blocks/${pageId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`);
    for (const b of res.results || []) {
      if (TEXT_BLOCK_TYPES.has(b.type)) {
        const text = plain(b[b.type]?.rich_text);
        if (PATTERN.test(text)) {
          hits.push({ kind: 'block', dbEnvVar, pageId, pageTitle, blockId: b.id, blockType: b.type, text });
        }
      }
      if (b.has_children && b.type !== 'child_database' && b.type !== 'child_page') {
        await scanBlocks(b.id, dbEnvVar, pageTitle, hits, depth + 1);
      }
    }
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
}

async function scan() {
  const hits = [];
  for (const [envVar, dbId] of Object.entries(envVars)) {
    if (dbsFilter && !dbsFilter.has(envVar)) continue;
    let pages = [];
    let cursor;
    try {
      do {
        const body = { page_size: 100 };
        if (cursor) body.start_cursor = cursor;
        const res = await notion('POST', `databases/${dbId}/query`, body);
        pages.push(...(res.results || []));
        cursor = res.has_more ? res.next_cursor : undefined;
      } while (cursor);
    } catch (e) { console.log(`WARN ${envVar}: query failed — ${e.message}`); continue; }

    console.log(`scanned ${envVar}: ${pages.length} pages`);
    for (const pg of pages) {
      const titleProp = Object.values(pg.properties || {}).find((p) => p.type === 'title');
      const pageTitle = titleProp ? plain(titleProp.title) : '(untitled)';
      for (const [name, prop] of Object.entries(pg.properties || {})) {
        const pt = propText(prop);
        if (pt && PATTERN.test(pt.text)) {
          hits.push({ kind: 'property', dbEnvVar: envVar, pageId: pg.id, pageTitle, property: name, type: pt.type, text: pt.text });
        }
      }
      if (scanBodies) await scanBlocks(pg.id, envVar, pageTitle, hits);
    }
  }
  return hits;
}

function printHits(hits, label) {
  console.log(`\n=== ${label}: ${hits.length} hit(s) ===`);
  for (const h of hits) {
    if (h.kind === 'property') {
      console.log(`[${h.dbEnvVar}] page ${h.pageId} ("${h.pageTitle}") · property "${h.property}" (${h.type}):\n    ${h.text}`);
    } else {
      console.log(`[${h.dbEnvVar}] page ${h.pageId} ("${h.pageTitle}") · BODY block ${h.blockId} (${h.blockType}):\n    ${h.text}`);
    }
  }
}

const chunks = (s) => { const out = []; for (let i = 0; i < s.length; i += 2000) out.push({ text: { content: s.slice(i, i + 2000) } }); return out.length ? out : [{ text: { content: '' } }]; };

/** Verify a page's parent DB is inside this env pack before writing. */
async function assertPageInPack(pageId) {
  const pg = await notion('GET', `pages/${pageId}`);
  const parentDb = norm(pg.parent?.database_id);
  if (!parentDb || !packDbIds.has(parentDb)) throw new Error(`page ${pageId} parent DB ${parentDb || '(none)'} is NOT in this env pack — refusing`);
  if (parentDb.startsWith(FLAGSHIP_PREFIX)) throw new Error(`page ${pageId} is in a flagship DB — refusing`);
  return pg;
}

async function applyFixes(fixes) {
  const applied = []; const failed = [];
  for (const f of fixes.propertyFixes || []) {
    try {
      await assertPageInPack(f.pageId);
      let payload;
      switch (f.type) {
        case 'title': payload = { title: chunks(f.newText) }; break;
        case 'rich_text': payload = { rich_text: chunks(f.newText) }; break;
        case 'select': payload = { select: f.newText ? { name: f.newText } : null }; break;
        case 'status': payload = { status: { name: f.newText } }; break;
        case 'multi_select': payload = { multi_select: String(f.newText).split(/\s*;\s*/).filter(Boolean).map((name) => ({ name })) }; break;
        case 'url': payload = { url: f.newText || null }; break;
        case 'email': payload = { email: f.newText || null }; break;
        case 'phone_number': payload = { phone_number: f.newText || null }; break;
        default: throw new Error(`unsupported property type ${f.type}`);
      }
      await notion('PATCH', `pages/${f.pageId}`, { properties: { [f.property]: payload } });
      applied.push(`property ${f.pageId} · ${f.property}`);
      console.log(`fixed property ${f.pageId} · "${f.property}" → ${String(f.newText).slice(0, 80)}`);
    } catch (e) { failed.push(`property ${f.pageId} · ${f.property}: ${e.message}`); console.log(`FAIL property ${f.pageId} · ${f.property}: ${e.message}`); }
  }
  for (const f of fixes.blockFixes || []) {
    try {
      if (!TEXT_BLOCK_TYPES.has(f.blockType)) throw new Error(`unsupported block type ${f.blockType}`);
      // Verify the block's ancestor page belongs to this pack.
      let node = await notion('GET', `blocks/${f.blockId}`);
      let hops = 0;
      while (node.parent?.type === 'block_id' && hops++ < 5) node = await notion('GET', `blocks/${node.parent.block_id}`);
      const pageId = node.parent?.page_id;
      if (!pageId) throw new Error(`could not resolve parent page for block ${f.blockId}`);
      await assertPageInPack(pageId);
      await notion('PATCH', `blocks/${f.blockId}`, { [f.blockType]: { rich_text: chunks(f.newText) } });
      applied.push(`block ${f.blockId}`);
      console.log(`fixed block ${f.blockId} (${f.blockType}) → ${String(f.newText).slice(0, 80)}`);
    } catch (e) { failed.push(`block ${f.blockId}: ${e.message}`); console.log(`FAIL block ${f.blockId}: ${e.message}`); }
  }
  return { applied, failed };
}

async function main() {
  if (!fixesPath) {
    const hits = await scan();
    printHits(hits, `SCAN ${envpackPath.split('/').pop()}`);
    if (outPath) { mkdirSync(dirname(outPath), { recursive: true }); writeFileSync(outPath, JSON.stringify(hits, null, 2)); console.log(`hits written to ${outPath}`); }
    return;
  }
  const fixes = JSON.parse(readFileSync(fixesPath, 'utf8'));
  const { applied, failed } = await applyFixes(fixes);
  console.log(`\napplied ${applied.length} fix(es), ${failed.length} failure(s)`);
  console.log('re-scanning to verify…');
  const remaining = await scan();
  printHits(remaining, `POST-FIX RE-SCAN ${envpackPath.split('/').pop()}`);
  if (outPath) { mkdirSync(dirname(outPath), { recursive: true }); writeFileSync(outPath, JSON.stringify(remaining, null, 2)); }
  if (failed.length) process.exitCode = 3;
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });

#!/usr/bin/env node
/**
 * Village factory — clone the 16-DB VF estate for a preview village.
 * Usage: netlify dev:exec node scripts/provision/clone-village-dbs.mjs <villageSlug> "<Village Name>"
 * (NOTION_API_KEY injected in-process by netlify dev:exec — never written anywhere.)
 *
 * Reads schema dumps from SCHEMA_DIR, creates a parent page
 * "V1st Preview — <Village Name>" under the page that hosts the existing VF DBs,
 * then creates the 16 DBs as children in three passes:
 *   1. plain properties (+formulas as-is; retry without a formula if it fails)
 *   2. relation properties remapped to the village's own clones
 *   3. rollups referencing the patched relations (skip+log on failure)
 * Env pack written to ENVPACK_DIR/<slug>.json.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SCHEMA_DIR = '/Users/gregcollocott/.claude/jobs/2410b68e/tmp/provision/schemas';
const ENVPACK_DIR = '/Users/gregcollocott/.claude/jobs/2410b68e/tmp/provision/envpacks';

const DB_SET = [
  'NOTION_CONTENT_DB_ID', 'NOTION_SECTION_SETTINGS_DB', 'NOTION_VF_SURVEYS_DB_ID',
  'NOTION_MEMBERS_DB_ID', 'NOTION_VF_VOLUNTEERS_DB_ID', 'NOTION_VF_STEWARDS_DB_ID',
  'NOTION_VF_ACTIVITIES_DB_ID', 'NOTION_VF_EVENTS_DB_ID', 'NOTION_VF_EVENT_RSVPS_DB_ID',
  'NOTION_VF_BOOKINGS_DB_ID', 'NOTION_VF_FACILITIES_DB_ID', 'NOTION_VF_ADS_DB_ID',
  'NOTION_CONTRIB_DB_ID', 'NOTION_COCON_PROJECTS_DB_ID', 'NOTION_COCON_SCHEDULE_DB_ID',
  'NOTION_COCON_BUDGET_DB_ID',
];

const [slug, villageName] = process.argv.slice(2);
if (!slug || !villageName) { console.error('usage: clone-village-dbs.mjs <slug> "<Village Name>"'); process.exit(1); }
const KEY = process.env.NOTION_API_KEY;
if (!KEY) { console.error('NOTION_API_KEY not in env — run under netlify dev:exec'); process.exit(1); }

const PARENT_TITLE = `V1st Preview — ${villageName}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function notion(method, path, body) {
  await sleep(400); // stay well under 2 req/s
  const r = await fetch(`https://api.notion.com/v1/${path}`, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) { const e = new Error(`${method} ${path}: ${r.status} ${text.slice(0, 400)}`); e.status = r.status; throw e; }
  return JSON.parse(text);
}

// ---- load schemas ----
const schemas = {};
for (const name of DB_SET) {
  schemas[name] = JSON.parse(readFileSync(join(SCHEMA_DIR, `${name}.json`), 'utf8'));
}
const sourceIdToEnv = {};
for (const [env, s] of Object.entries(schemas)) sourceIdToEnv[s.id.replace(/-/g, '')] = env;

// ---- sanitize a property definition for create/patch calls ----
function cleanOptions(cfg) {
  if (!cfg || !Array.isArray(cfg.options)) return cfg;
  return { options: cfg.options.map(({ name, color }) => ({ name, ...(color && color !== 'default' ? { color } : {}) })) };
}
function plainPropDef(p) {
  const t = p.type;
  let cfg = p[t] ?? {};
  if (t === 'select' || t === 'multi_select') cfg = cleanOptions(cfg);
  if (t === 'formula') cfg = { expression: cfg.expression };
  return { [t]: cfg };
}

const skipped = []; // strings describing anything not cloned faithfully
const issues = [];

async function main() {
  // ---- idempotency guard: abort if the preview page already exists ----
  const search = await notion('POST', 'search', {
    query: PARENT_TITLE, filter: { property: 'object', value: 'page' }, page_size: 25,
  });
  const existing = (search.results || []).find((pg) => {
    if (pg.archived) return false;
    const t = pg.properties?.title?.title ?? pg.properties?.Name?.title ?? [];
    return t.map((x) => x.plain_text).join('') === PARENT_TITLE;
  });
  if (existing) {
    console.error(`ABORT: a page named "${PARENT_TITLE}" already exists (${existing.id}). Delete/rename it or use the existing estate — not duplicating.`);
    process.exit(2);
  }

  // ---- find the parent page hosting the existing VF DBs (most common page_id parent) ----
  const parentCounts = {};
  for (const s of Object.values(schemas)) {
    if (s.parent?.type === 'page_id') parentCounts[s.parent.page_id] = (parentCounts[s.parent.page_id] || 0) + 1;
  }
  const candidates = Object.entries(parentCounts).sort((a, b) => b[1] - a[1]).map(([id]) => id);
  if (!candidates.length) { console.error('No page_id parent found in schema dumps'); process.exit(1); }

  // ---- create the per-village parent page (try candidates in order) ----
  let parentPage = null;
  for (const cand of candidates) {
    try {
      parentPage = await notion('POST', 'pages', {
        parent: { page_id: cand },
        properties: { title: { title: [{ text: { content: PARENT_TITLE } }] } },
        children: [{
          object: 'block', type: 'paragraph',
          paragraph: { rich_text: [{ text: { content: `Preview estate for ${villageName} (${slug}). Auto-provisioned clone of the VF DB set — mock/preview data only.` } }] },
        }],
      });
      break;
    } catch (e) {
      issues.push(`parent candidate ${cand} failed: ${e.message}`);
    }
  }
  if (!parentPage) { console.error('Could not create parent page under any candidate:\n' + issues.join('\n')); process.exit(1); }
  console.log(`parent page: ${parentPage.id}`);

  // ---- pass 1: create DBs with plain properties ----
  const envVars = {};               // env var -> new db id
  const deferredRelations = [];     // { env, propName, def }
  const deferredRollups = [];       // { env, propName, def }

  for (const env of DB_SET) {
    const s = schemas[env];
    const props = {};
    for (const [name, p] of Object.entries(s.properties)) {
      if (p.type === 'relation') { deferredRelations.push({ env, propName: name, def: p }); continue; }
      if (p.type === 'rollup') { deferredRollups.push({ env, propName: name, def: p }); continue; }
      props[name] = plainPropDef(p);
    }
    const body = {
      parent: { type: 'page_id', page_id: parentPage.id },
      title: [{ text: { content: `${villageName} — ${s.title}` } }],
      properties: props,
    };
    let db;
    try {
      db = await notion('POST', 'databases', body);
    } catch (e) {
      // retry without formula props if a formula expression is rejected
      const formulaNames = Object.entries(s.properties).filter(([, p]) => p.type === 'formula').map(([n]) => n);
      if (!formulaNames.length) throw e;
      for (const n of formulaNames) delete body.properties[n];
      db = await notion('POST', 'databases', body);
      for (const n of formulaNames) skipped.push(`${env}.${n} (formula dropped: ${e.message.slice(0, 160)})`);
    }
    envVars[env] = db.id;
    console.log(`created ${env} -> ${db.id} (${Object.keys(body.properties).length} props)`);
  }

  // ---- pass 2: relations remapped to this village's clones ----
  for (const { env, propName, def } of deferredRelations) {
    const rel = def.relation;
    const targetEnv = sourceIdToEnv[(rel.database_id || '').replace(/-/g, '')];
    const targetId = targetEnv ? envVars[targetEnv] : rel.database_id; // outside cloned set -> keep original
    if (!targetEnv) skipped.push(`${env}.${propName} (relation kept pointing at external DB ${rel.database_id})`);
    const relBody = { database_id: targetId };
    if (rel.type === 'dual_property') { relBody.type = 'dual_property'; relBody.dual_property = {}; }
    else { relBody.type = 'single_property'; relBody.single_property = {}; }
    try {
      await notion('PATCH', `databases/${envVars[env]}`, { properties: { [propName]: { relation: relBody } } });
      console.log(`relation ${env}.${propName} -> ${targetEnv || 'external'}`);
    } catch (e) {
      skipped.push(`${env}.${propName} (relation failed: ${e.message.slice(0, 160)})`);
    }
  }

  // ---- pass 3: rollups over the patched relations ----
  for (const { env, propName, def } of deferredRollups) {
    const r = def.rollup;
    try {
      await notion('PATCH', `databases/${envVars[env]}`, {
        properties: { [propName]: { rollup: {
          relation_property_name: r.relation_property_name,
          rollup_property_name: r.rollup_property_name,
          function: r.function,
        } } },
      });
      console.log(`rollup ${env}.${propName} ok`);
    } catch (e) {
      skipped.push(`${env}.${propName} (rollup skipped: ${e.message.slice(0, 160)})`);
    }
  }

  // ---- env pack ----
  mkdirSync(ENVPACK_DIR, { recursive: true });
  const pack = { envVars, parentPageId: parentPage.id, skipped };
  writeFileSync(join(ENVPACK_DIR, `${slug}.json`), JSON.stringify(pack, null, 2));
  console.log(`envpack written: ${join(ENVPACK_DIR, `${slug}.json`)}`);
  if (skipped.length) console.log('skipped:\n  ' + skipped.join('\n  '));
  if (issues.length) console.log('issues:\n  ' + issues.join('\n  '));
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });

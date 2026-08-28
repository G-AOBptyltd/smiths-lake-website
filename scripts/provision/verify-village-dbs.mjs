#!/usr/bin/env node
/**
 * Verify cloned village DB estates: re-read each DB from the env packs,
 * confirm title carries the village prefix + source title, and that the
 * property count matches the source schema (minus any skipped props).
 * Usage: netlify dev:exec node scripts/provision/verify-village-dbs.mjs
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SCHEMA_DIR = '/Users/gregcollocott/.claude/jobs/2410b68e/tmp/provision/schemas';
const ENVPACK_DIR = '/Users/gregcollocott/.claude/jobs/2410b68e/tmp/provision/envpacks';
const VILLAGES = [
  { slug: 'coomba-park', name: 'Coomba Park' },
  { slug: 'seal-rocks', name: 'Seal Rocks' },
  { slug: 'burrell-creek', name: 'Burrell Creek' },
];

const KEY = process.env.NOTION_API_KEY;
if (!KEY) { console.error('NOTION_API_KEY not in env'); process.exit(1); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getDb(id) {
  await sleep(400);
  const r = await fetch(`https://api.notion.com/v1/databases/${id}`, {
    headers: { Authorization: `Bearer ${KEY}`, 'Notion-Version': '2022-06-28' },
  });
  if (!r.ok) throw new Error(`${id}: ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

let failures = 0;
for (const v of VILLAGES) {
  const pack = JSON.parse(readFileSync(join(ENVPACK_DIR, `${v.slug}.json`), 'utf8'));
  console.log(`\n== ${v.name} (parent ${pack.parentPageId}) ==`);
  for (const [env, id] of Object.entries(pack.envVars)) {
    const src = JSON.parse(readFileSync(join(SCHEMA_DIR, `${env}.json`), 'utf8'));
    const skippedHere = pack.skipped.filter((s) => s.startsWith(`${env}.`)).length;
    const expected = Object.keys(src.properties).length - skippedHere;
    try {
      const db = await getDb(id);
      const title = (db.title || []).map((t) => t.plain_text).join('');
      const got = Object.keys(db.properties).length;
      const titleOk = title === `${v.name} — ${src.title}`;
      const countOk = got === expected;
      if (titleOk && countOk) console.log(`ok   ${env}: "${title}" props=${got}`);
      else { failures++; console.log(`FAIL ${env}: title="${title}" (want "${v.name} — ${src.title}") props=${got} (want ${expected})`); }
    } catch (e) {
      failures++; console.log(`FAIL ${env}: ${e.message}`);
    }
  }
}
console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL VERIFIED');
process.exit(failures ? 1 : 0);

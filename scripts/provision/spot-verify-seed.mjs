#!/usr/bin/env node
/**
 * Spot-verify seeded rows: for each ENV_VAR given, query the cloned DB from the
 * env pack and print row count + flattened property values (truncated).
 * Usage: netlify dev:exec node scripts/provision/spot-verify-seed.mjs <envpackPath> <ENV_VAR> [<ENV_VAR>...]
 */
import { readFileSync } from 'node:fs';

const [envpackPath, ...vars] = process.argv.slice(2);
const KEY = process.env.NOTION_API_KEY;
if (!KEY || !envpackPath || !vars.length) { console.error('usage: spot-verify-seed.mjs <envpackPath> <ENV_VAR>...'); process.exit(1); }
const pack = JSON.parse(readFileSync(envpackPath, 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function flat(p) {
  const t = p.type;
  const v = p[t];
  if (v == null) return null;
  switch (t) {
    case 'title': case 'rich_text': return v.map((x) => x.plain_text).join('') || null;
    case 'select': case 'status': return v.name;
    case 'multi_select': return v.map((x) => x.name);
    case 'date': return v.start;
    case 'number': case 'checkbox': case 'url': case 'email': case 'phone_number': return v;
    default: return undefined; // formula/rollup/relation etc — omit
  }
}

for (const env of vars) {
  const dbId = pack.envVars[env];
  await sleep(450);
  const r = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
    body: JSON.stringify({ page_size: 100 }),
  });
  const j = await r.json();
  if (!r.ok) { console.log(`${env}: ERROR ${r.status} ${JSON.stringify(j).slice(0, 200)}`); continue; }
  console.log(`\n### ${env} (${dbId}) — ${j.results.length} rows${j.has_more ? '+' : ''}`);
  for (const pg of j.results) {
    const out = {};
    for (const [name, prop] of Object.entries(pg.properties)) {
      const val = flat(prop);
      if (val !== undefined && val !== null && !(Array.isArray(val) && !val.length)) {
        out[name] = typeof val === 'string' && val.length > 90 ? val.slice(0, 90) + '…' : val;
      }
    }
    console.log(JSON.stringify(out));
  }
}

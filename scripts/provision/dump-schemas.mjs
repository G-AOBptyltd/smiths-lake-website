#!/usr/bin/env node
/**
 * Village factory — step 0: dump Notion DB schemas for cloning.
 * Run via `netlify dev:exec node scripts/provision/dump-schemas.mjs <outdir>`
 * so NOTION_API_KEY is injected in-process (never written to disk).
 * Output: one JSON per DB with title + property definitions (no row data, no secrets).
 */
const OUT = process.argv[2] || './provision-schemas';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const KEY = process.env.NOTION_API_KEY;
if (!KEY) { console.error('NOTION_API_KEY not in env — run under netlify dev:exec'); process.exit(1); }

// env var name -> [env value, code fallback] (fallbacks mirror netlify/functions/*)
const DBS = {
  NOTION_CONTENT_DB_ID:        [process.env.NOTION_CONTENT_DB_ID, '2cad508adfc1809d8438c8f3a5dd8d42'],
  NOTION_DATABASE_ID:          [process.env.NOTION_DATABASE_ID, null],
  NOTION_SECTION_SETTINGS_DB:  [process.env.NOTION_SECTION_SETTINGS_DB, null],
  NOTION_VF_VILLAGES_DB_ID:    [process.env.NOTION_VF_VILLAGES_DB_ID, '2c6272ccd9174103a077087c5de250d0'],
  NOTION_VF_SURVEYS_DB_ID:     [process.env.NOTION_VF_SURVEYS_DB_ID, 'dd226ceaec144baaac9fddc63a767596'],
  NOTION_MEMBERS_DB_ID:        [process.env.NOTION_MEMBERS_DB_ID, '494becca311c4d668a0f7f2750c08a74'],
  NOTION_VF_VOLUNTEERS_DB_ID:  [process.env.NOTION_VF_VOLUNTEERS_DB_ID, '3bfd508adfc181b88653c4c957393fd8'],
  NOTION_VF_STEWARDS_DB_ID:    [process.env.NOTION_VF_STEWARDS_DB_ID, null],
  NOTION_VF_ACTIVITIES_DB_ID:  [process.env.NOTION_VF_ACTIVITIES_DB_ID, null],
  NOTION_VF_EVENTS_DB_ID:      [process.env.NOTION_VF_EVENTS_DB_ID, '3bfd508adfc1814488d5f68e3f6e99b7'],
  NOTION_VF_EVENT_RSVPS_DB_ID: [process.env.NOTION_VF_EVENT_RSVPS_DB_ID, '3bfd508adfc181068154e994dfb5f285'],
  NOTION_VF_BOOKINGS_DB_ID:    [process.env.NOTION_VF_BOOKINGS_DB_ID, '3bfd508adfc1811fbdb9fc1c147a07ca'],
  NOTION_VF_FACILITIES_DB_ID:  [process.env.NOTION_VF_FACILITIES_DB_ID, '3bfd508adfc18115882be11adc1f7c01'],
  NOTION_VF_ADS_DB_ID:         [process.env.NOTION_VF_ADS_DB_ID, '3bfd508adfc181a290c1cb82448000d0'],
  NOTION_CONTRIB_DB_ID:        [process.env.NOTION_CONTRIB_DB_ID, '6d182a0d4f0c42c2879f13753e355861'],
  NOTION_COCON_PROJECTS_DB_ID: [process.env.NOTION_COCON_PROJECTS_DB_ID, null],
  NOTION_COCON_SCHEDULE_DB_ID: [process.env.NOTION_COCON_SCHEDULE_DB_ID, null],
  NOTION_COCON_BUDGET_DB_ID:   [process.env.NOTION_COCON_BUDGET_DB_ID, null],
  NOTION_VF_GRANTS_DB_ID:      [process.env.NOTION_VF_GRANTS_DB_ID, null],
};

async function notion(path) {
  const r = await fetch(`https://api.notion.com/v1/${path}`, {
    headers: { Authorization: `Bearer ${KEY}`, 'Notion-Version': '2022-06-28' },
  });
  if (!r.ok) throw new Error(`${path}: ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

mkdirSync(OUT, { recursive: true });
const summary = [];
for (const [name, [envVal, fallback]] of Object.entries(DBS)) {
  const id = envVal || fallback;
  if (!id) { summary.push({ name, status: 'no-id' }); continue; }
  try {
    const db = await notion(`databases/${id}`);
    const out = {
      envVar: name,
      id,
      title: (db.title || []).map(t => t.plain_text).join(''),
      parent: db.parent,
      properties: db.properties,
    };
    writeFileSync(join(OUT, `${name}.json`), JSON.stringify(out, null, 2));
    summary.push({ name, status: 'ok', title: out.title, props: Object.keys(db.properties).length });
  } catch (e) {
    summary.push({ name, status: 'error', error: String(e.message).slice(0, 160) });
  }
}
writeFileSync(join(OUT, '_summary.json'), JSON.stringify(summary, null, 2));
console.table(summary);

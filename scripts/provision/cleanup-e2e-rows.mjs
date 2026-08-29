#!/usr/bin/env node
// Archive today's E2E test rows (e2e-pilot@example.com) from the preview estates.
// Archiving (not deleting) — reversible in Notion trash for 30 days.
import { readFileSync } from 'node:fs';
const KEY = process.env.NOTION_API_KEY;
const DIR = process.argv[2];
const TARGETS = [
  { slug: 'coomba-park', env: 'NOTION_VF_VOLUNTEERS_DB_ID' },
  { slug: 'burrell-creek', env: 'NOTION_VF_BOOKINGS_DB_ID' },
];
for (const t of TARGETS) {
  const pack = JSON.parse(readFileSync(`${DIR}/${t.slug}.json`, 'utf8'));
  const db = pack.envVars[t.env];
  const q = await fetch(`https://api.notion.com/v1/databases/${db}/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
    body: JSON.stringify({ filter: { property: 'Email', email: { equals: 'e2e-pilot@example.com' } } }),
  }).then(r => r.json());
  for (const p of q.results || []) {
    const r = await fetch(`https://api.notion.com/v1/pages/${p.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${KEY}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
      body: JSON.stringify({ archived: true }),
    });
    console.log(`${t.slug}/${t.env}: archived ${p.id} → ${r.status}`);
    await new Promise(res => setTimeout(res, 400));
  }
  if (!(q.results || []).length) console.log(`${t.slug}/${t.env}: no test rows found`);
}

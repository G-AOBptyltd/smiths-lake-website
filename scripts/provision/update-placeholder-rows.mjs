#!/usr/bin/env node
// One-shot: fill the two pre-existing empty placeholder registry rows (Coomba Park, Seal Rocks)
// with their Preview pilot data. Before-state (29 Aug 2026): status=suspended, all other fields empty.
import { readFileSync } from 'node:fs';
const KEY = process.env.NOTION_API_KEY;
const DIR = process.argv[2];
const ROWS = [
  { pageId: '377d508a-dfc1-8147-b17f-ede281927d59', slug: 'coomba-park', name: 'Coomba Park',
    pkg: 'Interactive', pub: ['events'], url: 'https://coomba-park-preview.netlify.app' },
  { pageId: '3c8d508a-dfc1-8152-9e25-d2e1aa41e154', slug: 'seal-rocks', name: 'Seal Rocks',
    pkg: 'Foundation', pub: [], url: 'https://seal-rocks-preview.netlify.app' },
];
const ALL_MODULES = ['surveys','news','publish','contrib','cocon','members','volunteers','bookings','events'];
for (const v of ROWS) {
  const pack = JSON.parse(readFileSync(`${DIR}/${v.slug}.json`, 'utf8'));
  const contentDbId = pack.envVars.NOTION_CONTENT_DB_ID.replace(/-/g, '');
  const r = await fetch(`https://api.notion.com/v1/pages/${v.pageId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${KEY}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
    body: JSON.stringify({ properties: {
      'Status': { select: { name: 'Preview' } },
      'Package': { select: { name: v.pkg } },
      'Content DB ID': { rich_text: [{ text: { content: contentDbId } }] },
      'Site URL': { rich_text: [{ text: { content: v.url } }] },
      'Modules': { multi_select: ALL_MODULES.map(name => ({ name })) },
      'Public Modules': { multi_select: v.pub.map(name => ({ name })) },
      'Notes': { rich_text: [{ text: { content: `PILOT PREVIEW filled 29 Aug 2026 by the village factory (row pre-existed as empty suspended placeholder). Concept mock-up — not affiliated with any local organisation. Own isolated DB estate under "V1st Preview — ${v.name}".` } }] },
    } }),
  });
  if (!r.ok) throw new Error(`${v.name}: ${r.status} ${(await r.text()).slice(0, 200)}`);
  console.log(`updated: ${v.name} (${v.pkg}, public: ${v.pub.join('+') || 'none'})`);
  await new Promise(res => setTimeout(res, 400));
}

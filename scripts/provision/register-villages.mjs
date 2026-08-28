#!/usr/bin/env node
/**
 * Village factory — register preview villages in the shared VF Villages registry.
 * Run via `netlify dev:exec node scripts/provision/register-villages.mjs <envpacks-dir>`
 * Idempotent: skips a village whose registry row already exists.
 */
import { readFileSync } from 'node:fs';
const KEY = process.env.NOTION_API_KEY;
const DB = process.env.NOTION_VF_VILLAGES_DB_ID || '2c6272ccd9174103a077087c5de250d0';
const DIR = process.argv[2];
if (!KEY || !DIR) { console.error('need NOTION_API_KEY (dev:exec) and envpacks dir arg'); process.exit(1); }

const VILLAGES = [
  { slug: 'coomba-park', name: 'Coomba Park', pkg: 'Interactive', pub: ['events'],
    url: 'https://coomba-park-preview.netlify.app', hook: process.env.HOOK_COOMBA || null },
  { slug: 'seal-rocks', name: 'Seal Rocks', pkg: 'Foundation', pub: [],
    url: 'https://seal-rocks-preview.netlify.app', hook: process.env.HOOK_SEAL || null },
  { slug: 'burrell-creek', name: 'Burrell Creek', pkg: 'Complete', pub: ['events', 'bookings'],
    url: 'https://burrell-creek-preview.netlify.app', hook: process.env.HOOK_BURRELL || null },
];
const ALL_MODULES = ['surveys','news','publish','contrib','cocon','members','volunteers','bookings','events'];

async function notion(path, method = 'GET', body) {
  const r = await fetch(`https://api.notion.com/v1/${path}`, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${path}: ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

for (const v of VILLAGES) {
  const existing = await notion(`databases/${DB}/query`, 'POST', {
    filter: { property: 'Village Name', title: { equals: v.name } }, page_size: 1 });
  if (existing.results.length) { console.log(`skip (exists): ${v.name}`); continue; }
  const pack = JSON.parse(readFileSync(`${DIR}/${v.slug}.json`, 'utf8'));
  const contentDbId = pack.envVars.NOTION_CONTENT_DB_ID.replace(/-/g, '');
  const props = {
    'Village Name': { title: [{ text: { content: v.name } }] },
    'Status': { select: { name: 'Preview' } },
    'Package': { select: { name: v.pkg } },
    'Content DB ID': { rich_text: [{ text: { content: contentDbId } }] },
    'Site URL': { rich_text: [{ text: { content: v.url } }] },
    'Modules': { multi_select: ALL_MODULES.map(name => ({ name })) },
    'Public Modules': { multi_select: v.pub.map(name => ({ name })) },
    'Notes': { rich_text: [{ text: { content: `PILOT PREVIEW village created 29 Aug 2026 by the village factory. Concept mock-up — not affiliated with any local organisation. Own isolated DB estate under "V1st Preview — ${v.name}".` } }] },
  };
  if (v.hook) props['News Build Hook'] = { url: v.hook };
  await notion('pages', 'POST', { parent: { database_id: DB }, properties: props });
  console.log(`registered: ${v.name} (${v.pkg}, public: ${v.pub.join('+') || 'none'})`);
  await new Promise(r => setTimeout(r, 400));
}
console.log('done');

// Audit: every function that talks to Notion must reach the rate-limit guard,
// either by importing it directly or through a shared module that does.
// Exits non-zero if any call site is unprotected, so this can gate a build.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'netlify/functions';
const SHARED = ['_auth.js', '_stewards.js', '_projects.js'];

const files = readdirSync(DIR).filter((f) => f.endsWith('.js'));
const src = Object.fromEntries(files.map((f) => [f, readFileSync(join(DIR, f), 'utf8')]));
const guardedDirectly = new Set(files.filter((f) => src[f].includes("_notion-guard.js") && f !== '_notion-guard.js'));

const callsNotion = files.filter((f) => f !== '_notion-guard.js' && src[f].includes('api.notion.com'));
const unguarded = callsNotion.filter((f) => {
  if (guardedDirectly.has(f)) return false;
  return !SHARED.some((s) => src[f].includes(`./${s}`) && guardedDirectly.has(s));
});

console.log(`Notion call sites: ${callsNotion.length}`);
console.log(`Guarded directly:  ${guardedDirectly.size}`);
console.log(`Unprotected:       ${unguarded.length}`);
for (const f of unguarded) console.log('  !', f);
process.exit(unguarded.length ? 1 : 0);

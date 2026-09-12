// One-off: add the side-effect import of _notion-guard.js to every module that
// talks to Notion but does not already reach the guard through a shared import.
// Kept in the repo so the same sweep can be re-run if a new function is added.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'netlify/functions';
const GUARD = "import './_notion-guard.js';";
const NOTE = '// Rate-limit guard for api.notion.com. Side-effect import — see the file.\n';
const SHARED = ['_auth.js', '_stewards.js', '_projects.js'];

const files = readdirSync(DIR).filter((f) => f.endsWith('.js'));
const reaches = (src) => SHARED.some((s) => src.includes(`./${s}`));

let added = 0;
for (const f of files) {
  if (f === '_notion-guard.js') continue;
  const path = join(DIR, f);
  const src = readFileSync(path, 'utf8');
  if (!src.includes('api.notion.com')) continue;
  if (src.includes('_notion-guard')) continue;
  // Shared modules always get it; others only if they can't reach it already.
  if (!SHARED.includes(f) && reaches(src)) continue;

  let out;
  const m = src.match(/^import .*?;$/m);
  if (m) {
    const at = src.indexOf(m[0]);
    out = src.slice(0, at) + NOTE + GUARD + '\n' + src.slice(at);
  } else {
    const lead = src.match(/^\s*\/\*\*[\s\S]*?\*\/\s*/);
    const at = lead ? lead[0].length : 0;
    out = src.slice(0, at) + NOTE + GUARD + '\n\n' + src.slice(at);
  }
  writeFileSync(path, out);
  added += 1;
  console.log('guarded', f);
}
console.log(`\n${added} file(s) updated`);

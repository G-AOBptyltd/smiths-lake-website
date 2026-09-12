// Parse-check every Netlify function. A syntax error in one of these is a 502
// at runtime with no build failure to warn you, so it is worth a cheap sweep
// after any bulk edit.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const DIR = 'netlify/functions';
const files = readdirSync(DIR).filter((f) => f.endsWith('.js') || f.endsWith('.mjs'));
let bad = 0;
for (const f of files) {
  try {
    execFileSync(process.execPath, ['--check', join(DIR, f)], { stdio: 'pipe' });
  } catch (err) {
    bad += 1;
    console.log(`FAIL ${f}\n${String(err.stderr || err).slice(0, 400)}`);
  }
}
console.log(`\nchecked ${files.length} files — ${bad} failed`);
void pathToFileURL;
process.exit(bad ? 1 : 0);

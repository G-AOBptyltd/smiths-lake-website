// Bundle every Netlify function with esbuild — the same thing Netlify does.
//
// WHY THIS EXISTS, not just `node --check`. On 13 Sep 2026 a function shipped
// that assigned to a `const` loop binding. `node --check` accepts it; esbuild
// REFUSES it. Netlify then shipped the file unbundled, Lambda ran it as
// CommonJS, and the only symptom was a runtime 502:
//   "SyntaxError: Cannot use import statement outside a module"
// The build itself went green. Nothing warned anyone.
//
// So: parse-checking is not enough. Bundle-check.
// Run: node scripts/check-functions-bundle.mjs
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'esbuild';

const DIR = 'netlify/functions';
// Leading-underscore files are shared helpers, not deployed entry points, but
// they are bundled INTO the functions that import them — so an error in one
// surfaces there anyway. Checking entry points alone is sufficient and fast.
const entries = readdirSync(DIR)
  .filter((f) => (f.endsWith('.js') || f.endsWith('.mjs')) && !f.startsWith('_'));

let failed = 0;
for (const f of entries) {
  try {
    await build({
      entryPoints: [join(DIR, f)],
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node20',
      write: false,
      logLevel: 'silent',
      external: ['@notionhq/client', 'googleapis', '@netlify/blobs'],
    });
  } catch (err) {
    failed += 1;
    const msg = (err.errors || []).map((e) => `${e.location?.file}:${e.location?.line} ${e.text}`).join('\n    ');
    console.log(`FAIL ${f}\n    ${msg || err.message}`);
  }
}
console.log(`\nbundled ${entries.length} entry points — ${failed} failed`);
process.exit(failed ? 1 : 0);

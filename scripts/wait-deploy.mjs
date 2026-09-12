// Wait until the newest main-branch Netlify deploy is actually "ready".
// Polling a string in the HTML is not proof a given PR shipped — a marker from
// an earlier merge will happily match. Ask Netlify for the deploy state.
import { execFileSync } from 'node:child_process';

const SITE = process.argv[2] || '55e6fbf8-d466-4209-aebd-e1cd1c27fdbb';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function latestMain() {
  const out = execFileSync('netlify', [
    'api', 'listSiteDeploys', '--data', JSON.stringify({ site_id: SITE, per_page: 10 }),
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const main = JSON.parse(out).filter((d) => d.branch === 'main');
  return main[0] || null;
}

for (let i = 0; i < 40; i += 1) {
  const d = latestMain();
  if (!d) { console.log('no main deploy found'); break; }
  const line = `${d.state}  ${String(d.title).slice(0, 60)}`;
  if (d.state === 'ready') { console.log(`READY  ${line}`); process.exit(0); }
  if (d.state === 'error') { console.log(`FAILED ${line}`); process.exit(1); }
  console.log(`${i}: ${line}`);
  await sleep(15000);
}
console.log('timed out waiting');
process.exit(1);

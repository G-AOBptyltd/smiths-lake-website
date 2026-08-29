// Prune Village Dist Script
// Runs as the LAST step of `npm run build` (after `astro build`).
//
// Purpose: legacy Smiths Lake / Blueys Beach static artifacts live under
// public/ and are copied verbatim into dist/ on every build. They must NOT
// ship on non-default village builds (Coomba Park / Seal Rocks / Burrell
// Creek preview sites deploy from this branch via env vars).
//
// PARITY INVARIANT: on the default build (PUBLIC_VILLAGE_NAME unset, or set
// to 'Smiths Lake') this script deletes and rewrites NOTHING and exits 0 —
// zero impact on today's Smiths Lake output.

import fs from 'fs';
import path from 'path';

const villageName = process.env.PUBLIC_VILLAGE_NAME;
const isDefaultBuild = !villageName || villageName === 'Smiths Lake';

const distDir = path.join(process.cwd(), 'dist');

// Paths (relative to dist/) that are inherently Smiths Lake / Blueys Beach
// specific and must not ship on other villages' builds. Directories are
// removed recursively.
const PRUNE_PATHS = [
  // Blueys Beach 2026 conjoint survey + published results archives
  'surveys/blueys-beach-survey.html',
  'results/blueys-beach-results-21april2026.html',
  'results/blueys-beach-results-27april2026.html',
  // Smiths Lake worked-example demo prototype (community profile input).
  // NOTE: linked from /emergency/ ("community profile" button) — that link
  // is gated/owned by the emergency-page arm.
  'demo',
];

function pruneArtifacts() {
  let removed = 0;
  for (const rel of PRUNE_PATHS) {
    const target = path.join(distDir, rel);
    if (fs.existsSync(target)) {
      fs.rmSync(target, { recursive: true, force: true });
      console.log(`✂️  Pruned dist/${rel}`);
      removed++;
    } else {
      console.log(`•  dist/${rel} not present — skipped`);
    }
  }
  return removed;
}

// dist/site.webmanifest is a static copy of public/site.webmanifest and
// hard-codes "Smiths Lake Village" branding (shows in add-to-homescreen /
// PWA UI). Static files can't read build env, so rewrite it here for
// non-default villages using the same PUBLIC_* values the site config uses.
function rewriteWebmanifest() {
  const target = path.join(distDir, 'site.webmanifest');
  if (!fs.existsSync(target)) return;
  try {
    const manifest = JSON.parse(fs.readFileSync(target, 'utf8'));
    const displayName = process.env.PUBLIC_VILLAGE_DISPLAY_NAME || villageName;
    manifest.name = process.env.PUBLIC_SITE_TITLE || `${villageName} Village`;
    manifest.short_name = villageName;
    manifest.description = `Official community website for ${displayName}`;
    fs.writeFileSync(target, JSON.stringify(manifest, null, 2) + '\n');
    console.log(`✏️  Rewrote dist/site.webmanifest for ${villageName}`);
  } catch (err) {
    console.warn(`⚠️  Could not rewrite dist/site.webmanifest: ${err.message}`);
  }
}

// dist/robots.txt opens with a "# Smiths Lake Village Community Website"
// comment and hard-codes villagefirst.org.au (header + Sitemap directive) —
// invisible in the UI but still wrong-village strings served at a public
// URL. Swap only those literals; leave the directives otherwise untouched.
// PUBLIC_SITE_URL is the same env astro.config.mjs uses for `site`.
function rewriteRobots() {
  const target = path.join(distDir, 'robots.txt');
  if (!fs.existsSync(target)) return;
  try {
    const original = fs.readFileSync(target, 'utf8');
    let updated = original.replace(
      /^# Smiths Lake Village Community Website$/m,
      `# ${villageName} Village Community Website`
    );
    const siteUrl = (process.env.PUBLIC_SITE_URL || '').replace(/\/+$/, '');
    if (siteUrl) {
      updated = updated.replaceAll('https://villagefirst.org.au', siteUrl);
    }
    if (updated !== original) {
      fs.writeFileSync(target, updated);
      console.log(`✏️  Rewrote dist/robots.txt header comment for ${villageName}`);
    }
  } catch (err) {
    console.warn(`⚠️  Could not rewrite dist/robots.txt: ${err.message}`);
  }
}

// dist/results/index.html is the static results-hub shell (copied verbatim
// from public/). Its inline JS falls back to 'Smiths Lake' wherever no
// ?village= param / survey.village value is present — so on a village build,
// visiting /results/ with no param renders the Smiths Lake hub. Swap the
// fallback literal to this build's village. Verified: the only 'Smiths Lake'
// occurrences in the file are these identical fallback literals.
function rewriteResultsHub() {
  const target = path.join(distDir, 'results', 'index.html');
  if (!fs.existsSync(target)) return;
  try {
    const original = fs.readFileSync(target, 'utf8');
    const updated = original.replaceAll("'Smiths Lake'", `'${villageName.replaceAll("'", "\\'")}'`);
    if (updated !== original) {
      fs.writeFileSync(target, updated);
      console.log(`✏️  Rewrote dist/results/index.html village fallback for ${villageName}`);
    }
  } catch (err) {
    console.warn(`⚠️  Could not rewrite dist/results/index.html: ${err.message}`);
  }
}

// dist/js/survey-engine.js (static runtime asset, copied verbatim from
// public/) hard-codes "PPCA" in rendered survey chrome: "The ${village} PPCA
// committee will review…", the "${village} PPCA" meta line, and two default
// placeholder strings. PPCA is the Smiths Lake entity only — on village
// builds swap the word for the neutral "community" ("The Coomba Park
// community committee will review…"). Verified: "PPCA" appears in this file
// ONLY in those four user-facing strings, so a whole-word swap is safe.
function rewriteSurveyEngine() {
  const target = path.join(distDir, 'js', 'survey-engine.js');
  if (!fs.existsSync(target)) return;
  try {
    const original = fs.readFileSync(target, 'utf8');
    const updated = original.replaceAll('PPCA', 'community');
    if (updated !== original) {
      fs.writeFileSync(target, updated);
      console.log('✏️  Rewrote dist/js/survey-engine.js PPCA strings → "community"');
    }
  } catch (err) {
    console.warn(`⚠️  Could not rewrite dist/js/survey-engine.js: ${err.message}`);
  }
}

function main() {
  if (isDefaultBuild) {
    console.log('🌿 prune-village-dist: default (Smiths Lake) build — nothing pruned.');
    return;
  }

  if (!fs.existsSync(distDir)) {
    console.error('❌ prune-village-dist: dist/ not found — run after `astro build`.');
    process.exit(1);
  }

  console.log(`🌿 prune-village-dist: village build "${villageName}" — removing legacy Smiths Lake / Blueys Beach artifacts…`);
  const removed = pruneArtifacts();
  rewriteWebmanifest();
  rewriteRobots();
  rewriteResultsHub();
  rewriteSurveyEngine();
  console.log(`✅ prune-village-dist: done (${removed} path(s) removed).`);
}

main();

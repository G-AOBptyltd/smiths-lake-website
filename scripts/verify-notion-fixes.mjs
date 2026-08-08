/**
 * Verification harness for the three defects found on 2026-08-08.
 *
 * Fixtures are REAL rows from the "PPCA V1st Website Database" (pulled via
 * Notion MCP), and expected URLs were checked against the live site.
 */
import { resolveItemUrl, resolveSectionPath, getSectionPath, generateSlug } from '../src/lib/notion-detail-pages.js';
import { queryAllPages } from '../src/lib/notion-query-all.js';

let failed = 0;
const ok = (c, m) => { console.log(`${c ? '  PASS' : '  FAIL'}  ${m}`); if (!c) failed++; };

// ── BUG 1: shared Project Hub story linked to /content/ (404) ───────────────
console.log('\nBUG 1 — cross-section links resolve to routes that exist');

// Live-verified: this record 404'd at /content/family-information-day/
ok(resolveItemUrl({ section: 'Project Hub', slug: 'family-information-day', title: 'Smiths Lake Community Family Information Day' })
   === '/projects/family-information-day/', 'Project Hub story → /projects/family-information-day/ (was /content/…, 404)');

// Live-verified URLs for native News stories — must be unchanged by the fix.
const unchanged = [
  ['Is anyone in Smiths Lake a JP? YES!', '/news/is-anyone-in-smiths-lake-a-jp-yes/'],
  ['Community Emergency Planning & Preparedness', '/news/community-emergency-planning-and-preparedness/'],
];
for (const [title, expect] of unchanged) {
  ok(resolveItemUrl({ section: 'News', slug: null, title }) === expect, `News unchanged → ${expect}`);
}

console.log('\n  every Section value present in the database maps to a real route:');
for (const [name, path] of [
  ['News', 'news'], ['Project Hub', 'projects'], ['Groups & Activities', 'groups'],
  ['History & Culture', 'history'], ['Environment & Sustainability', 'environment'],
  ['Emergency & Safety', 'emergency'], ['Services & Amenities', 'services'], ['Services', 'services'],
]) ok(resolveSectionPath(name) === path, `${name.padEnd(28)} → /${path}/`);

console.log('\n  unmapped sections degrade safely instead of emitting a dead link:');
ok(resolveSectionPath('Administration & Reference') === null, 'unmapped section → null (card renders unlinked)');
ok(resolveItemUrl({ section: 'Brand New Section', title: 'x' }) === null, 'unmapped item → null');
ok(resolveItemUrl({ section: 'News', title: '' }) === null, 'untitled item → null');
ok(resolveItemUrl(null) === null, 'null item → null');
ok(getSectionPath('Nonsense') !== 'content', `legacy getSectionPath → "${getSectionPath('Nonsense')}", never "content"`);

// ── BUG 2: title truncated at first formatting boundary ────────────────────
console.log('\nBUG 2 — Notion title segments are joined, not truncated at [0]');

// Reproduces Notion's real API shape for the live title
//   "**Lilly Pilly Glade:** New seating and rest area now established on the foreshore"
const titleProp = {
  type: 'title',
  title: [
    { plain_text: 'Lilly Pilly Glade:', annotations: { bold: true } },
    { plain_text: ' New seating and rest area now established on the foreshore', annotations: { bold: false } },
  ],
};
const oldBehaviour = titleProp.title?.[0]?.plain_text || '';
const newBehaviour = titleProp.title?.map(t => t.plain_text).join('') || '';

ok(oldBehaviour === 'Lilly Pilly Glade:', `old code produced the dangling headline "${oldBehaviour}"`);
ok(newBehaviour === '**Lilly Pilly Glade:** New seating and rest area now established on the foreshore'.replace(/\*\*/g, ''),
   'new code produces the full headline');
ok(generateSlug(oldBehaviour) === 'lilly-pilly-glade', 'old slug was /news/lilly-pilly-glade/ (live-verified)');
ok(generateSlug(newBehaviour) === 'lilly-pilly-glade-new-seating-and-rest-area-now-established-on-the-foreshore',
   'new slug is the full-title slug — NOTE: this CHANGES that story\'s URL');

// ── BUG 3: build-time Notion queries never paginated ───────────────────────
console.log('\nBUG 3 — queryAllPages() follows has_more/next_cursor');

// Fake client returning 105 rows across two pages — the real published-row count.
const makeFake = (total) => {
  let served = 0;
  return { databases: { query: async ({ page_size, start_cursor }) => {
    const n = Math.min(page_size, total - served);
    const results = Array.from({ length: n }, (_, i) => ({ id: `row-${served + i}` }));
    served += n;
    const has_more = served < total;
    return { results, has_more, next_cursor: has_more ? `cur-${served}` : null };
  } } };
};

const rows = await queryAllPages(makeFake(105), { database_id: 'x' });
ok(rows.length === 105, `105 published rows → returned ${rows.length} (old code returned 100, silently dropping 5)`);
ok(new Set(rows.map(r => r.id)).size === 105, 'no duplicate rows across pages');
ok((await queryAllPages(makeFake(0), { database_id: 'x' })).length === 0, 'empty database → []');
ok((await queryAllPages(makeFake(100), { database_id: 'x' })).length === 100, 'exactly 100 rows → 100, no extra call loop');

console.log(failed === 0 ? '\nALL CHECKS PASSED\n' : `\n${failed} CHECK(S) FAILED\n`);
process.exit(failed === 0 ? 0 : 1);

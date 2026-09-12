// Tests for the volunteer-hours ledger maths (netlify/functions/_vledger.js).
//
// These numbers end up in grant acquittals, so the rules worth pinning are the
// ones that would quietly overstate a claim: a group counted under two
// projects, hours with no project to belong to, and a missing hour rate
// inventing a value. Run: node scripts/test-vledger.mjs

import { groupKeyOfPath, attachToProjects } from '../netlify/functions/_vledger.js';

let failed = 0;
const eq = (actual, expected, msg) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) { console.log(`      got:  ${JSON.stringify(actual)}\n      want: ${JSON.stringify(expected)}`); failed++; }
};

// ── group key: the join between a Notion card path and the app's group_id ──
eq(groupKeyOfPath('environment/landcare-bush-regeneration'), 'landcare-bush-regeneration',
  'card path resolves to the app group_id');
eq(groupKeyOfPath('/groups/pickle-ball/'), 'pickle-ball', 'stray slashes are tolerated');
eq(groupKeyOfPath(''), '', 'an empty path yields an empty key, not a crash');

// ── fixture ────────────────────────────────────────────────────────────────
const rows = [
  { groupKey: 'landcare-bush-regeneration', appHours: 10, activityHours: 6, totalHours: 16, firstWorked: '2026-08-01', lastWorked: '2026-09-07' },
  { groupKey: 'pickle-ball', appHours: 4, activityHours: 0, totalHours: 4, firstWorked: '2026-09-01', lastWorked: '2026-09-01' },
  { groupKey: 'book-clubs', appHours: 2, activityHours: 0, totalHours: 2, firstWorked: '2026-09-02', lastWorked: '2026-09-02' },
];
const projects = [
  { slug: 'dune-repair', name: 'Dune Repair', status: 'Active', hourRate: 45,
    volunteerGroups: [{ path: 'environment/landcare-bush-regeneration' }] },
  { slug: 'no-rate', name: 'No Rate Project', status: 'Active', hourRate: null,
    volunteerGroups: [{ path: 'groups/pickle-ball' }] },
];

const { perProject, unlinked, sharedGroups } = attachToProjects(rows, projects);

eq(perProject[0].totalHours, 16, 'project hours sum BOTH sources (app + working bee)');
eq(perProject[0].value, 720, 'in-kind value is hours x the project hour rate (16 x 45)');
eq(perProject[0].groups[0].appHours, 10, 'the two sources stay separately visible on the group');

// A project with no rate must value at zero and SAY so, rather than borrow a
// number from somewhere and quietly overstate a co-contribution.
eq(perProject[1].value, 0, 'no hour rate means no invented value');
eq(perProject[1].noRateSet, true, 'a missing rate is flagged, not hidden');

// Hours nobody has linked are the actionable gap — real effort no grant can
// currently evidence. They must never silently vanish.
eq(unlinked.map((u) => u.groupKey), ['book-clubs'], 'unclaimed hours surface as unlinked');
eq(sharedGroups, [], 'nothing is shared in the simple case');

// ── the dangerous case: one group claimed by two projects ──────────────────
const shared = attachToProjects(rows, [
  ...projects,
  { slug: 'second', name: 'Second Project', status: 'Active', hourRate: 30,
    volunteerGroups: [{ path: 'environment/landcare-bush-regeneration' }] },
]);
eq(shared.sharedGroups, [{ groupKey: 'landcare-bush-regeneration', projects: ['Dune Repair', 'Second Project'] }],
  'a group claimed twice is reported so the same hour is not claimed against two grants');
eq(shared.unlinked.map((u) => u.groupKey), ['book-clubs'],
  'sharing does not disturb the unlinked set');

// ── a village fallback rate applies only where a project has none ──────────
const withFallback = attachToProjects(rows, projects, { villageRate: 20 });
eq(withFallback.perProject[0].hourRate, 45, 'a project rate beats the village fallback');
eq(withFallback.perProject[1].hourRate, 20, 'the village fallback fills a missing project rate');
eq(withFallback.perProject[1].rateFromVillageDefault, true, 'using the fallback is disclosed');

// A project linked to a group with no hours yet should report zero, not drop
// the group — "we linked it and nobody has turned up" is worth seeing.
eq(attachToProjects([], projects).perProject[0].groups,
  [{ groupKey: 'landcare-bush-regeneration', totalHours: 0, appHours: 0, activityHours: 0, noHoursYet: true }],
  'a linked group with no hours is shown as zero, not omitted');

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);

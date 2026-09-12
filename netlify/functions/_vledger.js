/**
 * _vledger.js — the volunteer-hours ledger: one honest number per group.
 *
 * WHY THIS EXISTS. Volunteer effort is recorded in two places and, until now,
 * only one of them counted towards anything:
 *
 *   1. Notion "VF Activities" — a steward logs a working bee at a desk with an
 *      attendance list. `aggregateVolunteers()` in _projects.js reads these
 *      (Confirmed | Pushed); they are what project exec numbers and grant
 *      co-contribution valuations have always been based on.
 *   2. Supabase `hours` — a volunteer taps in and out in the app and their
 *      steward approves it. Nothing outside the app ever read these, so every
 *      approved app hour was invisible to projects, grants and
 *      co-contribution.
 *
 * This module reads both and returns one set of per-group totals.
 *
 * ⚠️ DOUBLE-COUNTING. This site mirrors each saved Notion activity's
 * attendance into Supabase `hours` (see _vapp.js), stamping `source_ref` with
 * the activity's page id. Those rows are the SAME effort as the activity they
 * came from, so summing both sources naively counts a working bee twice — and
 * this feeds grant claims, so that matters. Mirrored rows are excluded here:
 * `source_ref is null` keeps only hours the app itself originated.
 *
 * Only APPROVED hours count. Pending hours are a claim, not evidence, and
 * rejected hours are a refused claim. The steward approval gate is the control
 * that makes this defensible to a funder.
 */

import { normPath, ACTIVITIES_DB_ID, queryAll, parseActivity } from './_stewards.js';
import { supa, vappConfigured, slugVillage } from './_vapp.js';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** A steward card path is "environment/landcare-…"; the app's group_id is the
 *  last segment. This is the join between the two systems. */
export function groupKeyOfPath(p) {
  return normPath(p).split('/').pop() || '';
}

/**
 * Approved, app-originated hours for a village, keyed by the app's group_id.
 * Fail-open to an empty Map so a Supabase outage never silently blanks a
 * report the Notion side can still populate.
 */
export async function appHoursByGroup(village, { from, to } = {}) {
  const out = new Map();
  if (!vappConfigured()) return out;
  const vslug = slugVillage(village);
  let path = `hours?village_id=eq.${vslug}&status=eq.approved&source_ref=is.null`
    + '&select=id,volunteer_id,group_id,hours,worked_on,activity_type';
  if (from) path += `&worked_on=gte.${from}`;
  if (to) path += `&worked_on=lte.${to}`;
  try {
    const res = await supa(path);
    if (!res.ok || !Array.isArray(res.data)) return out;
    for (const r of res.data) {
      const key = r.group_id || '';
      if (!out.has(key)) out.set(key, { hours: 0, entries: 0, volunteerIds: new Set(), first: null, last: null });
      const g = out.get(key);
      g.hours = round2(g.hours + (Number(r.hours) || 0));
      g.entries += 1;
      if (r.volunteer_id) g.volunteerIds.add(r.volunteer_id);
      if (r.worked_on) {
        if (!g.first || r.worked_on < g.first) g.first = r.worked_on;
        if (!g.last || r.worked_on > g.last) g.last = r.worked_on;
      }
    }
  } catch (_) { /* fail-open */ }
  return out;
}

/**
 * Confirmed working-bee hours from the Notion activity ledger, keyed the same
 * way. Only Confirmed | Pushed count — a Draft activity is still being edited.
 */
export async function activityHoursByGroup(village, { from, to } = {}) {
  const out = new Map();
  if (!ACTIVITIES_DB_ID) return out;
  try {
    const rows = await queryAll(ACTIVITIES_DB_ID, { property: 'Village', rich_text: { equals: village } });
    for (const a of rows.map(parseActivity)) {
      if (a.status !== 'Confirmed' && a.status !== 'Pushed') continue;
      if (from && a.date && a.date < from) continue;
      if (to && a.date && a.date > to) continue;
      const key = groupKeyOfPath(a.cardPath);
      if (!out.has(key)) out.set(key, { hours: 0, activities: 0, people: new Set(), first: null, last: null });
      const g = out.get(key);
      g.hours = round2(g.hours + (Number(a.totalHours) || 0));
      g.activities += 1;
      for (const p of (a.attendance || [])) {
        const who = String(p?.volunteerId || p?.name || '').trim().toLowerCase();
        if (who) g.people.add(who);
      }
      if (a.date) {
        if (!g.first || a.date < g.first) g.first = a.date;
        if (!g.last || a.date > g.last) g.last = a.date;
      }
    }
  } catch (_) { /* fail-open */ }
  return out;
}

/**
 * Both sources, merged per group key. Each row keeps the two sources visible
 * rather than only their sum: when a grant acquittal is questioned, "which of
 * these hours came from a signed attendance sheet and which from the app?" is
 * the first question asked.
 */
export async function ledgerByGroup(village, range = {}) {
  const [app, act] = await Promise.all([
    appHoursByGroup(village, range),
    activityHoursByGroup(village, range),
  ]);
  const keys = new Set([...app.keys(), ...act.keys()].filter(Boolean));
  const rows = [];
  for (const key of keys) {
    const a = app.get(key);
    const n = act.get(key);
    const dates = [a?.first, a?.last, n?.first, n?.last].filter(Boolean).sort();
    rows.push({
      groupKey: key,
      appHours: round2(a?.hours || 0),
      appEntries: a?.entries || 0,
      appVolunteers: a?.volunteerIds.size || 0,
      activityHours: round2(n?.hours || 0),
      activityCount: n?.activities || 0,
      activityPeople: n?.people.size || 0,
      totalHours: round2((a?.hours || 0) + (n?.hours || 0)),
      firstWorked: dates[0] || null,
      lastWorked: dates[dates.length - 1] || null,
    });
  }
  rows.sort((x, y) => y.totalHours - x.totalHours);
  return rows;
}

/**
 * Attach each group's hours to the project(s) that claim it, and value them.
 *
 * A project lists its volunteer groups as card paths ("Volunteer Groups") and
 * carries a "Volunteer Hour Rate". Hours x rate is the in-kind figure a grant
 * acquittal reports. `villageRate` is only a fallback, and when it is used the
 * row says so — a rate silently invented by the software is worse than a
 * visible zero.
 *
 * A group linked to TWO projects is reported under both and named in
 * `sharedGroups`: the same hour must not be claimed against two grants, and
 * that is a human decision, not one to make quietly.
 */
export function attachToProjects(ledgerRows, projects, { villageRate = 0 } = {}) {
  const byKey = new Map(ledgerRows.map((r) => [r.groupKey, r]));
  const claimedBy = new Map();            // groupKey → [project name]

  const perProject = (projects || []).map((p) => {
    const keys = (p.volunteerGroups || []).map((g) => groupKeyOfPath(g?.path || g));
    const rate = Number(p.hourRate) || Number(villageRate) || 0;
    const groups = [];
    let hours = 0;
    for (const k of keys) {
      if (!k) continue;
      if (!claimedBy.has(k)) claimedBy.set(k, []);
      claimedBy.get(k).push(p.name);
      const row = byKey.get(k);
      if (!row) { groups.push({ groupKey: k, totalHours: 0, appHours: 0, activityHours: 0, noHoursYet: true }); continue; }
      hours = round2(hours + row.totalHours);
      groups.push(row);
    }
    return {
      slug: p.slug, name: p.name, status: p.status,
      grantProgram: p.grantProgram || null,
      grantRequestAmount: p.grantRequestAmount ?? null,
      hourRate: rate,
      rateFromVillageDefault: !Number(p.hourRate) && !!Number(villageRate),
      noRateSet: !rate,
      totalHours: hours,
      value: Math.round(hours * rate * 100) / 100,
      groups,
    };
  });

  // Hours whose group no project claims. This is the actionable gap: real
  // volunteer effort that no grant can currently evidence.
  const linked = new Set([...claimedBy.keys()]);
  const unlinked = ledgerRows.filter((r) => !linked.has(r.groupKey) && r.totalHours > 0);

  const sharedGroups = [...claimedBy.entries()]
    .filter(([, names]) => names.length > 1)
    .map(([groupKey, names]) => ({ groupKey, projects: names }));

  return { perProject, unlinked, sharedGroups };
}

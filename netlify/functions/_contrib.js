/**
 * _contrib.js — shared helpers for the Contributions ledger (donations,
 * pledges, time in kind, gifts, donated services).
 *
 * Files prefixed with "_" are NOT deployed as standalone endpoints by Netlify,
 * but can be imported by the other functions (esbuild inlines them).
 *
 * ── STORAGE: SUPABASE, NOT NOTION (Phase 3 of the PII plan, 14 Sep 2026) ────
 * A contribution row carries the contributor's name and an optional email or
 * phone ("contact"), plus the amount — personal data, which the platform keeps
 * in the Sydney Supabase project behind deny-by-default RLS, not in the shared
 * Notion workspace. See migration 0015 (village1st-volunteer-app repo).
 *
 * This is the first phase with real data to move: the Notion "VF Contributions"
 * DB held 13 committee-entered rows, migrated by the super-admin
 * /api/contrib-migrate endpoint (dry run → reconciliation count → commit).
 * The Notion DB id is kept below ONLY for that endpoint; no ledger read or
 * write touches Notion any more.
 *
 * Archive is `archived_at` (a soft delete), NOT a status. That fixes a small
 * bug in the Notion version, where restoring an archived entry forced it to
 * "Received"; now its real status (Pledged / Thanked) survives the round trip.
 *
 * Every endpoint keeps the same request/response shape as the Notion version
 * and parseContribution() returns the same field names, so /admin/contrib/,
 * /contribute/ and the public supporters board needed no functional change.
 * `pageId` in request bodies is now the row's uuid.
 */

import {
  selectVillage, selectOne, insertRow, updateRow, archiveRowById,
  supaConfigured, slugVillage, clean, money, dateOrNull, today, jsonResp, stampBy,
} from './_supa.js';

export { supaConfigured, slugVillage, clean, money, dateOrNull, today, jsonResp, stampBy };

export const T_CONTRIB = 'contributions';

// Mirrored by CHECK constraints in migration 0015 — change one, change both.
export const CONTRIB_TYPES = ['Money', 'Payment', 'Gift', 'Time in kind', 'Donated service'];
export const CONTRIB_STATUSES = ['Received', 'Pledged', 'Thanked'];
// What the PUBLIC /contribute/ form may offer ("Payment" is committee-only).
export const PUBLIC_TYPES = ['Money', 'Time in kind', 'Donated service', 'Gift'];

/**
 * The retired Notion "VF Contributions" DB — used by contrib-migrate.js ONLY.
 * grant-admin / profile-admin / volunteer-provision still read this DB's
 * PARENT PAGE to create sibling DBs, so the Notion DB is retired into an
 * archive page later, never deleted.
 */
export const CONTRIB_DB_ID = process.env.NOTION_CONTRIB_DB_ID || '6d182a0d4f0c42c2879f13753e355861';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v) => UUID_RE.test(String(v || ''));

/** A positive number rounded to two places, else null — the amount/hours rule. */
export function positive(v) {
  const n = money(v);
  return n != null && n > 0 ? n : null;
}

const numOrNull = (v) => (v == null ? null : Number(v));

/** Row → the object the ledger console has always received. */
export function parseContribution(r) {
  return {
    id: r.id,
    contributor: r.contributor || '(no name)',
    type: r.type || '',
    amount: numOrNull(r.amount),
    hours: numOrNull(r.hours),
    note: r.note || '',
    contact: r.contact || '',
    status: r.status || '',
    archived: !!r.archived_at,
    date: r.date || null,
    loggedBy: r.logged_by || '',
    lastUpdatedBy: r.last_updated_by || '',
    village: r.village_id || '',
    showPublicly: r.show_publicly === true,
    displayName: r.display_name || '',
  };
}

/**
 * The column map both writers share (public pledge + admin save), so the two
 * can never drift on caps or the ">0 else null" rule. village_id, status and
 * logged_by are the caller's business.
 */
export function contributionValues(b) {
  return {
    contributor: String(b.contributor || '').trim().slice(0, 200),
    type: CONTRIB_TYPES.includes(b.type) ? b.type : 'Money',
    amount: positive(b.amount),
    hours: positive(b.hours),
    note: clean(b.note, 2000),
    contact: clean(b.contact, 200),
    date: dateOrNull(b.date) || today(),
    // Opt-in to the public supporters board. Default false — silence is not consent.
    show_publicly: b.showPublicly === true || b.showPublicly === 'true',
    display_name: clean(b.displayName, 60),
  };
}

/* ── Direct PostgREST access for the two paths _supa.js deliberately hides ──
 * _supa.js filters `archived_at is null` on every read and update so a
 * soft-deleted record can never leak into a list by accident. The ledger is
 * the one console that SHOWS its archived rows (greyed, with Restore), so it
 * needs an archived-inclusive read and an un-archive write. Both live here,
 * scoped to the contributions table, rather than loosening the shared client.
 */
const SUPA_URL = process.env.VAPP_SUPABASE_URL;
const SUPA_KEY = process.env.VAPP_SUPABASE_SERVICE_KEY;
const enc = encodeURIComponent;

async function rawReq(path, opts = {}) {
  if (!supaConfigured()) {
    throw new Error('The contributions ledger stores its records in Supabase, which is not configured on this site (VAPP_SUPABASE_URL / VAPP_SUPABASE_SERVICE_KEY).');
  }
  const res = await fetch(`${SUPA_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SUPA_KEY,
      Authorization: `Bearer ${SUPA_KEY}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; }
  if (!res.ok) {
    // Never echo the row back — it may carry someone's contact details.
    const msg = (data && (data.message || data.hint)) || `Supabase responded ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return data;
}

const ORDER = 'date.desc,created_at.desc';

/**
 * Every contribution row for one village, newest first.
 * includeArchived=true also returns soft-deleted rows (archived=true) so the
 * ledger can show them greyed out with a Restore button.
 * `select` narrows the columns (the public board reads only what it needs).
 */
export async function listContributions(village, { includeArchived = false, select } = {}) {
  const extra = select ? `select=${enc(select)}` : undefined;
  if (!includeArchived) {
    const rows = await selectVillage(T_CONTRIB, village, { order: ORDER, extra });
    return rows.map(parseContribution);
  }
  const q = [
    `village_id=eq.${enc(slugVillage(village))}`,
    `order=${enc(ORDER)}`,
    ...(extra ? [extra] : []),
  ].join('&');
  const rows = await rawReq(`${T_CONTRIB}?${q}`);
  return (Array.isArray(rows) ? rows : []).map(parseContribution);
}

/**
 * One contribution, proven to belong to `village`. Replaces the Notion
 * parent-database check: without the village predicate an admin JWT from one
 * village could read or patch another village's entry by guessing a uuid.
 * Returns null for a non-uuid id (PostgREST would 400 on it), a foreign row,
 * or — unless includeArchived — an archived row.
 */
export async function getContribution(id, village, { includeArchived = false } = {}) {
  if (!isUuid(id)) return null;
  if (!includeArchived) {
    const row = await selectOne(T_CONTRIB, id, village);
    return row ? parseContribution(row) : null;
  }
  const q = [
    `id=eq.${enc(id)}`,
    `village_id=eq.${enc(slugVillage(village))}`,
    'limit=1',
  ].join('&');
  const rows = await rawReq(`${T_CONTRIB}?${q}`);
  return Array.isArray(rows) && rows.length ? parseContribution(rows[0]) : null;
}

export async function createContribution(values) { return insertRow(T_CONTRIB, values); }
export async function patchContribution(id, village, values) { return updateRow(T_CONTRIB, id, village, values); }
export async function archiveContribution(id, village) { return archiveRowById(T_CONTRIB, id, village); }

/** Un-archive: clears archived_at and leaves the real status untouched. */
export async function restoreContribution(id, village, values = {}) {
  if (!isUuid(id)) throw new Error('Contribution not found');
  const q = [
    `id=eq.${enc(id)}`,
    `village_id=eq.${enc(slugVillage(village))}`,
    'archived_at=not.is.null',
  ].join('&');
  await rawReq(`${T_CONTRIB}?${q}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ ...values, archived_at: null, updated_at: new Date().toISOString() }),
  });
}

/** Raw PostgREST access for the migrate endpoint's reconciliation reads/inserts. */
export const contribRaw = rawReq;

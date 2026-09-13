/**
 * _supa.js — the shared PostgREST client for VillageFirst modules whose records
 * belong in Supabase rather than Notion.
 *
 * WHY THIS EXISTS. Notion is the platform's CMS and is right for content a
 * committee edits like a document — news, services, project budgets. It is the
 * WRONG store for personal data: it is a shared workspace with broad human
 * access, no row-level security, and no residency guarantee. Anything carrying
 * a resident's name, address, phone, or why they are vulnerable belongs in the
 * Sydney Supabase project alongside volunteers and subscribers, behind
 * deny-by-default RLS.
 *
 * Every table reached through here is RLS-enabled with NO policies, so anon and
 * authenticated callers get nothing at all. These helpers use the SERVICE ROLE,
 * which bypasses RLS — so **every caller must re-check Netlify Identity role AND
 * village before calling in.** That check is the only thing standing between a
 * signed-in steward of one village and another village's data.
 *
 * Env (already set on villagefirst.org.au):
 *   VAPP_SUPABASE_URL          https://tzdpcowvhnryurgqtstx.supabase.co
 *   VAPP_SUPABASE_SERVICE_KEY  service_role key (server only, never shipped)
 *
 * Unlike _vapp.js — which is deliberately best-effort because Notion remained
 * its system of record — these helpers THROW on failure. For a module whose
 * system of record IS Supabase, silently swallowing a write would lose the
 * record, and in a recovery that could mean a household that asked for help
 * never appearing on anyone's list.
 */

const SUPA_URL = process.env.VAPP_SUPABASE_URL;
const SUPA_KEY = process.env.VAPP_SUPABASE_SERVICE_KEY;

export function supaConfigured() { return !!(SUPA_URL && SUPA_KEY); }

/** The tenant slug, identical to _vapp.js slugVillage — it is the partition key. */
export function slugVillage(v) {
  return String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function assertConfigured() {
  if (!supaConfigured()) {
    throw new Error('This module stores its records in Supabase, which is not configured on this site (VAPP_SUPABASE_URL / VAPP_SUPABASE_SERVICE_KEY).');
  }
}

async function req(path, opts = {}) {
  assertConfigured();
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
    // PostgREST puts the useful part in .message/.details; never echo the row back
    // in an error, because for these tables the row may be someone's personal data.
    const msg = (data && (data.message || data.hint)) || `Supabase responded ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

const enc = encodeURIComponent;

/**
 * Every live row of `table` for one village. Archived rows are excluded here so
 * no caller can forget: a soft-deleted record must never come back in a list.
 * `order` is a PostgREST order clause, e.g. 'start_date.desc.nullslast'.
 */
export async function selectVillage(table, village, { order, extra } = {}) {
  const q = [
    `village_id=eq.${enc(slugVillage(village))}`,
    'archived_at=is.null',
    ...(order ? [`order=${enc(order)}`] : []),
    ...(extra ? [extra] : []),
  ].join('&');
  const rows = await req(`${table}?${q}`);
  return Array.isArray(rows) ? rows : [];
}

/**
 * One row by id, proven to belong to `village` and not archived.
 *
 * This is the guard that replaces the Notion parent-database check: without the
 * village predicate, a signed-in admin of one village could read or write
 * another village's record by guessing a uuid. Every read-then-write path goes
 * through here first.
 */
export async function selectOne(table, id, village) {
  if (!id) return null;
  const q = [
    `id=eq.${enc(id)}`,
    'archived_at=is.null',
    ...(village ? [`village_id=eq.${enc(slugVillage(village))}`] : []),
    'limit=1',
  ].join('&');
  const rows = await req(`${table}?${q}`);
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

/** Insert and return the new row's id. */
export async function insertRow(table, values) {
  const rows = await req(table, {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(values),
  });
  const row = Array.isArray(rows) ? rows[0] : rows;
  if (!row || !row.id) throw new Error('Supabase accepted the insert but returned no row');
  return row.id;
}

/** Update a row, scoped to its village, always stamping updated_at. */
export async function updateRow(table, id, village, values) {
  const q = [
    `id=eq.${enc(id)}`,
    'archived_at=is.null',
    ...(village ? [`village_id=eq.${enc(slugVillage(village))}`] : []),
  ].join('&');
  await req(`${table}?${q}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ ...values, updated_at: new Date().toISOString() }),
  });
}

/**
 * Soft delete. Replaces Notion's recoverable trash: the row stays, every read
 * filters it out, and it can be brought back with one SQL update. A hard DELETE
 * is deliberately not offered — an accidental delete mid-recovery, or of a
 * trading record, should never be unrecoverable.
 */
export async function archiveRowById(table, id, village) {
  const q = [
    `id=eq.${enc(id)}`,
    ...(village ? [`village_id=eq.${enc(slugVillage(village))}`] : []),
  ].join('&');
  await req(`${table}?${q}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ archived_at: new Date().toISOString() }),
  });
}

/* ── Value coercion (shared by both modules) ─────────────────────────────── */

export const clean = (v, max) => {
  const s = String(v == null ? '' : v).trim().slice(0, max);
  return s === '' ? null : s;
};

/** A non-negative finite number, else null. */
export function num(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Money rounded to cents, else null. */
export function money(v) {
  const n = num(v);
  return n == null ? null : Math.round(n * 100) / 100;
}

/** An integer, else null. */
export function int(v) {
  const n = num(v);
  return n == null ? null : Math.round(n);
}

/** A date string PostgREST will accept, else null (never an empty string). */
export const dateOrNull = (v) => (v ? String(v).slice(0, 10) : null);

export const today = () => new Date().toISOString().slice(0, 10);

export function jsonResp(statusCode, obj) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}

export const csvCell = (v) => {
  const s = String(v == null ? '' : v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** "someone@example.org · 2026-09-13" — the audit stamp every write carries. */
export function stampBy(user) {
  return `${user?.email || 'admin'} · ${today()}`;
}

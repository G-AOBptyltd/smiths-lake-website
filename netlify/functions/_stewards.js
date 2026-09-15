/**
 * _stewards.js — shared helpers for the Volunteer hub functions.
 *
 * Files prefixed with "_" are NOT deployed as endpoints; they are inlined by
 * esbuild into the functions that import them.
 *
 * Permission model (network → village → card):
 *   - super-admin / "<village>:admin"  → everything in the village
 *   - "<village>:steward"              → portal entry; WHICH cards they can run
 *     comes from the VF Stewards register (one row per steward per village,
 *     Cards = JSON list of {path,title} where path is the site path of the
 *     card, e.g. "environment/landcare-and-bush-regeneration").
 *
 * The Identity role opens the door; the Stewards register scopes the rooms.
 *
 * ── STEWARD REGISTER: SUPABASE, NOT NOTION (PII plan Phase 3b, 15 Sep 2026) ──
 * A steward row is a person (name + email + the cards they lead), so it lives
 * in the Sydney Supabase project behind deny-by-default RLS — table `stewards`,
 * migration 0018 in the village1st-volunteer-app repo. The helpers in the
 * "Steward register" section below are the ONLY register I/O; resolveScope()
 * reads through them, so its eight callers needed no change. The Notion
 * "🧭 VF Stewards" DB id is kept solely for /api/steward-migrate.
 *
 * Two Notion DBs remain (created once by /api/volunteer-provision):
 *   VF Volunteers, VF Activities — all villages share each DB, scoped by the
 *   Village text column (same v1 model as the retired Contributions/Members).
 */

// Rate-limit guard for api.notion.com. Side-effect import — see the file.
import './_notion-guard.js';
import { hasRole, requireRole } from './_auth.js';
import {
  selectVillage, selectOne, insertRow, updateRow, archiveRowById,
  slugVillage, supaConfigured, today,
} from './_supa.js';

const NOTION_VERSION = '2022-06-28';

// Fallbacks = the DBs provisioned under the Smiths Lake Community page (Aug 2026).
// STEWARDS_DB_ID is retired — Supabase `stewards` since 15 Sep 2026. Exported
// for steward-migrate.js (and volunteer-provision's "already provisioned"
// check) only; no register read or write may use it.
export const STEWARDS_DB_ID = process.env.NOTION_VF_STEWARDS_DB_ID || '3bfd508adfc18193bbcee2e46817f988';
export const VOLUNTEERS_DB_ID = process.env.NOTION_VF_VOLUNTEERS_DB_ID || '3bfd508adfc181b88653c4c957393fd8';
export const ACTIVITIES_DB_ID = process.env.NOTION_VF_ACTIVITIES_DB_ID || '3bfd508adfc181fb8d09f877c9769c8a';

export const VOLUNTEER_STATUSES = ['Applied', 'Active', 'Inactive'];
export const ACTIVITY_STATUSES = ['Draft', 'Confirmed', 'Pushed'];

export function notionHeaders() {
  return {
    Authorization: `Bearer ${process.env.NOTION_API_KEY}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  };
}

export function jsonResp(statusCode, obj) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}

export function notProvisioned() {
  return jsonResp(503, { error: 'The Volunteer hub is not provisioned yet — run /api/volunteer-provision and set the DB id env vars.' });
}

// ── Rich-text helpers ─────────────────────────────────────────────
// Notion caps each rich_text segment at 2000 chars; JSON blobs (Cards,
// Attendance) are chunked across segments so bigger payloads round-trip.

export function rtChunks(str) {
  const s = String(str || '');
  if (!s) return [];
  const chunks = [];
  for (let i = 0; i < s.length; i += 1900) chunks.push({ text: { content: s.slice(i, i + 1900) } });
  return chunks;
}

export function rtText(prop) {
  return (prop?.rich_text || []).map((t) => t.plain_text).join('');
}

export function rtJson(prop, fallback) {
  try {
    const s = rtText(prop);
    return s ? JSON.parse(s) : fallback;
  } catch (_) { return fallback; }
}

/** Normalise a card path: "environment/landcare-..." — lowercase, no slashes at ends. */
export function normPath(p) {
  return String(p || '').trim().toLowerCase().replace(/^\/+|\/+$/g, '').slice(0, 200);
}

/** Merge a card into a card list (dedup by path). */
export function mergeCard(cards, card) {
  const list = Array.isArray(cards) ? cards.slice() : [];
  const path = normPath(card.path);
  if (!path) return list;
  if (!list.some((c) => normPath(c.path) === path)) {
    list.push({ path, title: String(card.title || path).slice(0, 200) });
  }
  return list;
}

// ── Notion query helper (paginates) ───────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Notion allows roughly three requests a second and answers 429 when you
 * exceed it. A paginated query over several databases trips that easily — the
 * volunteer ledger did on its first real use — and the old behaviour was to
 * throw the raw "Notion responded 429" straight at the user, who can do
 * nothing about it. Retry instead, honouring Retry-After when Notion sends
 * one, and give up only after several attempts.
 */
async function notionQueryPage(dbId, body, attempt = 0) {
  const res = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
    method: 'POST', headers: notionHeaders(), body: JSON.stringify(body),
  });
  if (res.ok) return res.json();
  const retryable = res.status === 429 || res.status >= 500;
  if (retryable && attempt < 4) {
    const hinted = Number(res.headers.get('retry-after')) * 1000;
    const backoff = Number.isFinite(hinted) && hinted > 0 ? hinted : 400 * (2 ** attempt);
    await sleep(Math.min(backoff, 5000));
    return notionQueryPage(dbId, body, attempt + 1);
  }
  throw new Error(res.status === 429
    ? 'Notion is rate-limiting us — please try again in a moment.'
    : `Notion responded ${res.status}`);
}

export async function queryAll(dbId, filter, sorts) {
  const results = [];
  let cursor;
  do {
    const data = await notionQueryPage(dbId, {
      ...(filter ? { filter } : {}),
      ...(sorts ? { sorts } : {}),
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    results.push(...data.results);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return results;
}

// ── Parsers ───────────────────────────────────────────────────────

/**
 * Notion page → steward. RETIRED with the register: kept ONLY so
 * steward-migrate.js can read the old "🧭 VF Stewards" pages. Live code uses
 * parseStewardRow (same keys) further down.
 */
export function parseSteward(page) {
  const p = page.properties || {};
  return {
    id: page.id,
    name: p.Steward?.title?.[0]?.plain_text || '',
    email: (p.Email?.email || '').toLowerCase(),
    village: rtText(p.Village),
    cards: rtJson(p.Cards, []),
    status: p.Status?.select?.name || 'Active',
    addedBy: rtText(p['Added By']),
    dateAdded: p['Date Added']?.date?.start || null,
  };
}

export function parseVolunteer(page) {
  const p = page.properties || {};
  return {
    id: page.id,
    name: p.Volunteer?.title?.[0]?.plain_text || '(no name)',
    firstName: rtText(p['First Name']),
    lastName: rtText(p['Last Name']),
    email: p.Email?.email || '',
    phone: p.Phone?.phone_number || '',
    village: rtText(p.Village),
    cards: rtJson(p.Cards, []),
    status: p.Status?.select?.name || 'Applied',
    isMember: !!p['PPCA Member']?.checkbox,
    message: rtText(p.Message),
    dateJoined: p['Date Joined']?.date?.start || null,
    loggedBy: rtText(p['Logged By']),
    lastUpdatedBy: rtText(p['Last Updated By']),
  };
}

export function parseActivity(page) {
  const p = page.properties || {};
  return {
    id: page.id,
    name: p.Activity?.title?.[0]?.plain_text || '(untitled)',
    village: rtText(p.Village),
    cardPath: normPath(rtText(p['Card Path'])),
    cardTitle: rtText(p['Card Title']),
    date: p.Date?.date?.start || null,
    description: rtText(p.Description),
    status: p.Status?.select?.name || 'Draft',
    attendance: rtJson(p.Attendance, []),
    totalHours: p['Total Hours']?.number ?? 0,
    location: rtText(p.Location),
    lat: p.Lat?.number ?? null,
    lng: p.Lng?.number ?? null,
    createdBy: rtText(p['Created By']),
    lastUpdatedBy: rtText(p['Last Updated By']),
    contributionId: rtText(p['Contribution ID']),
    note: rtText(p.Note),
  };
}

/**
 * Location fields were added after the Activities DB was first provisioned —
 * idempotent schema PATCH, same self-healing pattern as the Members module.
 */
let activitySchemaEnsured = null;
export function ensureActivitySchema() {
  if (!activitySchemaEnsured) {
    activitySchemaEnsured = fetch(`https://api.notion.com/v1/databases/${ACTIVITIES_DB_ID}`, {
      method: 'PATCH',
      headers: notionHeaders(),
      body: JSON.stringify({ properties: { 'Location': { rich_text: {} }, 'Lat': { number: {} }, 'Lng': { number: {} } } }),
    }).then((res) => {
      if (!res.ok) { activitySchemaEnsured = null; throw new Error(`Notion schema update responded ${res.status}`); }
    });
  }
  return activitySchemaEnsured;
}

// ── Steward register (Supabase `stewards`, migration 0018) ────────
//
// Service-role access, so EVERY caller re-checks the Identity role AND the
// village first (steward-admin does; resolveScope does via requireRole). The
// village predicate on each read/write is what stops an admin of one village
// reaching another village's register by guessing a uuid.

export const T_STEWARDS = 'stewards';
// Mirrored by the CHECK constraint in migration 0018 — change one, change both.
export const STEWARD_STATUSES = ['Active', 'Removed'];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v) => UUID_RE.test(String(v || ''));

const enc = encodeURIComponent;
const STEWARD_ORDER = 'date_added.desc,created_at.desc';

/** Row → the SAME shape parseSteward gave the consoles (id is now the uuid, village the slug). */
export function parseStewardRow(r) {
  return {
    id: r.id,
    name: r.name || '',
    email: (r.email || '').toLowerCase(),
    village: r.village_id || '',
    cards: Array.isArray(r.cards) ? r.cards : [],
    status: r.status || 'Active',
    addedBy: r.added_by || '',
    dateAdded: r.date_added || null,
  };
}

/**
 * Every live (not archived) steward row for a village, newest first — both
 * Active and Removed by default, because the console shows Removed stewards
 * greyed with a Restore button. `status` narrows to one status;
 * `includeRemoved:false` drops Removed rows.
 */
export async function listStewards(village, { status, includeRemoved = true } = {}) {
  const filters = [];
  if (status) filters.push(`status=eq.${enc(status)}`);
  else if (!includeRemoved) filters.push('status=eq.Active');
  const rows = await selectVillage(T_STEWARDS, village, {
    order: STEWARD_ORDER, extra: filters.length ? filters.join('&') : undefined,
  });
  return rows.map(parseStewardRow);
}

/**
 * One steward, proven to belong to `village` and not archived. Replaces the
 * Notion parent-database check. Null for a non-uuid id (PostgREST would 400
 * on it), a foreign village's row, or an archived row.
 */
export async function getSteward(id, village) {
  if (!isUuid(id)) return null;
  const row = await selectOne(T_STEWARDS, id, village);
  return row ? parseStewardRow(row) : null;
}

/** The live row (Active OR Removed) for an email in a village, else null. */
export async function findStewardByEmail(village, email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return null;
  const rows = await selectVillage(T_STEWARDS, village, { extra: `email=eq.${enc(e)}&limit=1` });
  return rows.length ? parseStewardRow(rows[0]) : null;
}

/** Insert; village_id and the lower-cased email are derived here so no caller can write a foreign slug by accident. */
export async function createSteward(village, values) {
  return insertRow(T_STEWARDS, {
    ...values,
    village_id: slugVillage(village),
    email: String(values.email || '').trim().toLowerCase(),
    date_added: values.date_added || today(),
  });
}
export async function patchSteward(id, village, values) {
  if (!isUuid(id)) throw new Error('Steward not found');
  return updateRow(T_STEWARDS, id, village, values);
}
export async function archiveSteward(id, village) {
  if (!isUuid(id)) throw new Error('Steward not found');
  return archiveRowById(T_STEWARDS, id, village);
}

/**
 * Raw PostgREST access for steward-migrate's reconciliation read (all
 * villages, archived rows included) and its inserts. Same shape as
 * _contrib.js contribRaw; errors carry .status so a missing table (404) can
 * become a 412. Never echoes a row in an error.
 */
export async function stewardRaw(path, opts = {}) {
  if (!supaConfigured()) {
    throw new Error('The steward register is stored in Supabase, which is not configured on this site (VAPP_SUPABASE_URL / VAPP_SUPABASE_SERVICE_KEY).');
  }
  const res = await fetch(`${process.env.VAPP_SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: process.env.VAPP_SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${process.env.VAPP_SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; }
  if (!res.ok) {
    const msg = (data && (data.message || data.hint)) || `Supabase responded ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return data;
}

// ── Card-level scoping ────────────────────────────────────────────

/**
 * All ACTIVE steward assignments for an email in a village → array of card
 * objects [{path,title}], or [] if none. The register now allows one live row
 * per email per village, but cards are still unioned so nothing is lost if
 * that ever changes. Reads Supabase, so resolveScope() below is unchanged.
 */
export async function getStewardCards(email, village) {
  if (!email || !supaConfigured()) return [];
  const rows = await selectVillage(T_STEWARDS, village, {
    extra: `email=eq.${enc(String(email).trim().toLowerCase())}&status=eq.Active`,
  });
  let cards = [];
  for (const row of rows) for (const c of parseStewardRow(row).cards) cards = mergeCard(cards, c);
  return cards;
}

/**
 * Resolve who the caller is for a village's volunteer data.
 * Returns { ok:true, user, isAdmin, cards } where:
 *   - isAdmin true  → full village access, cards = null (meaning "all")
 *   - isAdmin false → steward; cards = [{path,title}] they may manage ([] = none)
 * or { ok:false, status, error }.
 */
export async function resolveScope(context, village) {
  const auth = requireRole(context, { village, anyOf: ['admin', 'steward'] });
  if (!auth.ok) return auth;
  const isAdmin = hasRole(auth.user, { village, anyOf: ['admin'] });
  if (isAdmin) return { ok: true, user: auth.user, isAdmin: true, cards: null };
  const cards = await getStewardCards(auth.user.email, village);
  return { ok: true, user: auth.user, isAdmin: false, cards };
}

export function scopeHasCard(scope, cardPath) {
  if (scope.isAdmin) return true;
  const p = normPath(cardPath);
  return (scope.cards || []).some((c) => normPath(c.path) === p);
}

export function scopeCoversVolunteer(scope, volunteer) {
  if (scope.isAdmin) return true;
  return (volunteer.cards || []).some((c) => scopeHasCard(scope, c.path));
}

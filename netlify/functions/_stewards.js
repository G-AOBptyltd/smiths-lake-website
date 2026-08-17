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
 * Three Notion DBs (created once by /api/volunteer-provision):
 *   VF Stewards, VF Volunteers, VF Activities — all villages share each DB,
 *   scoped by the Village text column (same v1 model as Contributions/Members).
 */

import { hasRole, requireRole } from './_auth.js';

const NOTION_VERSION = '2022-06-28';

export const STEWARDS_DB_ID = process.env.NOTION_VF_STEWARDS_DB_ID || '';
export const VOLUNTEERS_DB_ID = process.env.NOTION_VF_VOLUNTEERS_DB_ID || '';
export const ACTIVITIES_DB_ID = process.env.NOTION_VF_ACTIVITIES_DB_ID || '';

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

export async function queryAll(dbId, filter, sorts) {
  const results = [];
  let cursor;
  do {
    const res = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
      method: 'POST',
      headers: notionHeaders(),
      body: JSON.stringify({
        ...(filter ? { filter } : {}),
        ...(sorts ? { sorts } : {}),
        page_size: 100,
        ...(cursor ? { start_cursor: cursor } : {}),
      }),
    });
    if (!res.ok) throw new Error(`Notion responded ${res.status}`);
    const data = await res.json();
    results.push(...data.results);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return results;
}

// ── Parsers ───────────────────────────────────────────────────────

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
    createdBy: rtText(p['Created By']),
    lastUpdatedBy: rtText(p['Last Updated By']),
    contributionId: rtText(p['Contribution ID']),
    note: rtText(p.Note),
  };
}

// ── Card-level scoping ────────────────────────────────────────────

/**
 * All ACTIVE steward assignments for an email in a village → array of card
 * objects [{path,title}], or [] if none. (An email can hold several rows;
 * cards are unioned.)
 */
export async function getStewardCards(email, village) {
  if (!STEWARDS_DB_ID || !email) return [];
  const rows = await queryAll(STEWARDS_DB_ID, {
    and: [
      { property: 'Email', email: { equals: String(email).toLowerCase() } },
      { property: 'Village', rich_text: { equals: village } },
      { property: 'Status', select: { equals: 'Active' } },
    ],
  });
  let cards = [];
  for (const row of rows) for (const c of parseSteward(row).cards) cards = mergeCard(cards, c);
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

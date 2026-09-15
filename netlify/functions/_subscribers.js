/**
 * _subscribers.js — shared helpers for the signup surfaces: the mailing list
 * (`subscribers`) and the contact / feedback enquiries (`enquiries`).
 *
 * Files prefixed with "_" are NOT deployed as standalone endpoints by Netlify,
 * but can be imported by the other functions (esbuild inlines them).
 *
 * ── WHY THIS EXISTS (Phase 2 of the PII plan, 16 Sep 2026) ──────────────────
 * The signup forms were three near-identical Netlify forms plus two fire-and-
 * forget re-posts, and between them they:
 *   * never recorded consent AS DATA — a checkbox was ticked and forgotten, so
 *     the association could not produce the one thing the Spam Act expects a
 *     sender to hold: what the person was told, and when;
 *   * had no double opt-in, so anyone could type anyone's address in;
 *   * had no first-party unsubscribe — opting out only worked through
 *     Mailchimp's footer, which retiring Mailchimp would have stranded;
 *   * wrote /contact/ and /feedback/ to Netlify Forms, a US-hosted store
 *     outside the privacy policy with no retention control.
 * Migration 0020 answers all four. This module is the only place that knows
 * how those columns are written, so the four public endpoints can't drift.
 *
 * ── WHY RAW POSTGREST FOR `subscribers` ────────────────────────────────────
 * _supa.js filters `archived_at is null` on every read and update. That is the
 * right default for the tables that have the column — `subscribers` (0007)
 * does not, and PostgREST 400s on an unknown column, so the mailing-list reads
 * and writes go through subRaw() below. `enquiries` DOES have archived_at, so
 * it uses the shared client exactly like every other module.
 *
 * ⛔ NOTHING HERE TOUCHES MAILCHIMP. _mailchimp.js keeps syncing the committee's
 * weekly newsletter until Mailchimp is retired deliberately, in a later step.
 */

import {
  selectVillage, selectOne, insertRow, updateRow, archiveRowById,
  supaConfigured, slugVillage, clean, today, jsonResp,
} from './_supa.js';

export { supaConfigured, slugVillage, clean, today, jsonResp };

export const T_SUBS = 'subscribers';
export const T_ENQ = 'enquiries';

/**
 * The three interests the list actually uses.
 *
 * The 14 Sep investigation found SEVEN Mailchimp interest groups, of which
 * FIVE had zero members — the taxonomy was aspirational, not real. Offering a
 * choice nobody takes is a worse signup form, and an interest nobody can be
 * sent to is a promise the sender can't keep. So: three, all of which the
 * committee actually sends. "Community updates" is always on (it IS the list);
 * the other two are genuine opt-ins.
 */
export const INTERESTS = ['Community updates', 'Landcare', 'Emergency alerts'];
export const DEFAULT_INTEREST = INTERESTS[0];

/**
 * ONE resident vocabulary, replacing five.
 *
 * The old forms offered five different wordings of the same question — the
 * membership form's list, the updates form's lowercase keys ("holiday"), the
 * orphaned SubscriptionForm's "Holiday Visitor", and two more in Mailchimp
 * merge fields. This is the membership register's list (RESIDENT_CATEGORIES in
 * _members.js, mirrored by migration 0013), because that is the one with legal
 * meaning; every other surface now defers to it.
 */
export const RESIDENT_TYPES = [
  'Permanent Resident',
  'Holiday Home Owner',
  'Renter',
  'Visitor / Prospective Resident',
  'Local Business',
];

/** Where a consent came from. Mirrors the consent_method comment in 0020. */
export const CONSENT_METHODS = ['stay-connected', 'membership', 'volunteer'];

// Mirrored by CHECK constraints in migration 0020 — change one, change both.
export const ENQUIRY_KINDS = ['contact', 'feedback'];
export const ENQUIRY_STATUSES = ['New', 'In progress', 'Closed'];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v) => UUID_RE.test(String(v || ''));

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const isEmail = (v) => EMAIL_RE.test(String(v || '').trim());

/** Lowercased, trimmed, capped — the form the unique (village_id, email) key expects. */
export const normaliseEmail = (v) => String(v || '').trim().toLowerCase().slice(0, 200);

/** Only interests we actually offer, de-duplicated, with the always-on one first. */
export function normaliseInterests(list) {
  const wanted = new Set(
    (Array.isArray(list) ? list : [])
      .map((i) => String(i || '').trim())
      .filter((i) => INTERESTS.includes(i)),
  );
  wanted.add(DEFAULT_INTEREST); // the list itself — never optional
  return INTERESTS.filter((i) => wanted.has(i));
}

/* ── Raw PostgREST for `subscribers` (see the header note) ────────────────── */

const SUPA_URL = process.env.VAPP_SUPABASE_URL;
const SUPA_KEY = process.env.VAPP_SUPABASE_SERVICE_KEY;
const enc = encodeURIComponent;

async function subRaw(path, opts = {}) {
  if (!supaConfigured()) {
    throw new Error('The mailing list is stored in Supabase, which is not configured on this site (VAPP_SUPABASE_URL / VAPP_SUPABASE_SERVICE_KEY).');
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
    // Never echo the row back — it is someone's name and email address.
    const msg = (data && (data.message || data.hint)) || `Supabase responded ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return data;
}

/**
 * Row → the object /admin/subscribers/ has always rendered, plus the three
 * keys the consent rebuild added (confirmed / consentAt / consentMethod).
 * The existing keys keep their exact names and shapes: the console is edited
 * to SHOW more, never to read something different.
 * `volunteerEmails` is an optional Set of lowercased emails for the cross-badge.
 */
export function parseSubscriber(r, volunteerEmails) {
  const email = r.email || '';
  const mf = r.merge_fields || {};
  return {
    name: `${r.first_name || ''} ${r.last_name || ''}`.trim(),
    email,
    phone: mf.PHONE || mf.MMERGE6 || '',
    status: r.status || 'subscribed',
    tags: Array.isArray(r.tags) ? r.tags : [],
    interests: Array.isArray(r.interests) ? r.interests : [],
    isVolunteer: volunteerEmails ? volunteerEmails.has(email.toLowerCase()) : false,
    since: r.subscribed_at || r.created_at || null,
    // Added by 0020 — the console's new "Consent" column and pending count.
    confirmed: !!r.confirmed_at,
    consentAt: r.consent_at || null,
    consentMethod: r.consent_method || '',
  };
}

/** The raw row for one address in one village, or null. Never leaves this module unfiltered. */
export async function findSubscriberByEmail(village, email) {
  const addr = normaliseEmail(email);
  if (!addr) return null;
  const q = [
    `village_id=eq.${enc(slugVillage(village))}`,
    `email=eq.${enc(addr)}`,
    'limit=1',
  ].join('&');
  const rows = await subRaw(`${T_SUBS}?${q}`);
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

/**
 * Insert or update one subscriber, keyed by (village_id, email) — the unique
 * constraint from 0007. Returns { row, created } so the caller can decide what
 * to say; the caller owns the status/consent decisions, this owns the SQL.
 */
export async function upsertSubscriber(village, email, values) {
  const addr = normaliseEmail(email);
  const vslug = slugVillage(village);
  const existing = await findSubscriberByEmail(village, addr);

  if (existing) {
    const q = [`id=eq.${enc(existing.id)}`, `village_id=eq.${enc(vslug)}`].join('&');
    const rows = await subRaw(`${T_SUBS}?${q}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ ...values, updated_at: new Date().toISOString() }),
    });
    const row = Array.isArray(rows) ? rows[0] : rows;
    return { row: row || { ...existing, ...values }, created: false };
  }

  const rows = await subRaw(T_SUBS, {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ ...values, village_id: vslug, email: addr }),
  });
  const row = Array.isArray(rows) ? rows[0] : rows;
  if (!row || !row.id) throw new Error('Supabase accepted the signup but returned no row');
  return { row, created: true };
}

/**
 * Double opt-in, step two. Idempotent: a second click on the same link is a
 * success, not an error — people forward confirmation emails to themselves.
 * Returns null for an unknown token so the caller can 404 without leaking
 * whether a token ever existed.
 */
export async function confirmSubscriber(token) {
  if (!isUuid(token)) return null;
  const rows = await subRaw(`${T_SUBS}?confirm_token=eq.${enc(token)}&limit=1`);
  const row = Array.isArray(rows) && rows.length ? rows[0] : null;
  if (!row) return null;
  if (row.confirmed_at && row.status === 'subscribed') return { row, already: true };

  const now = new Date().toISOString();
  await subRaw(`${T_SUBS}?id=eq.${enc(row.id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      status: 'subscribed',
      confirmed_at: row.confirmed_at || now,
      subscribed_at: row.subscribed_at || now,
      updated_at: now,
    }),
  });
  return { row, already: false };
}

/**
 * Withdrawal of consent, honoured immediately.
 *
 * The EMAIL STAYS. That is deliberate and it is the whole point: under the
 * Spam Act the withdrawal must keep being honoured, and the only way to know
 * an address opted out is to remember the address. Everything else about the
 * person goes now — name, interests, tags, merge fields — and the retention
 * class `subscribers_unsubscribed` (0016) finishes the job after 30 days.
 * Idempotent, because one-click List-Unsubscribe headers get clicked twice.
 */
export async function unsubscribeByToken(token) {
  if (!isUuid(token)) return null;
  const rows = await subRaw(`${T_SUBS}?unsubscribe_token=eq.${enc(token)}&limit=1`);
  const row = Array.isArray(rows) && rows.length ? rows[0] : null;
  if (!row) return null;
  if (row.status === 'unsubscribed' && row.unsubscribed_at) return { row, already: true };

  const now = new Date().toISOString();
  await subRaw(`${T_SUBS}?id=eq.${enc(row.id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      status: 'unsubscribed',
      unsubscribed_at: row.unsubscribed_at || now,
      first_name: null,
      last_name: null,
      interests: [],
      tags: [],
      merge_fields: {},
      updated_at: now,
    }),
  });
  return { row, already: false };
}

/* ── Enquiries (contact + feedback) ───────────────────────────────────────── */

/** Row → the object an enquiries console would render. Kept beside the writer. */
export function parseEnquiry(r) {
  return {
    id: r.id,
    kind: r.kind || 'contact',
    name: r.name || '(no name)',
    email: r.email || '',
    phone: r.phone || '',
    subject: r.subject || '',
    category: r.category || '',
    message: r.message || '',
    project: r.project || '',
    priority: r.priority || '',
    status: r.status || 'New',
    handledBy: r.handled_by || '',
    closedAt: r.closed_at || null,
    sourcePage: r.source_page || '',
    village: r.village_id || '',
    created: r.created_at || null,
  };
}

/** Every live enquiry for one village, newest first; optionally one status. */
export async function listEnquiries(village, { status } = {}) {
  const extra = ENQUIRY_STATUSES.includes(status) ? `status=eq.${enc(status)}` : undefined;
  const rows = await selectVillage(T_ENQ, village, { order: 'created_at.desc', extra });
  return rows.map(parseEnquiry);
}

export async function createEnquiry(values) { return insertRow(T_ENQ, values); }

/** One enquiry, proven to belong to `village` (the guard _supa.js exists for). */
export async function getEnquiry(id, village) {
  if (!isUuid(id)) return null;
  const row = await selectOne(T_ENQ, id, village);
  return row ? parseEnquiry(row) : null;
}

export async function patchEnquiry(id, village, values) { return updateRow(T_ENQ, id, village, values); }
export async function archiveEnquiry(id, village) { return archiveRowById(T_ENQ, id, village); }

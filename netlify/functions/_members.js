/**
 * _members.js — shared helpers for the Membership admin functions.
 *
 * Files prefixed with "_" are NOT deployed as standalone endpoints by Netlify,
 * but can be imported by the other functions (esbuild inlines them).
 *
 * The member register is the PPCA member register — one row per member per
 * membership year (renewals create a fresh row, so the register doubles as a
 * year-by-year audit trail for AGMs and grant applications).
 *
 * ── STORAGE: SUPABASE, NOT NOTION (Phase 1 of the PII plan, 14 Sep 2026) ────
 * A member row carries a name, email, phone, residential AND postal address —
 * personal data, which the platform keeps in the Sydney Supabase project behind
 * deny-by-default RLS, not in the shared Notion workspace. The register moved
 * with NOTHING to migrate: reconciled on the day, the Notion "VF Members" DB
 * held one "Testy Member (TEST)" row from 17 Aug. See migration 0013.
 *
 * Every endpoint keeps the same request/response shape as the Notion version,
 * and parseMember() returns the same field names, so /admin/members/ needed no
 * functional change. `pageId` in request bodies is now the row's uuid.
 */

import {
  selectVillage, selectOne, insertRow, updateRow, archiveRowById,
  slugVillage, clean, money, dateOrNull, today, jsonResp, stampBy,
} from './_supa.js';

export { slugVillage, clean, money, dateOrNull, today, jsonResp, stampBy };

export const T_MEMBERS = 'members';

// Mirrored by CHECK constraints in migration 0013 — change one, change both.
export const MEMBER_STATUSES = ['Applied', 'Approved', 'Paid', 'Lapsed'];
export const MEMBERSHIP_FEES = { Individual: 10, Household: 20 };
export const PAYMENT_METHODS = ['Bank transfer', 'Cash at meeting', 'Notify when online payments open'];
export const RESIDENT_CATEGORIES = [
  'Permanent Resident',
  'Holiday Home Owner',
  'Renter',
  'Visitor / Prospective Resident',
  'Local Business',
];

/** Membership year label for a date: 1 July–30 June, e.g. "2026-27". */
export function membershipYear(d) {
  const y = d.getUTCFullYear();
  const startYear = d.getUTCMonth() >= 6 ? y : y - 1; // months 0-indexed; 6 = July
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

/** The membership year after a "YYYY-YY" label, e.g. "2026-27" → "2027-28". */
export function nextMembershipYear(label) {
  const start = parseInt(String(label).slice(0, 4), 10);
  if (!Number.isFinite(start)) return membershipYear(new Date());
  return `${start + 1}-${String((start + 2) % 100).padStart(2, '0')}`;
}

const numOrNull = (v) => (v == null ? null : Number(v));

/** Row → the object the console and the mailers have always received. */
export function parseMember(r) {
  const firstName = r.first_name || '';
  const lastName = r.last_name || '';
  return {
    id: r.id,
    name: `${firstName} ${lastName}`.trim() || '(no name)',
    firstName,
    lastName,
    email: r.email || '',
    phone: r.phone || '',
    address: r.residential_address || '',
    postalAddress: r.postal_address || '',
    membershipType: r.membership_type || '',
    fee: numOrNull(r.fee),
    residentCategory: r.resident_category || '',
    year: r.membership_year || '',
    paymentMethod: r.payment_method || '',
    status: r.status || '',
    stayConnected: r.stay_connected === true,
    dateApplied: r.date_applied || null,
    village: r.village_id || '',
    note: r.note || '',
    loggedBy: r.logged_by || '',
    paymentDate: r.payment_date || null,
    paymentReference: r.payment_reference || '',
    amountPaid: numOrNull(r.amount_paid),
    lastEmail: r.last_email || '',
    lastUpdatedBy: r.last_updated_by || '',
    lastEdited: r.updated_at || null,
  };
}

/** Every live member row for one village, newest application first. */
export async function listMembers(village) {
  const rows = await selectVillage(T_MEMBERS, village, { order: 'date_applied.desc.nullslast' });
  return rows.map(parseMember);
}

/**
 * One member, proven to belong to `village`. Replaces the Notion parent-database
 * check: without the village predicate an admin JWT from one village could read
 * or patch another village's member by guessing a uuid.
 * Returns { ok, member } or { ok:false, status, error }.
 */
export async function getMemberPage(pageId, village) {
  const row = await selectOne(T_MEMBERS, pageId, village);
  if (!row) return { ok: false, status: 404, error: 'Member not found' };
  return { ok: true, member: parseMember(row) };
}

export async function createMember(values) { return insertRow(T_MEMBERS, values); }
export async function patchMember(id, village, values) { return updateRow(T_MEMBERS, id, village, values); }
export async function archiveMember(id, village) { return archiveRowById(T_MEMBERS, id, village); }

/**
 * _members.js — shared helpers for the Membership admin functions.
 *
 * Files prefixed with "_" are NOT deployed as standalone endpoints by Netlify,
 * but can be imported by the other functions (esbuild inlines them).
 *
 * The VF Members DB is the PPCA member register — one row per member per
 * membership year (renewals create a fresh row, so the register doubles as a
 * year-by-year audit trail for AGMs and grant applications).
 */

const NOTION_VERSION = '2022-06-28';
export const MEMBERS_DB_ID = process.env.NOTION_MEMBERS_DB_ID || '494becca311c4d668a0f7f2750c08a74';

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

export function notionHeaders() {
  return {
    Authorization: `Bearer ${process.env.NOTION_API_KEY}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  };
}

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

const text = (prop) => (prop?.rich_text || []).map((t) => t.plain_text).join('');

export function parseMember(page) {
  const p = page.properties || {};
  return {
    id: page.id,
    name: p.Member?.title?.[0]?.plain_text || '(no name)',
    firstName: text(p['First Name']),
    lastName: text(p['Last Name']),
    email: p.Email?.email || '',
    phone: p.Phone?.phone_number || '',
    address: text(p['Residential Address']),
    postalAddress: text(p['Postal Address']),
    membershipType: p['Membership Type']?.select?.name || '',
    fee: p.Fee?.number ?? null,
    residentCategory: p['Resident Category']?.select?.name || '',
    year: p['Membership Year']?.select?.name || '',
    paymentMethod: p['Payment Method']?.select?.name || '',
    status: p.Status?.select?.name || '',
    stayConnected: !!p['Stay Connected']?.checkbox,
    dateApplied: p['Date Applied']?.date?.start || null,
    village: text(p.Village),
    note: text(p.Note),
    loggedBy: text(p['Logged by']),
    paymentDate: p['Payment Date']?.date?.start || null,
    paymentReference: text(p['Payment Reference']),
    amountPaid: p['Amount Paid']?.number ?? null,
    lastEmail: text(p['Last Email']),
    lastUpdatedBy: text(p['Last Updated By']),
    lastEdited: page.last_edited_time,
  };
}

/**
 * The public /membership/ form created the original schema; the admin tool
 * needs a few extra columns (payment reconciliation + comms/audit stamps).
 * Adding a property that already exists with the same type is a no-op, so this
 * is safe to call every cold start — no manual Notion setup step required.
 */
let schemaEnsured = null;
export function ensureMemberSchema() {
  if (!schemaEnsured) {
    schemaEnsured = fetch(`https://api.notion.com/v1/databases/${MEMBERS_DB_ID}`, {
      method: 'PATCH',
      headers: notionHeaders(),
      body: JSON.stringify({
        properties: {
          'Payment Date': { date: {} },
          'Payment Reference': { rich_text: {} },
          'Amount Paid': { number: {} },
          'Last Email': { rich_text: {} },
          'Last Updated By': { rich_text: {} },
        },
      }),
    }).then((res) => {
      if (!res.ok) { schemaEnsured = null; throw new Error(`Notion schema update responded ${res.status}`); }
    });
  }
  return schemaEnsured;
}

/**
 * Fetch a member page and verify it really belongs to the Members DB — an
 * admin JWT must not become a lever to read/patch arbitrary pages the Notion
 * integration can reach. Returns { ok, page, member } or { ok:false, error }.
 */
export async function getMemberPage(pageId) {
  const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, { headers: notionHeaders() });
  if (!res.ok) return { ok: false, status: res.status === 404 ? 404 : 502, error: 'Member not found' };
  const page = await res.json();
  const parent = page.parent?.database_id?.replace(/-/g, '');
  if (parent !== MEMBERS_DB_ID.replace(/-/g, '')) {
    return { ok: false, status: 404, error: 'Member not found' };
  }
  return { ok: true, page, member: parseMember(page) };
}

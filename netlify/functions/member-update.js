/**
 * member-update.js — POST /api/member-update
 *
 * All admin mutations on the VF Members register. Body: { village?, pageId, action, ... }
 *
 * Actions:
 *   status   { status }                       — Applied | Approved | Paid | Lapsed
 *   payment  { paymentDate?, paymentMethod?, paymentReference?, amountPaid? }
 *                                             — records the fee and sets Status = Paid
 *   details  { firstName?, lastName?, email?, phone?, address?, postalAddress?,
 *              membershipType?, residentCategory?, note? }
 *                                             — corrects contact/application details
 *   renew    { }                              — creates a NEW row for the next
 *              membership year (Status Approved, unpaid) copying the member's
 *              details; the old row is left as the historical record
 *   delete   { }                              — SUPER-ADMIN ONLY; moves the row
 *              to Notion trash (recoverable there). Normal cleanup is "Lapsed".
 *
 * Auth: village admin / super-admin. Every write stamps "Last Updated By" with
 * the acting admin's verified email — the register's audit trail.
 * The target page's parentage is verified against the Members DB before any
 * write, so an admin JWT can't patch arbitrary pages via our integration.
 */

import { requireRole, getRoles } from './_auth.js';
import {
  MEMBERS_DB_ID, notionHeaders, ensureMemberSchema, getMemberPage,
  MEMBER_STATUSES, MEMBERSHIP_FEES, PAYMENT_METHODS, RESIDENT_CATEGORIES,
  membershipYear, nextMembershipYear,
} from './_members.js';

function corsHeaders() {
  return { 'Content-Type': 'application/json' };
}

function bad(msg) {
  return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: msg }) };
}

const rt = (s) => (s ? [{ text: { content: String(s) } }] : []);

export const handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders(), body: JSON.stringify({ error: 'POST only' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch {
    return bad('Invalid JSON');
  }

  const village = body.village || process.env.VILLAGE_NAME || 'Smiths Lake';
  const auth = requireRole(context, { village, anyOf: ['admin'] });
  if (!auth.ok) {
    return { statusCode: auth.status, headers: corsHeaders(), body: JSON.stringify({ error: auth.error }) };
  }
  const adminEmail = (auth.user.email || '').slice(0, 200);

  const { pageId, action } = body;
  if (!pageId || !action) return bad('pageId and action are required');

  try {
    await ensureMemberSchema();

    const target = await getMemberPage(pageId);
    if (!target.ok) {
      return { statusCode: target.status, headers: corsHeaders(), body: JSON.stringify({ error: target.error }) };
    }
    const member = target.member;

    const stamp = { 'Last Updated By': { rich_text: rt(`${adminEmail} · ${new Date().toISOString().slice(0, 10)}`) } };
    let properties = null;

    if (action === 'status') {
      if (!MEMBER_STATUSES.includes(body.status)) return bad('Unknown status');
      properties = { 'Status': { select: { name: body.status } }, ...stamp };

    } else if (action === 'payment') {
      const amount = Number(body.amountPaid);
      const method = PAYMENT_METHODS.includes(body.paymentMethod) ? body.paymentMethod : null;
      properties = {
        'Status': { select: { name: 'Paid' } },
        'Payment Date': { date: { start: body.paymentDate || new Date().toISOString().slice(0, 10) } },
        'Payment Reference': { rich_text: rt((body.paymentReference || '').trim().slice(0, 200)) },
        'Amount Paid': { number: Number.isFinite(amount) && amount >= 0 ? amount : (member.fee ?? null) },
        ...(method ? { 'Payment Method': { select: { name: method } } } : {}),
        ...stamp,
      };

    } else if (action === 'details') {
      const firstName = (body.firstName ?? member.firstName).trim().slice(0, 100);
      const lastName = (body.lastName ?? member.lastName).trim().slice(0, 100);
      if (!firstName || !lastName) return bad('First and last name are required');
      const email = (body.email ?? member.email).trim().slice(0, 200);
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return bad('That email address does not look valid');
      const membershipType = body.membershipType ?? member.membershipType;
      if (!Object.hasOwn(MEMBERSHIP_FEES, membershipType)) return bad('Unknown membership type');
      const residentCategory = body.residentCategory ?? member.residentCategory;
      properties = {
        'Member': { title: [{ text: { content: `${firstName} ${lastName}` } }] },
        'First Name': { rich_text: rt(firstName) },
        'Last Name': { rich_text: rt(lastName) },
        'Email': { email: email || null },
        'Phone': { phone_number: (body.phone ?? member.phone).trim().slice(0, 50) || null },
        'Residential Address': { rich_text: rt((body.address ?? member.address).trim().slice(0, 300)) },
        'Postal Address': { rich_text: rt((body.postalAddress ?? member.postalAddress).trim().slice(0, 300)) },
        'Membership Type': { select: { name: membershipType } },
        'Fee': { number: MEMBERSHIP_FEES[membershipType] },
        'Resident Category': RESIDENT_CATEGORIES.includes(residentCategory)
          ? { select: { name: residentCategory } } : { select: null },
        'Note': { rich_text: rt((body.note ?? member.note).trim().slice(0, 2000)) },
        ...stamp,
      };

    } else if (action === 'renew') {
      const newYear = member.year ? nextMembershipYear(member.year) : membershipYear(new Date());
      const fee = MEMBERSHIP_FEES[member.membershipType] ?? member.fee ?? null;
      const res = await fetch('https://api.notion.com/v1/pages', {
        method: 'POST',
        headers: notionHeaders(),
        body: JSON.stringify({
          parent: { database_id: MEMBERS_DB_ID },
          properties: {
            'Member': { title: [{ text: { content: member.name } }] },
            'First Name': { rich_text: rt(member.firstName) },
            'Last Name': { rich_text: rt(member.lastName) },
            'Email': { email: member.email || null },
            'Phone': { phone_number: member.phone || null },
            'Residential Address': { rich_text: rt(member.address) },
            'Postal Address': { rich_text: rt(member.postalAddress) },
            'Membership Type': member.membershipType ? { select: { name: member.membershipType } } : { select: null },
            'Fee': { number: fee },
            'Resident Category': member.residentCategory ? { select: { name: member.residentCategory } } : { select: null },
            'Membership Year': { select: { name: newYear } },
            'Payment Method': member.paymentMethod ? { select: { name: member.paymentMethod } } : { select: null },
            'Status': { select: { name: 'Approved' } },
            'Stay Connected': { checkbox: member.stayConnected },
            'Date Applied': { date: { start: new Date().toISOString().slice(0, 10) } },
            'Village': { rich_text: rt(member.village || village) },
            'Note': { rich_text: rt(`Renewal of ${member.year || 'previous year'}`) },
            'Logged by': { rich_text: rt(adminEmail) },
            ...stamp,
          },
        }),
      });
      if (!res.ok) throw new Error(`Notion responded ${res.status}`);
      const page = await res.json();
      return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ ok: true, pageId: page.id, year: newYear }) };

    } else if (action === 'delete') {
      if (!getRoles(auth.user).includes('super-admin')) {
        return { statusCode: 403, headers: corsHeaders(), body: JSON.stringify({ error: 'Only the super-admin can delete register rows — use Lapsed instead' }) };
      }
      const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
        method: 'PATCH',
        headers: notionHeaders(),
        body: JSON.stringify({ archived: true }),
      });
      if (!res.ok) throw new Error(`Notion responded ${res.status}`);
      return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ ok: true }) };

    } else {
      return bad('Unknown action');
    }

    const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
      method: 'PATCH',
      headers: notionHeaders(),
      body: JSON.stringify({ properties }),
    });
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`Notion responded ${res.status}: ${detail.slice(0, 200)}`);
    }
    return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ ok: true }) };
  } catch (err) {
    return { statusCode: 502, headers: corsHeaders(), body: JSON.stringify({ error: err.message }) };
  }
};

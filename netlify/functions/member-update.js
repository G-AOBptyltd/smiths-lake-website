/**
 * member-update.js — POST /api/member-update
 *
 * All admin mutations on the member register. Body: { village?, pageId, action, ... }
 * (`pageId` is the row's uuid — the name is kept so /admin/members/ is unchanged.)
 *
 * Actions:
 *   status   { status }                       — Applied | Approved | Paid | Lapsed
 *   payment  { paymentDate?, paymentMethod?, paymentReference?, amountPaid? }
 *                                             — records the fee and sets status = Paid
 *   details  { firstName?, lastName?, email?, phone?, address?, postalAddress?,
 *              membershipType?, residentCategory?, note? }
 *                                             — corrects contact/application details
 *   renew    { }                              — creates a NEW row for the next
 *              membership year (status Approved, unpaid) copying the member's
 *              details; the old row is left as the historical record
 *   delete   { }                              — SUPER-ADMIN ONLY; soft-deletes the
 *              row (archived_at — recoverable). Normal cleanup is "Lapsed".
 *
 * Auth: village admin / super-admin. Every write stamps last_updated_by with
 * the acting admin's verified email — the register's audit trail.
 * The target row is fetched WITH the village predicate before any write, so an
 * admin JWT from one village can't touch another village's member.
 */

import { requireRole, getRoles } from './_auth.js';
import {
  MEMBER_STATUSES, MEMBERSHIP_FEES, PAYMENT_METHODS, RESIDENT_CATEGORIES,
  membershipYear, nextMembershipYear,
  getMemberPage, createMember, patchMember, archiveMember,
  slugVillage, clean, money, dateOrNull, today, jsonResp, stampBy,
} from './_members.js';

const bad = (msg) => jsonResp(400, { error: msg });

export const handler = async (event, context) => {
  if (event.httpMethod !== 'POST') return jsonResp(405, { error: 'POST only' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch {
    return bad('Invalid JSON');
  }

  const village = body.village || process.env.VILLAGE_NAME || 'Smiths Lake';
  const auth = requireRole(context, { village, anyOf: ['admin'] });
  if (!auth.ok) return jsonResp(auth.status, { error: auth.error });
  const adminEmail = (auth.user.email || '').slice(0, 200);

  const { pageId, action } = body;
  if (!pageId || !action) return bad('pageId and action are required');

  try {
    const target = await getMemberPage(pageId, village);
    if (!target.ok) return jsonResp(target.status, { error: target.error });
    const member = target.member;

    const stamp = { last_updated_by: stampBy(auth.user) };
    let values = null;

    if (action === 'status') {
      if (!MEMBER_STATUSES.includes(body.status)) return bad('Unknown status');
      values = { status: body.status, ...stamp };

    } else if (action === 'payment') {
      const amount = money(body.amountPaid);
      const method = PAYMENT_METHODS.includes(body.paymentMethod) ? body.paymentMethod : null;
      values = {
        status: 'Paid',
        payment_date: dateOrNull(body.paymentDate) || today(),
        payment_reference: clean(body.paymentReference, 200),
        amount_paid: amount != null ? amount : (member.fee ?? null),
        ...(method ? { payment_method: method } : {}),
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
      values = {
        first_name: firstName,
        last_name: lastName,
        email: email || null,
        phone: clean(body.phone ?? member.phone, 50),
        residential_address: clean(body.address ?? member.address, 300),
        postal_address: clean(body.postalAddress ?? member.postalAddress, 300),
        membership_type: membershipType,
        fee: MEMBERSHIP_FEES[membershipType],
        resident_category: RESIDENT_CATEGORIES.includes(residentCategory) ? residentCategory : null,
        note: clean(body.note ?? member.note, 2000),
        ...stamp,
      };

    } else if (action === 'renew') {
      // A renewal is a NEW row for the next year; the old row stays as history.
      const newYear = member.year ? nextMembershipYear(member.year) : membershipYear(new Date());
      const fee = MEMBERSHIP_FEES[member.membershipType] ?? member.fee ?? null;
      const id = await createMember({
        village_id: slugVillage(member.village || village),
        first_name: member.firstName,
        last_name: member.lastName,
        email: member.email || null,
        phone: member.phone || null,
        residential_address: member.address || null,
        postal_address: member.postalAddress || null,
        membership_type: member.membershipType || null,
        fee,
        resident_category: member.residentCategory || null,
        membership_year: newYear,
        payment_method: member.paymentMethod || null,
        status: 'Approved',
        stay_connected: member.stayConnected,
        date_applied: today(),
        note: `Renewal of ${member.year || 'previous year'}`,
        logged_by: adminEmail,
        ...stamp,
      });
      return jsonResp(200, { ok: true, pageId: id, year: newYear });

    } else if (action === 'delete') {
      if (!getRoles(auth.user).includes('super-admin')) {
        return jsonResp(403, { error: 'Only the super-admin can delete register rows — use Lapsed instead' });
      }
      await archiveMember(pageId, village);
      return jsonResp(200, { ok: true });

    } else {
      return bad('Unknown action');
    }

    await patchMember(pageId, village, values);
    return jsonResp(200, { ok: true });
  } catch (err) {
    return jsonResp(502, { error: err.message });
  }
};

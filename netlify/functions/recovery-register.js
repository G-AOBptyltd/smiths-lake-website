/**
 * recovery-register.js — the needs and offers registers, and the matching
 * between them (the heart of the Recovery Support module).
 *
 * POST /api/recovery-register { village?, kind:'need'|'offer', action, ... }
 *   save    { pageId?, event, ...fields }
 *   status  { pageId, status }
 *   delete  { pageId }                       village ADMIN only (soft delete)
 *   match   { needId, offerId, on: bool }    kind is ignored — links BOTH sides
 *
 * Reading happens through /api/recovery-admin?event=… (one round trip returns
 * the event, its needs, its offers and the evidence roll-up), so this endpoint
 * is write-only. That keeps the console's refresh path to a single request.
 *
 * Roles: admin | emergency | steward may log and progress needs and offers —
 * that is the point, the legwork is shared. Only admin may delete. A Sensitive
 * need's contact block is withheld from stewards on READ (see _recovery.js
 * redactNeed) and, so a steward can never blank it out by saving a form they
 * were served redacted, is PRESERVED rather than overwritten on WRITE.
 *
 * Records live in Supabase, behind deny-by-default RLS — see _recovery.js.
 */

import {
  T_EVENTS, T_NEEDS, T_OFFERS,
  NEED_STATUSES, NEED_CATEGORIES, NEED_PRIORITIES, NEED_OPEN,
  OFFER_STATUSES, OFFER_TYPES,
  jsonResp, clean, int, money, dateOrNull, today, slugVillage,
  getRow, createRow, patchRow, archiveRow, stampFor,
  canSeeSensitive, requireRecoveryRole,
} from './_recovery.js';
import { requireRole } from './_auth.js';

const VILLAGE_OF = (v) => v || process.env.VILLAGE_NAME || 'Smiths Lake';

/** Keep a matched-pair list unique by id, and bounded. */
function toggleLink(list, entry, on) {
  const without = (list || []).filter((x) => x && x.id !== entry.id);
  if (!on) return without;
  return [...without, entry].slice(0, 60);
}

export const handler = async (event, context) => {
  if (event.httpMethod !== 'POST') return jsonResp(405, { error: 'POST only' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch {
    return jsonResp(400, { error: 'Invalid JSON' });
  }

  const village = VILLAGE_OF(body.village);
  const auth = requireRecoveryRole(context, village);
  if (!auth.ok) return jsonResp(auth.status, { error: auth.error });
  const stamp = stampFor(auth.user);
  const kind = body.kind === 'offer' ? 'offer' : 'need';
  const table = kind === 'offer' ? T_OFFERS : T_NEEDS;
  const label = kind === 'offer' ? 'Offer of help' : 'Need';

  try {
    /* ── MATCH: an offer is allocated to a need (both sides, one call) ── */
    if (body.action === 'match') {
      const need = await getRow(T_NEEDS, body.needId, village);
      if (!need) return jsonResp(404, { error: 'Need not found' });
      const offer = await getRow(T_OFFERS, body.offerId, village);
      if (!offer) return jsonResp(404, { error: 'Offer not found' });
      if (need.event && offer.event && need.event !== offer.event) {
        return jsonResp(400, { error: 'That need and that offer belong to different recovery events' });
      }
      const on = body.on !== false;

      const nextNeedLinks = toggleLink(need.matchedOffers, { id: offer.id, title: offer.name }, on);
      const nextOfferLinks = toggleLink(offer.matchedNeeds, { id: need.id, title: need.name }, on);

      const needValues = { matched_offers: nextNeedLinks, ...stamp };
      const offerValues = { matched_needs: nextOfferLinks, ...stamp };
      // Matching moves the workflow on by itself — that is the whole value of
      // matching — but never drags a row BACKWARDS from work already done.
      if (on) {
        if (['Logged', 'Triaged'].includes(need.status)) needValues.status = 'Matched';
        if (['Offered', 'Verified'].includes(offer.status)) offerValues.status = 'Allocated';
      } else {
        if (need.status === 'Matched' && !nextNeedLinks.length) needValues.status = 'Triaged';
        if (offer.status === 'Allocated' && !nextOfferLinks.length) offerValues.status = 'Verified';
      }
      await patchRow(T_NEEDS, need.id, village, needValues);
      await patchRow(T_OFFERS, offer.id, village, offerValues);
      return jsonResp(200, { ok: true, matchedOffers: nextNeedLinks, matchedNeeds: nextOfferLinks });
    }

    /* ── SAVE ──────────────────────────────────────────────────────────── */
    if (body.action === 'save') {
      const name = clean(body.name, 200);
      if (!name) {
        return jsonResp(400, {
          error: kind === 'offer'
            ? 'The offer needs a short name — e.g. “Tractor + slasher, weekends”'
            : 'The need needs a short name — e.g. “Clear fallen tree from driveway”',
        });
      }
      // An event id is required so nothing is ever logged into the void.
      const eventId = clean(body.event, 60);
      if (!eventId) return jsonResp(400, { error: 'Pick the recovery event this belongs to' });
      const ev = await getRow(T_EVENTS, eventId, village);
      if (!ev) return jsonResp(404, { error: 'Recovery event not found for this village' });

      const existing = body.pageId ? await getRow(table, body.pageId, village) : null;
      if (body.pageId && !existing) return jsonResp(404, { error: `${label} not found` });

      let values;
      if (kind === 'offer') {
        if (body.offerType && !OFFER_TYPES.includes(body.offerType)) return jsonResp(400, { error: 'Unknown offer type' });
        values = {
          name,
          event_id: ev.id,
          offer_type: body.offerType || null,
          offered_by: clean(body.offeredBy, 200),
          contact_phone: clean(body.contactPhone, 60),
          contact_email: clean(body.contactEmail, 200),
          description: clean(body.description, 4000),
          capacity: clean(body.capacity, 400),
          available_from: dateOrNull(body.availableFrom),
          available_until: dateOrNull(body.availableUntil),
          estimated_value: money(body.estimatedValue),
          compliance_notes: clean(body.complianceNotes, 2000),
          notes: clean(body.notes, 4000),
          ...stamp,
        };
      } else {
        if (body.category && !NEED_CATEGORIES.includes(body.category)) return jsonResp(400, { error: 'Unknown category' });
        if (body.priority && !NEED_PRIORITIES.includes(body.priority)) return jsonResp(400, { error: 'Unknown priority' });
        values = {
          name,
          event_id: ev.id,
          category: body.category || null,
          priority: NEED_PRIORITIES.includes(body.priority) ? body.priority : 'Medium',
          people_affected: int(body.peopleAffected),
          target_date: dateOrNull(body.targetDate),
          assigned_to: clean(body.assignedTo, 200),
          hours_contributed: money(body.hoursContributed),
          people_helping: int(body.peopleHelping),
          help_value: money(body.helpValue),
          notes: clean(body.notes, 4000),
          ...stamp,
        };

        // The contact block, and the Sensitive flag that protects it, are only
        // writable by someone entitled to SEE it. A steward editing a redacted
        // need saves everything else and leaves the household's details exactly
        // as they were — a redacted form can never erase the real values.
        const allowSensitive = canSeeSensitive(auth.user, village);
        const wasSensitive = existing ? existing.sensitive : false;
        if (allowSensitive || !wasSensitive) {
          values.contact_name = clean(body.contactName, 200);
          values.contact_phone = clean(body.contactPhone, 60);
          values.contact_email = clean(body.contactEmail, 200);
          values.location = clean(body.location, 400);
          values.access_notes = clean(body.accessNotes, 2000);
        }
        // Only admin/emergency may raise or lower the Sensitive flag.
        if (allowSensitive) values.sensitive = body.sensitive === true || body.sensitive === 'true';
      }

      if (existing) {
        await patchRow(table, existing.id, village, values);
        return jsonResp(200, { ok: true, pageId: existing.id });
      }
      const pageId = await createRow(table, {
        ...values,
        village_id: slugVillage(village),
        status: kind === 'offer' ? 'Offered' : 'Logged',
        logged_by: auth.user.email || 'admin',
        ...(kind === 'need' ? { logged_date: dateOrNull(body.loggedDate) || today() } : {}),
      });
      return jsonResp(200, { ok: true, pageId });
    }

    /* ── STATUS ────────────────────────────────────────────────────────── */
    if (body.action === 'status') {
      const allowed = kind === 'offer' ? OFFER_STATUSES : NEED_STATUSES;
      if (!allowed.includes(body.status)) return jsonResp(400, { error: 'Unknown status' });
      const existing = await getRow(table, body.pageId, village);
      if (!existing) return jsonResp(404, { error: `${label} not found` });
      const values = { status: body.status, ...stamp };
      if (kind === 'need' && body.status === 'Closed' && !existing.closedDate) {
        values.closed_date = today();
      }
      // Reopening a closed need clears the closed stamp, so "closed" always
      // means closed and the roll-up cannot count a reopened need as finished.
      if (kind === 'need' && NEED_OPEN.includes(body.status) && existing.closedDate) {
        values.closed_date = null;
      }
      await patchRow(table, body.pageId, village, values);
      return jsonResp(200, { ok: true });
    }

    /* ── DELETE ────────────────────────────────────────────────────────── */
    if (body.action === 'delete') {
      const adminOnly = requireRole(context, { village, anyOf: ['admin'] });
      if (!adminOnly.ok) {
        return jsonResp(403, {
          error: kind === 'offer'
            ? 'Only a village admin can delete — mark the offer Withdrawn instead to keep the record'
            : 'Only a village admin can delete — mark the need Withdrawn or Referred instead to keep the record',
        });
      }
      const existing = await getRow(table, body.pageId, village);
      if (!existing) return jsonResp(404, { error: `${label} not found` });
      await archiveRow(table, body.pageId, village);
      return jsonResp(200, { ok: true });
    }

    return jsonResp(400, { error: 'Unknown action' });
  } catch (err) {
    return jsonResp(502, { error: err.message });
  }
};

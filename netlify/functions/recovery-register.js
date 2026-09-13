/**
 * recovery-register.js — the needs and offers registers, and the matching
 * between them (the heart of the Recovery Support module).
 *
 * POST /api/recovery-register { village?, kind:'need'|'offer', action, ... }
 *   save    { pageId?, event, ...fields }
 *   status  { pageId, status }
 *   delete  { pageId }                       village ADMIN only (Notion trash)
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
 */

import {
  NEED_STATUSES, NEED_CATEGORIES, NEED_PRIORITIES, NEED_OPEN,
  OFFER_STATUSES, OFFER_TYPES,
  jsonResp, rtChunks, num, dateOrNull, today,
  getRow, createRow, patchRow, archiveRow, stampFor,
  parseNeed, parseOffer, parseEvent, canSeeSensitive, requireRecoveryRole,
} from './_recovery.js';
import { requireRole } from './_auth.js';

const VILLAGE_OF = (v) => v || process.env.VILLAGE_NAME || 'Smiths Lake';
const clean = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

/** Keep a matched-pair list unique by id, and small enough for one rich_text. */
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
  const register = kind === 'offer' ? 'offers' : 'needs';
  const parse = kind === 'offer' ? parseOffer : parseNeed;
  const label = kind === 'offer' ? 'Offer of help' : 'Need';

  try {
    /* ── MATCH: an offer is allocated to a need (both sides, one call) ── */
    if (body.action === 'match') {
      const need = await getRow('needs', body.needId, village, parseNeed);
      if (!need) return jsonResp(404, { error: 'Need not found' });
      const offer = await getRow('offers', body.offerId, village, parseOffer);
      if (!offer) return jsonResp(404, { error: 'Offer not found' });
      if (need.event && offer.event && need.event !== offer.event) {
        return jsonResp(400, { error: 'That need and that offer belong to different recovery events' });
      }
      const on = body.on !== false;

      const nextNeedLinks = toggleLink(need.matchedOffers, { id: offer.id, title: offer.name }, on);
      const nextOfferLinks = toggleLink(offer.matchedNeeds, { id: need.id, title: need.name }, on);

      const needProps = { 'Matched Offers': { rich_text: rtChunks(JSON.stringify(nextNeedLinks)) }, ...stamp };
      const offerProps = { 'Matched Needs': { rich_text: rtChunks(JSON.stringify(nextOfferLinks)) }, ...stamp };
      // Matching moves the workflow on by itself — that is the whole value of
      // matching — but never drags a row BACKWARDS from work already done.
      if (on) {
        if (['Logged', 'Triaged'].includes(need.status)) needProps['Status'] = { select: { name: 'Matched' } };
        if (['Offered', 'Verified'].includes(offer.status)) offerProps['Status'] = { select: { name: 'Allocated' } };
      } else {
        if (need.status === 'Matched' && !nextNeedLinks.length) needProps['Status'] = { select: { name: 'Triaged' } };
        if (offer.status === 'Allocated' && !nextOfferLinks.length) offerProps['Status'] = { select: { name: 'Verified' } };
      }
      await patchRow(need.id, needProps);
      await patchRow(offer.id, offerProps);
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
      const ev = await getRow('events', eventId, village, parseEvent);
      if (!ev) return jsonResp(404, { error: 'Recovery event not found for this village' });

      const existing = body.pageId ? await getRow(register, body.pageId, village, parse) : null;
      if (body.pageId && !existing) return jsonResp(404, { error: `${label} not found` });

      let properties;
      if (kind === 'offer') {
        if (body.offerType && !OFFER_TYPES.includes(body.offerType)) return jsonResp(400, { error: 'Unknown offer type' });
        properties = {
          'Offer': { title: [{ text: { content: name } }] },
          'Village': { rich_text: rtChunks(village.slice(0, 100)) },
          'Event': { rich_text: rtChunks(ev.id) },
          'Offer Type': body.offerType ? { select: { name: body.offerType } } : { select: null },
          'Offered By': { rich_text: rtChunks(clean(body.offeredBy, 200)) },
          'Contact Phone': { rich_text: rtChunks(clean(body.contactPhone, 60)) },
          'Contact Email': { rich_text: rtChunks(clean(body.contactEmail, 200)) },
          'Description': { rich_text: rtChunks(clean(body.description, 4000)) },
          'Capacity': { rich_text: rtChunks(clean(body.capacity, 400)) },
          'Available From': dateOrNull(body.availableFrom),
          'Available Until': dateOrNull(body.availableUntil),
          'Estimated Value': { number: num(body.estimatedValue) },
          'Compliance Notes': { rich_text: rtChunks(clean(body.complianceNotes, 2000)) },
          'Notes': { rich_text: rtChunks(clean(body.notes, 4000)) },
          ...stamp,
        };
      } else {
        if (body.category && !NEED_CATEGORIES.includes(body.category)) return jsonResp(400, { error: 'Unknown category' });
        if (body.priority && !NEED_PRIORITIES.includes(body.priority)) return jsonResp(400, { error: 'Unknown priority' });
        properties = {
          'Need': { title: [{ text: { content: name } }] },
          'Village': { rich_text: rtChunks(village.slice(0, 100)) },
          'Event': { rich_text: rtChunks(ev.id) },
          'Category': body.category ? { select: { name: body.category } } : { select: null },
          'Priority': { select: { name: NEED_PRIORITIES.includes(body.priority) ? body.priority : 'Medium' } },
          'People Affected': { number: num(body.peopleAffected) },
          'Target Date': dateOrNull(body.targetDate),
          'Assigned To': { rich_text: rtChunks(clean(body.assignedTo, 200)) },
          'Hours Contributed': { number: num(body.hoursContributed) },
          'People Helping': { number: num(body.peopleHelping) },
          'Help Value': { number: num(body.helpValue) },
          'Notes': { rich_text: rtChunks(clean(body.notes, 4000)) },
          ...stamp,
        };

        // The contact block, and the Sensitive flag that protects it, are only
        // writable by someone entitled to SEE it. A steward editing a redacted
        // need saves everything else and leaves the household's details exactly
        // as they were — a redacted form can never erase the real values.
        const allowSensitive = canSeeSensitive(auth.user, village);
        const wasSensitive = existing ? existing.sensitive : false;
        if (allowSensitive || !wasSensitive) {
          properties['Contact Name'] = { rich_text: rtChunks(clean(body.contactName, 200)) };
          properties['Contact Phone'] = { rich_text: rtChunks(clean(body.contactPhone, 60)) };
          properties['Contact Email'] = { rich_text: rtChunks(clean(body.contactEmail, 200)) };
          properties['Location'] = { rich_text: rtChunks(clean(body.location, 400)) };
          properties['Access Notes'] = { rich_text: rtChunks(clean(body.accessNotes, 2000)) };
        }
        // Only admin/emergency may raise or lower the Sensitive flag.
        if (allowSensitive) properties['Sensitive'] = { checkbox: body.sensitive === true || body.sensitive === 'true' };
      }

      if (existing) {
        await patchRow(existing.id, properties);
        return jsonResp(200, { ok: true, pageId: existing.id });
      }
      properties['Status'] = { select: { name: kind === 'offer' ? 'Offered' : 'Logged' } };
      properties['Logged By'] = { rich_text: rtChunks(auth.user.email || 'admin') };
      if (kind === 'need') properties['Logged Date'] = { date: { start: body.loggedDate || today() } };
      const pageId = await createRow(register, properties);
      return jsonResp(200, { ok: true, pageId });
    }

    /* ── STATUS ────────────────────────────────────────────────────────── */
    if (body.action === 'status') {
      const allowed = kind === 'offer' ? OFFER_STATUSES : NEED_STATUSES;
      if (!allowed.includes(body.status)) return jsonResp(400, { error: 'Unknown status' });
      const existing = await getRow(register, body.pageId, village, parse);
      if (!existing) return jsonResp(404, { error: `${label} not found` });
      const props = { 'Status': { select: { name: body.status } }, ...stamp };
      if (kind === 'need' && body.status === 'Closed' && !existing.closedDate) {
        props['Closed Date'] = { date: { start: today() } };
      }
      // Reopening a closed need clears the closed stamp, so "closed" always
      // means closed and the roll-up cannot count a reopened need as finished.
      if (kind === 'need' && NEED_OPEN.includes(body.status) && existing.closedDate) {
        props['Closed Date'] = { date: null };
      }
      await patchRow(body.pageId, props);
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
      const existing = await getRow(register, body.pageId, village, parse);
      if (!existing) return jsonResp(404, { error: `${label} not found` });
      await archiveRow(body.pageId);
      return jsonResp(200, { ok: true });
    }

    return jsonResp(400, { error: 'Unknown action' });
  } catch (err) {
    return jsonResp(502, { error: err.message });
  }
};

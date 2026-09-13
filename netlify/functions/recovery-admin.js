/**
 * recovery-admin.js — Recovery Events + the evidence roll-up.
 *
 * GET  /api/recovery-admin?village=                  → { events }
 * GET  /api/recovery-admin?village=&event=<pageId>    → { event, needs, offers, rollup }
 * GET  /api/recovery-admin?village=&event=&format=csv → the register as CSV (acquittal evidence)
 * POST /api/recovery-admin { village?, action, ... }
 *   save    { pageId?, name, hazard?, startDate?, closedDate?, declarationRef?,
 *             coordinator?, householdsAffected?, hourRate?, project?, summary?, notes? }
 *   status  { pageId, status }   Standby | Active recovery | Monitoring | Closed
 *   delete  { pageId }           village ADMIN only (Notion trash)
 *
 * Roles: admin | emergency | steward may read and save; only admin | emergency
 * may change an event's status or delete (a steward works inside an event, they
 * do not open or close one).
 *
 * Not plan-gated by design — see _recovery.js requireRecoveryRole().
 */

import {
  EVENT_STATUSES, HAZARD_TYPES, NEED_STATUSES, NEED_CATEGORIES,
  NEED_PRIORITIES, OFFER_STATUSES, OFFER_TYPES,
  jsonResp, rtChunks, num, dateOrNull, today,
  queryVillage, getRow, createRow, patchRow, archiveRow, stampFor,
  parseEvent, parseNeed, parseOffer, redactNeed, canSeeSensitive,
  ledgerHoursInWindow, rollUp, requireRecoveryRole, csvCell,
} from './_recovery.js';
import { requireRole } from './_auth.js';

const VILLAGE_OF = (v) => v || process.env.VILLAGE_NAME || 'Smiths Lake';

/** The register as a flat CSV a recovery-funding acquittal can attach. */
function registerCsv(event, needs, offers, rollup, allowSensitive) {
  const lines = [];
  lines.push(['Recovery event', event.name].map(csvCell).join(','));
  lines.push(['Village', event.village].map(csvCell).join(','));
  lines.push(['Hazard', event.hazard].map(csvCell).join(','));
  lines.push(['Status', event.status].map(csvCell).join(','));
  lines.push(['Period', `${event.startDate || '(no start date)'} to ${event.closedDate || 'ongoing'}`].map(csvCell).join(','));
  if (event.declarationRef) lines.push(['Declaration reference', event.declarationRef].map(csvCell).join(','));
  lines.push(['Coordinator', event.coordinator].map(csvCell).join(','));
  lines.push([]);
  lines.push(['EVIDENCE SUMMARY (indicative — supports a claim, not an audited figure)'].map(csvCell).join(','));
  lines.push(['Needs logged', rollup.needsTotal].map(csvCell).join(','));
  lines.push(['Needs closed', rollup.needsClosed].map(csvCell).join(','));
  lines.push(['Needs still open', rollup.needsOpen].map(csvCell).join(','));
  lines.push(['People affected', rollup.peopleAffected].map(csvCell).join(','));
  lines.push(['Offers of help received', rollup.offersTotal].map(csvCell).join(','));
  lines.push(['Offers delivered', rollup.offersDelivered].map(csvCell).join(','));
  lines.push(['Recovery hours logged against needs', rollup.hours].map(csvCell).join(','));
  lines.push(['Hour rate used ($/hr)', rollup.hourRate || '(not set)'].map(csvCell).join(','));
  lines.push(['Valued volunteer effort ($)', rollup.hoursValue].map(csvCell).join(','));
  lines.push(['Value of donated goods & services ($)', rollup.helpValue].map(csvCell).join(','));
  lines.push(['Value of delivered offers ($)', rollup.deliveredValue].map(csvCell).join(','));
  lines.push(['INDICATIVE TOTAL ($)', rollup.indicativeTotal].map(csvCell).join(','));
  if (rollup.ledger.available) {
    lines.push(['Volunteer-hub hours confirmed in the same period (cross-check, NOT added)', rollup.ledger.hours].map(csvCell).join(','));
  }
  lines.push([]);
  lines.push(['NEEDS REGISTER'].map(csvCell).join(','));
  const needHead = ['Need', 'Category', 'Priority', 'Status', 'Logged', 'Target', 'Closed',
    'People affected', 'Assigned to', 'Hours', 'People helping', 'Help value ($)', 'Notes'];
  if (allowSensitive) needHead.splice(7, 0, 'Contact name', 'Contact phone', 'Location');
  lines.push(needHead.map(csvCell).join(','));
  needs.forEach((n) => {
    const row = [n.name, n.category, n.priority, n.status, n.loggedDate, n.targetDate, n.closedDate,
      n.peopleAffected, n.assignedTo, n.hoursContributed, n.peopleHelping, n.helpValue, n.notes];
    if (allowSensitive) row.splice(7, 0, n.contactName, n.contactPhone, n.location);
    lines.push(row.map(csvCell).join(','));
  });
  lines.push([]);
  lines.push(['OFFERS OF HELP'].map(csvCell).join(','));
  lines.push(['Offer', 'Type', 'Status', 'Offered by', 'Capacity', 'Available from', 'Available until',
    'Estimated value ($)', 'Matched needs', 'Notes'].map(csvCell).join(','));
  offers.forEach((o) => {
    lines.push([o.name, o.offerType, o.status, o.offeredBy, o.capacity, o.availableFrom, o.availableUntil,
      o.estimatedValue, (o.matchedNeeds || []).map((m) => m.title).join(' | '), o.notes].map(csvCell).join(','));
  });
  return lines.join('\n');
}

export const handler = async (event, context) => {
  const q = event.queryStringParameters || {};

  /* ── READ ─────────────────────────────────────────────────────────── */
  if (event.httpMethod === 'GET') {
    const village = VILLAGE_OF(q.village);
    const auth = requireRecoveryRole(context, village);
    if (!auth.ok) return jsonResp(auth.status, { error: auth.error });

    try {
      // The whole picture for one event: its needs, offers and evidence.
      if (q.event) {
        const ev = await getRow('events', q.event, village, parseEvent);
        if (!ev) return jsonResp(404, { error: 'Recovery event not found' });

        const allowSensitive = canSeeSensitive(auth.user, village);
        const [needPages, offerPages] = await Promise.all([
          queryVillage('needs', village, [{ property: 'Logged Date', direction: 'ascending' }]),
          queryVillage('offers', village, [{ property: 'Available From', direction: 'ascending' }]),
        ]);
        const needs = needPages.map(parseNeed).filter((n) => n.event === ev.id);
        const offers = offerPages.map(parseOffer).filter((o) => o.event === ev.id);
        const ledger = await ledgerHoursInWindow(village, ev.startDate, ev.closedDate);
        const rollup = rollUp(ev, needs, offers, ledger);
        const safeNeeds = needs.map((n) => redactNeed(n, allowSensitive));

        if (q.format === 'csv') {
          const slug = String(ev.name || 'recovery').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
          return {
            statusCode: 200,
            headers: {
              'Content-Type': 'text/csv; charset=utf-8',
              'Content-Disposition': `attachment; filename="recovery-${slug || 'event'}-${today()}.csv"`,
            },
            body: registerCsv(ev, safeNeeds, offers, rollup, allowSensitive),
          };
        }
        return jsonResp(200, {
          event: ev, needs: safeNeeds, offers, rollup,
          canSeeSensitive: allowSensitive,
          vocab: {
            eventStatuses: EVENT_STATUSES, hazards: HAZARD_TYPES,
            needStatuses: NEED_STATUSES, needCategories: NEED_CATEGORIES, needPriorities: NEED_PRIORITIES,
            offerStatuses: OFFER_STATUSES, offerTypes: OFFER_TYPES,
          },
        });
      }

      // The event list, plus a light per-event count so the list is useful at a glance.
      const [eventPages, needPages, offerPages] = await Promise.all([
        queryVillage('events', village, [{ property: 'Start Date', direction: 'descending' }]),
        queryVillage('needs', village),
        queryVillage('offers', village),
      ]);
      const needs = needPages.map(parseNeed);
      const offers = offerPages.map(parseOffer);
      const events = eventPages.map(parseEvent).map((ev) => {
        const mine = needs.filter((n) => n.event === ev.id);
        return {
          ...ev,
          needsTotal: mine.length,
          needsOpen: mine.filter((n) => ['Logged', 'Triaged', 'Matched', 'In progress'].includes(n.status)).length,
          offersTotal: offers.filter((o) => o.event === ev.id).length,
        };
      });
      return jsonResp(200, {
        events,
        // Rows logged before an event existed, or whose event was deleted — they
        // would otherwise be invisible, and in a recovery nothing may go missing.
        orphanNeeds: needs.filter((n) => !n.event || !events.some((ev) => ev.id === n.event)).length,
        vocab: { eventStatuses: EVENT_STATUSES, hazards: HAZARD_TYPES },
      });
    } catch (err) {
      return jsonResp(502, { error: err.message });
    }
  }

  if (event.httpMethod !== 'POST') return jsonResp(405, { error: 'GET or POST only' });

  /* ── WRITE ────────────────────────────────────────────────────────── */
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch {
    return jsonResp(400, { error: 'Invalid JSON' });
  }
  const village = VILLAGE_OF(body.village);
  const auth = requireRecoveryRole(context, village);
  if (!auth.ok) return jsonResp(auth.status, { error: auth.error });
  const stamp = stampFor(auth.user);

  try {
    if (body.action === 'save') {
      const name = String(body.name || '').trim().slice(0, 200);
      if (!name) return jsonResp(400, { error: 'The recovery event needs a name — e.g. “October 2026 east coast low”' });
      if (body.hazard && !HAZARD_TYPES.includes(body.hazard)) return jsonResp(400, { error: 'Unknown hazard type' });

      const properties = {
        'Event': { title: [{ text: { content: name } }] },
        'Village': { rich_text: rtChunks(village.slice(0, 100)) },
        'Hazard': body.hazard ? { select: { name: body.hazard } } : { select: null },
        'Start Date': dateOrNull(body.startDate),
        'Closed Date': dateOrNull(body.closedDate),
        'Declaration Ref': { rich_text: rtChunks(String(body.declarationRef || '').trim().slice(0, 200)) },
        'Coordinator': { rich_text: rtChunks(String(body.coordinator || '').trim().slice(0, 200)) },
        'Households Affected': { number: num(body.householdsAffected) },
        'Hour Rate': { number: num(body.hourRate) },
        'Project': { rich_text: rtChunks(String(body.project || '').trim().slice(0, 200)) },
        'Summary': { rich_text: rtChunks(String(body.summary || '').trim().slice(0, 4000)) },
        'Notes': { rich_text: rtChunks(String(body.notes || '').trim().slice(0, 4000)) },
        ...stamp,
      };

      if (body.pageId) {
        const existing = await getRow('events', body.pageId, village, parseEvent);
        if (!existing) return jsonResp(404, { error: 'Recovery event not found' });
        await patchRow(body.pageId, properties);
        return jsonResp(200, { ok: true, pageId: body.pageId });
      }
      // Opening a recovery is the coordinator's call, not a steward's.
      const opener = requireRole(context, { village, anyOf: ['admin', 'emergency'] });
      if (!opener.ok) return jsonResp(403, { error: 'Only a village admin or the Emergency Coordinator can open a recovery event' });
      properties['Status'] = { select: { name: 'Standby' } };
      properties['Logged By'] = { rich_text: rtChunks(auth.user.email || 'admin') };
      const pageId = await createRow('events', properties);
      return jsonResp(200, { ok: true, pageId });
    }

    if (body.action === 'status') {
      if (!EVENT_STATUSES.includes(body.status)) return jsonResp(400, { error: 'Unknown status' });
      const owner = requireRole(context, { village, anyOf: ['admin', 'emergency'] });
      if (!owner.ok) return jsonResp(403, { error: 'Only a village admin or the Emergency Coordinator can change a recovery event’s status' });
      const existing = await getRow('events', body.pageId, village, parseEvent);
      if (!existing) return jsonResp(404, { error: 'Recovery event not found' });
      const props = { 'Status': { select: { name: body.status } }, ...stamp };
      // Stamp the workflow dates the first time each stage is reached.
      if (body.status === 'Active recovery' && !existing.startDate) props['Start Date'] = { date: { start: today() } };
      if (body.status === 'Closed' && !existing.closedDate) props['Closed Date'] = { date: { start: today() } };
      await patchRow(body.pageId, props);
      return jsonResp(200, { ok: true });
    }

    if (body.action === 'delete') {
      const adminOnly = requireRole(context, { village, anyOf: ['admin'] });
      if (!adminOnly.ok) return jsonResp(403, { error: 'Only a village admin can delete — close the event instead to keep the record' });
      const existing = await getRow('events', body.pageId, village, parseEvent);
      if (!existing) return jsonResp(404, { error: 'Recovery event not found' });
      // Needs and offers are NOT cascaded — a recovery record is evidence. They
      // surface as orphans in the list so nothing silently disappears.
      await archiveRow(body.pageId);
      return jsonResp(200, { ok: true });
    }

    return jsonResp(400, { error: 'Unknown action' });
  } catch (err) {
    return jsonResp(502, { error: err.message });
  }
};

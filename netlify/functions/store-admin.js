/**
 * store-admin.js — Pop-Up Store seasons and the seller register.
 *
 * GET  /api/store-admin?village=                 → { seasons, sellers, vocab, scope }
 * GET  /api/store-admin?village=&season=<pageId> → { season, sellers, products, orders, summary }
 * POST /api/store-admin { village?, kind:'season'|'seller', action, ... }
 *   save    { pageId?, ...fields }
 *   status  { pageId, status }
 *   delete  { pageId }      village ADMIN only (Notion trash)
 *
 * Roles: admin | steward (Growth plan). A steward sees and edits only the
 * sellers they are named on (Steward Email) — the Services-directory pattern.
 * Opening/closing a season, approving a seller and deleting are admin-only.
 *
 * ⛔ Money: a seller's payment link is sanitised to an https URL and nothing
 * else, and the village never holds a seller's funds. See _store.js header.
 */

import {
  SEASON_STATUSES, SELLER_STATUSES, SELLER_TYPES, PAYMENT_METHODS, FULFILMENT_TYPES,
  PRODUCT_CATEGORIES, PRODUCT_STATUSES, ORDER_PAYMENT_STATUSES, ORDER_FULFILMENT_STATUSES,
  ORDER_OPEN_FULFILMENT,
  jsonResp, rtChunks, clean, money, dateOrNull, today, slugify, sanitisePaymentLink,
  queryVillage, getRow, createRow, patchRow, archiveRow, stampFor, requireStore, sellerScope,
  parseSeason, parseSeller, parseProduct, parseOrder,
} from './_store.js';
import { requireRole } from './_auth.js';

const VILLAGE_OF = (v) => v || process.env.VILLAGE_NAME || 'Smiths Lake';

const VOCAB = {
  seasonStatuses: SEASON_STATUSES,
  sellerStatuses: SELLER_STATUSES,
  sellerTypes: SELLER_TYPES,
  paymentMethods: PAYMENT_METHODS,
  fulfilmentTypes: FULFILMENT_TYPES,
  productCategories: PRODUCT_CATEGORIES,
  productStatuses: PRODUCT_STATUSES,
  orderPaymentStatuses: ORDER_PAYMENT_STATUSES,
  orderFulfilmentStatuses: ORDER_FULFILMENT_STATUSES,
};

export const handler = async (event, context) => {
  const q = event.queryStringParameters || {};

  /* ── READ ─────────────────────────────────────────────────────────── */
  if (event.httpMethod === 'GET') {
    const village = VILLAGE_OF(q.village);
    const auth = await requireStore(context, village);
    if (!auth.ok) return jsonResp(auth.status, { error: auth.error });
    const isAdmin = requireRole(context, { village, anyOf: ['admin'] }).ok;

    try {
      const [seasonPages, sellerPages] = await Promise.all([
        queryVillage('seasons', village, [{ property: 'Opens', direction: 'descending' }]),
        queryVillage('sellers', village, [{ property: 'Seller', direction: 'ascending' }]),
      ]);
      const allSellers = sellerPages.map(parseSeller);
      const scope = sellerScope(auth.user, village, allSellers, isAdmin);
      const sellers = scope ? allSellers.filter((s) => scope.has(s.id)) : allSellers;

      // One season, in full: its sellers, their range, and its orders.
      if (q.season) {
        const season = await getRow('seasons', q.season, village, parseSeason);
        if (!season) return jsonResp(404, { error: 'Season not found' });
        const [productPages, orderPages] = await Promise.all([
          queryVillage('products', village, [{ property: 'Sort', direction: 'ascending' }]),
          queryVillage('orders', village, [{ property: 'Placed Date', direction: 'descending' }]),
        ]);
        let products = productPages.map(parseProduct).filter((p) => p.season === season.id);
        let orders = orderPages.map(parseOrder).filter((o) => o.season === season.id);
        if (scope) {
          products = products.filter((p) => scope.has(p.seller));
          orders = orders.filter((o) => scope.has(o.seller));
        }
        const paid = orders.filter((o) => o.paymentStatus === 'Paid — confirmed by seller');
        return jsonResp(200, {
          season, sellers, products, orders, vocab: VOCAB, isAdmin, scoped: !!scope,
          summary: {
            sellersLive: sellers.filter((s) => s.status === 'Live').length,
            productsActive: products.filter((p) => p.status === 'Active').length,
            orders: orders.length,
            ordersOpen: orders.filter((o) => ORDER_OPEN_FULFILMENT.includes(o.fulfilmentStatus)).length,
            // Value sellers reported as paid. It is THEIR money, reported here
            // only so a committee can see the store is working.
            paidValue: Math.round(paid.reduce((s, o) => s + Number(o.total || 0), 0) * 100) / 100,
            awaitingPayment: orders.filter((o) => o.paymentStatus === 'Awaiting payment').length,
          },
        });
      }

      // The list view: seasons with counts, plus the seller register.
      const [productPages, orderPages] = await Promise.all([
        queryVillage('products', village),
        queryVillage('orders', village),
      ]);
      const products = productPages.map(parseProduct);
      const orders = orderPages.map(parseOrder);
      const seasons = seasonPages.map(parseSeason).map((s) => ({
        ...s,
        sellersLive: sellers.filter((sel) => sel.status === 'Live').length,
        productsActive: products.filter((p) => p.season === s.id && p.status === 'Active' && (!scope || scope.has(p.seller))).length,
        orders: orders.filter((o) => o.season === s.id && (!scope || scope.has(o.seller))).length,
        ordersOpen: orders.filter((o) => o.season === s.id && ORDER_OPEN_FULFILMENT.includes(o.fulfilmentStatus) && (!scope || scope.has(o.seller))).length,
      }));
      return jsonResp(200, { seasons, sellers, vocab: VOCAB, isAdmin, scoped: !!scope });
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
  const auth = await requireStore(context, village);
  if (!auth.ok) return jsonResp(auth.status, { error: auth.error });
  const isAdmin = requireRole(context, { village, anyOf: ['admin'] }).ok;
  const stamp = stampFor(auth.user);
  const kind = body.kind === 'seller' ? 'seller' : 'season';

  try {
    /* ── SEASONS (admin only — opening a store is a committee decision) ── */
    if (kind === 'season') {
      if (!isAdmin) return jsonResp(403, { error: 'Only a village admin can open, change or close a pop-up season' });

      if (body.action === 'save') {
        const name = clean(body.name, 200);
        if (!name) return jsonResp(400, { error: 'The season needs a name — e.g. “Summer market 2026–27”' });
        if (body.opens && body.closes && body.closes < body.opens) {
          return jsonResp(400, { error: 'The season closes before it opens — check the dates' });
        }
        const properties = {
          'Season': { title: [{ text: { content: name } }] },
          'Village': { rich_text: rtChunks(village.slice(0, 100)) },
          'Opens': dateOrNull(body.opens),
          'Closes': dateOrNull(body.closes),
          'Collection Points': { rich_text: rtChunks(clean(body.collectionPoints, 2000)) },
          'Terms': { rich_text: rtChunks(clean(body.terms, 4000)) },
          'Coordinator': { rich_text: rtChunks(clean(body.coordinator, 200)) },
          'Notes': { rich_text: rtChunks(clean(body.notes, 4000)) },
          ...stamp,
        };
        if (body.pageId) {
          const existing = await getRow('seasons', body.pageId, village, parseSeason);
          if (!existing) return jsonResp(404, { error: 'Season not found' });
          await patchRow(body.pageId, properties);
          return jsonResp(200, { ok: true, pageId: body.pageId });
        }
        properties['Status'] = { select: { name: 'Draft' } };
        properties['Logged By'] = { rich_text: rtChunks(auth.user.email || 'admin') };
        return jsonResp(200, { ok: true, pageId: await createRow('seasons', properties) });
      }

      if (body.action === 'status') {
        if (!SEASON_STATUSES.includes(body.status)) return jsonResp(400, { error: 'Unknown status' });
        const existing = await getRow('seasons', body.pageId, village, parseSeason);
        if (!existing) return jsonResp(404, { error: 'Season not found' });
        const props = { 'Status': { select: { name: body.status } }, ...stamp };
        if (body.status === 'Open' && !existing.opens) props['Opens'] = { date: { start: today() } };
        if (body.status === 'Closed' && !existing.closes) props['Closes'] = { date: { start: today() } };
        await patchRow(body.pageId, props);
        return jsonResp(200, { ok: true });
      }

      if (body.action === 'delete') {
        const existing = await getRow('seasons', body.pageId, village, parseSeason);
        if (!existing) return jsonResp(404, { error: 'Season not found' });
        // Products and orders are NOT cascaded — an order is a trading record.
        await archiveRow(body.pageId);
        return jsonResp(200, { ok: true });
      }

      return jsonResp(400, { error: 'Unknown action' });
    }

    /* ── SELLERS ────────────────────────────────────────────────────────── */
    const existing = body.pageId ? await getRow('sellers', body.pageId, village, parseSeller) : null;
    if (body.pageId && !existing) return jsonResp(404, { error: 'Seller not found' });

    // A steward may only touch a seller they are named on.
    if (existing && !isAdmin) {
      const mine = String(existing.stewardEmail || '').toLowerCase().split(/[,;\s]+/).filter(Boolean);
      if (!mine.includes(String(auth.user.email || '').toLowerCase())) {
        return jsonResp(403, { error: 'You can only manage the sellers you are the steward for' });
      }
    }

    if (body.action === 'save') {
      const name = clean(body.name, 200);
      if (!name) return jsonResp(400, { error: 'The seller needs a name' });
      if (body.sellerType && !SELLER_TYPES.includes(body.sellerType)) return jsonResp(400, { error: 'Unknown seller type' });
      if (body.paymentMethod && !PAYMENT_METHODS.includes(body.paymentMethod)) return jsonResp(400, { error: 'Unknown payment method' });
      if (body.fulfilment && !FULFILMENT_TYPES.includes(body.fulfilment)) return jsonResp(400, { error: 'Unknown fulfilment type' });

      // The money invariant, enforced: only an https link survives. Anything
      // else (a BSB, an account number, a secret pasted by mistake) is dropped
      // and the caller is told why, rather than silently stored.
      const rawLink = clean(body.paymentLink, 500);
      const paymentLink = sanitisePaymentLink(rawLink);
      if (rawLink && !paymentLink) {
        return jsonResp(400, {
          error: 'The payment link must be a full https:// web address (the seller’s own payment or store page). Never enter bank or card details here — the village never handles a seller’s money.',
        });
      }

      const properties = {
        'Seller': { title: [{ text: { content: name } }] },
        'Village': { rich_text: rtChunks(village.slice(0, 100)) },
        'Slug': { rich_text: rtChunks(slugify(body.slug || name)) },
        'Seller Type': body.sellerType ? { select: { name: body.sellerType } } : { select: null },
        'Contact Name': { rich_text: rtChunks(clean(body.contactName, 200)) },
        'Contact Email': { rich_text: rtChunks(clean(body.contactEmail, 200)) },
        'Contact Phone': { rich_text: rtChunks(clean(body.contactPhone, 60)) },
        'ABN': { rich_text: rtChunks(clean(body.abn, 40)) },
        'About': { rich_text: rtChunks(clean(body.about, 4000)) },
        'Logo URL': { url: sanitisePaymentLink(body.logoUrl) || null },
        'Payment Method': body.paymentMethod ? { select: { name: body.paymentMethod } } : { select: null },
        'Payment Link': { url: paymentLink || null },
        'Fulfilment': body.fulfilment ? { select: { name: body.fulfilment } } : { select: null },
        'Delivery Fee': { number: money(body.deliveryFee) },
        'Notes': { rich_text: rtChunks(clean(body.notes, 4000)) },
        ...stamp,
      };
      // Who stewards a seller, and whether the committee has confirmed the
      // seller can be paid directly, are the committee's calls — not a steward's.
      if (isAdmin) {
        properties['Steward Email'] = { rich_text: rtChunks(clean(body.stewardEmail, 400)) };
        properties['Payment Confirmed'] = { checkbox: body.paymentConfirmed === true || body.paymentConfirmed === 'true' };
      }

      if (existing) {
        await patchRow(existing.id, properties);
        return jsonResp(200, { ok: true, pageId: existing.id });
      }
      if (!isAdmin) return jsonResp(403, { error: 'Only a village admin can add a new seller to the register' });
      properties['Status'] = { select: { name: 'Invited' } };
      properties['Logged By'] = { rich_text: rtChunks(auth.user.email || 'admin') };
      return jsonResp(200, { ok: true, pageId: await createRow('sellers', properties) });
    }

    if (body.action === 'status') {
      if (!SELLER_STATUSES.includes(body.status)) return jsonResp(400, { error: 'Unknown status' });
      if (!isAdmin) return jsonResp(403, { error: 'Only a village admin can approve, suspend or close a seller' });
      if (!existing) return jsonResp(404, { error: 'Seller not found' });
      // Going Live is the moment a seller can be seen and sold from, so it is
      // the moment the committee must have confirmed the seller gets paid
      // DIRECTLY — because the village will never hold that money for them.
      if (body.status === 'Live') {
        if (!existing.paymentMethod) {
          return jsonResp(400, { error: 'Set how this seller takes payment before going Live — every seller is paid directly, so the village needs to know how' });
        }
        if (['Their own payment link', 'Their own online store'].includes(existing.paymentMethod) && !existing.paymentLink) {
          return jsonResp(400, { error: 'That payment method needs the seller’s own https:// payment link before going Live' });
        }
        if (!existing.paymentConfirmed) {
          return jsonResp(400, { error: 'Tick “payment arrangement confirmed” first — the committee needs to have checked the seller is paid directly' });
        }
      }
      const props = { 'Status': { select: { name: body.status } }, ...stamp };
      if (['Approved', 'Live'].includes(body.status) && !existing.approvedBy) {
        props['Approved By'] = { rich_text: rtChunks(`${auth.user.email || 'admin'} · ${today()}`) };
      }
      await patchRow(body.pageId, props);
      return jsonResp(200, { ok: true });
    }

    if (body.action === 'delete') {
      if (!isAdmin) return jsonResp(403, { error: 'Only a village admin can delete — mark the seller Closed instead to keep the record' });
      if (!existing) return jsonResp(404, { error: 'Seller not found' });
      await archiveRow(body.pageId);
      return jsonResp(200, { ok: true });
    }

    return jsonResp(400, { error: 'Unknown action' });
  } catch (err) {
    return jsonResp(502, { error: err.message });
  }
};

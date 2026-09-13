/**
 * store-orders.js — orders and fulfilment for the Pop-Up Store.
 *
 * GET  /api/store-orders?village=&season=&format=csv → the season's orders as CSV
 * POST /api/store-orders { village?, action, ... }
 *   save      { pageId?, seller, season, buyerName, buyerEmail, buyerPhone?,
 *               items:[{productId, qty}], fulfilment?, collectionPoint?, notes? }
 *   payment   { pageId, paymentStatus }      what the SELLER reported
 *   fulfil    { pageId, fulfilmentStatus }
 *   delete    { pageId }                     village ADMIN only (Notion trash)
 *
 * ⛔ Money: `payment` records what the seller told the committee. The platform
 * never receives, holds or forwards a seller's money, so it never asserts a
 * payment itself — hence the status label "Paid — confirmed by seller".
 *
 * ⛔ ONE SELLER PER ORDER. priceOrder() in _store.js refuses a basket that
 * spans two sellers: splitting and forwarding funds is exactly the payment-
 * facilitator behaviour that attracts AFSL/AUSTRAC obligations in Australia.
 *
 * Every order is re-priced server-side from the product rows. A price, a total
 * or a stock figure from the client is never trusted.
 *
 * Roles: admin | steward (Growth plan); a steward is scoped to the sellers they
 * steward. In this phase orders are entered by the committee or the seller
 * (market day, phone, email); a resident-facing storefront is a later phase and
 * would post here through the fail-closed isModulePublic() gate.
 */

import {
  ORDER_PAYMENT_STATUSES, ORDER_FULFILMENT_STATUSES, ORDER_OPEN_FULFILMENT, FULFILMENT_TYPES,
  jsonResp, rtChunks, clean, money, today, orderRef, priceOrder, csvCell,
  queryVillage, getRow, createRow, patchRow, archiveRow, stampFor, requireStore, sellerScope,
  parseOrder, parseSeller, parseSeason, parseProduct,
} from './_store.js';
import { requireRole } from './_auth.js';

const VILLAGE_OF = (v) => v || process.env.VILLAGE_NAME || 'Smiths Lake';
const PAID = 'Paid — confirmed by seller';

function mayManageSeller(user, seller, isAdmin) {
  if (isAdmin) return true;
  const mine = String(seller.stewardEmail || '').toLowerCase().split(/[,;\s]+/).filter(Boolean);
  return mine.includes(String(user?.email || '').toLowerCase());
}

function ordersCsv(season, orders, sellersById) {
  const lines = [];
  lines.push(['Pop-up season', season.name].map(csvCell).join(','));
  lines.push(['Village', season.village].map(csvCell).join(','));
  lines.push(['Period', `${season.opens || '(no open date)'} to ${season.closes || 'ongoing'}`].map(csvCell).join(','));
  lines.push(['Exported', today()].map(csvCell).join(','));
  lines.push([]);
  lines.push(['Every seller is paid directly by the buyer. Payment status below is what the seller reported —'].map(csvCell).join(','));
  lines.push(['the village never receives or holds a seller’s money, so these totals are not village income.'].map(csvCell).join(','));
  lines.push([]);
  lines.push(['Order', 'Placed', 'Seller', 'Buyer', 'Buyer email', 'Buyer phone', 'Items',
    'Subtotal ($)', 'Delivery ($)', 'Total ($)', 'Payment status', 'Payment method',
    'Fulfilment', 'Fulfilment status', 'Collection point', 'Notes'].map(csvCell).join(','));
  orders.forEach((o) => {
    const seller = sellersById[o.seller];
    const items = (o.items || []).map((i) => `${i.qty} × ${i.title} @ $${Number(i.unitPrice || 0).toFixed(2)}`).join(' | ');
    lines.push([o.ref, o.placedDate, seller ? seller.name : '(seller removed)', o.buyerName, o.buyerEmail,
      o.buyerPhone, items, o.subtotal, o.deliveryFee, o.total, o.paymentStatus, o.paymentMethod,
      o.fulfilment, o.fulfilmentStatus, o.collectionPoint, o.notes].map(csvCell).join(','));
  });
  lines.push([]);
  lines.push(['PER-SELLER TOTALS (reported as paid)'].map(csvCell).join(','));
  lines.push(['Seller', 'Orders', 'Reported paid ($)', 'Awaiting payment'].map(csvCell).join(','));
  Object.values(sellersById).forEach((s) => {
    const mine = orders.filter((o) => o.seller === s.id);
    if (!mine.length) return;
    const paid = mine.filter((o) => o.paymentStatus === PAID);
    lines.push([s.name, mine.length,
      Math.round(paid.reduce((t, o) => t + Number(o.total || 0), 0) * 100) / 100,
      mine.filter((o) => o.paymentStatus === 'Awaiting payment').length].map(csvCell).join(','));
  });
  return lines.join('\n');
}

export const handler = async (event, context) => {
  const q = event.queryStringParameters || {};

  /* ── CSV EXPORT ───────────────────────────────────────────────────── */
  if (event.httpMethod === 'GET') {
    const village = VILLAGE_OF(q.village);
    const auth = await requireStore(context, village);
    if (!auth.ok) return jsonResp(auth.status, { error: auth.error });
    const isAdmin = requireRole(context, { village, anyOf: ['admin'] }).ok;
    if (!q.season) return jsonResp(400, { error: 'Which season? Pass ?season=<id>' });

    try {
      const season = await getRow('seasons', q.season, village, parseSeason);
      if (!season) return jsonResp(404, { error: 'Season not found' });
      const [orderPages, sellerPages] = await Promise.all([
        queryVillage('orders', village, [{ property: 'Placed Date', direction: 'ascending' }]),
        queryVillage('sellers', village),
      ]);
      const allSellers = sellerPages.map(parseSeller);
      const scope = sellerScope(auth.user, village, allSellers, isAdmin);
      const sellers = scope ? allSellers.filter((s) => scope.has(s.id)) : allSellers;
      const sellersById = Object.fromEntries(sellers.map((s) => [s.id, s]));
      const orders = orderPages.map(parseOrder)
        .filter((o) => o.season === season.id)
        .filter((o) => !scope || scope.has(o.seller));

      if (q.format !== 'csv') return jsonResp(200, { season, orders });
      const slug = String(season.name || 'season').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="popup-store-${slug || 'season'}-${today()}.csv"`,
        },
        body: ordersCsv(season, orders, sellersById),
      };
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

  try {
    const existing = body.pageId ? await getRow('orders', body.pageId, village, parseOrder) : null;
    if (body.pageId && !existing) return jsonResp(404, { error: 'Order not found' });

    // Everything below is scoped to the order's seller.
    if (existing) {
      const owner = await getRow('sellers', existing.seller, village, parseSeller);
      if (owner && !mayManageSeller(auth.user, owner, isAdmin)) {
        return jsonResp(403, { error: 'You can only work on orders for the sellers you are the steward for' });
      }
    }

    /* ── SAVE ──────────────────────────────────────────────────────────── */
    if (body.action === 'save') {
      const sellerId = clean(body.seller, 60) || (existing ? existing.seller : '');
      const seasonId = clean(body.season, 60) || (existing ? existing.season : '');
      if (!sellerId) return jsonResp(400, { error: 'Pick the seller — one order belongs to exactly one seller' });
      if (!seasonId) return jsonResp(400, { error: 'Pick the pop-up season' });

      const seller = await getRow('sellers', sellerId, village, parseSeller);
      if (!seller) return jsonResp(404, { error: 'Seller not found for this village' });
      const season = await getRow('seasons', seasonId, village, parseSeason);
      if (!season) return jsonResp(404, { error: 'Season not found for this village' });
      if (!mayManageSeller(auth.user, seller, isAdmin)) {
        return jsonResp(403, { error: 'You can only take orders for the sellers you are the steward for' });
      }
      const buyerName = clean(body.buyerName, 200);
      if (!buyerName) return jsonResp(400, { error: 'The order needs a buyer name' });
      if (body.fulfilment && !FULFILMENT_TYPES.includes(body.fulfilment)) return jsonResp(400, { error: 'Unknown fulfilment type' });

      // Re-price from the PRODUCT rows — a price or total from the client is
      // never trusted, and a basket spanning two sellers is refused.
      const productPages = await queryVillage('products', village);
      const products = productPages.map(parseProduct).filter((p) => p.season === season.id);
      const priced = priceOrder(body.items, products, seller);
      if (priced.error) return jsonResp(400, { error: priced.error });

      const deliveryFee = money(body.deliveryFee) ?? (seller.deliveryFee || 0);
      const total = Math.round((priced.subtotal + Number(deliveryFee || 0)) * 100) / 100;

      const properties = {
        'Village': { rich_text: rtChunks(village.slice(0, 100)) },
        'Seller': { rich_text: rtChunks(seller.id) },
        'Season': { rich_text: rtChunks(season.id) },
        'Buyer Name': { rich_text: rtChunks(buyerName) },
        'Buyer Email': { rich_text: rtChunks(clean(body.buyerEmail, 200)) },
        'Buyer Phone': { rich_text: rtChunks(clean(body.buyerPhone, 60)) },
        'Items': { rich_text: rtChunks(JSON.stringify(priced.items)) },
        'Subtotal': { number: priced.subtotal },
        'Delivery Fee': { number: money(deliveryFee) },
        'Total': { number: total },
        'Payment Method': seller.paymentMethod ? { select: { name: seller.paymentMethod } } : { select: null },
        'Fulfilment': { select: { name: FULFILMENT_TYPES.includes(body.fulfilment) ? body.fulfilment : (seller.fulfilment || 'Pickup at collection point') } },
        'Collection Point': { rich_text: rtChunks(clean(body.collectionPoint, 400)) },
        'Notes': { rich_text: rtChunks(clean(body.notes, 4000)) },
        ...stamp,
      };

      if (existing) {
        await patchRow(existing.id, properties);
        return jsonResp(200, { ok: true, pageId: existing.id, total });
      }
      if (seller.status !== 'Live') {
        return jsonResp(400, { error: `“${seller.name}” is ${seller.status}, not Live — a seller has to be Live before orders can be taken` });
      }
      properties['Order'] = { title: [{ text: { content: orderRef(village) } }] };
      properties['Payment Status'] = { select: { name: 'Awaiting payment' } };
      properties['Fulfilment Status'] = { select: { name: 'New' } };
      properties['Placed Date'] = { date: { start: body.placedDate || today() } };
      properties['Logged By'] = { rich_text: rtChunks(auth.user.email || 'admin') };
      return jsonResp(200, { ok: true, pageId: await createRow('orders', properties), total });
    }

    /* ── PAYMENT (what the seller reported) ────────────────────────────── */
    if (body.action === 'payment') {
      if (!ORDER_PAYMENT_STATUSES.includes(body.paymentStatus)) return jsonResp(400, { error: 'Unknown payment status' });
      if (!existing) return jsonResp(404, { error: 'Order not found' });
      await patchRow(body.pageId, { 'Payment Status': { select: { name: body.paymentStatus } }, ...stamp });
      return jsonResp(200, { ok: true });
    }

    /* ── FULFILMENT ────────────────────────────────────────────────────── */
    if (body.action === 'fulfil') {
      if (!ORDER_FULFILMENT_STATUSES.includes(body.fulfilmentStatus)) return jsonResp(400, { error: 'Unknown fulfilment status' });
      if (!existing) return jsonResp(404, { error: 'Order not found' });
      const props = { 'Fulfilment Status': { select: { name: body.fulfilmentStatus } }, ...stamp };
      const done = ['Collected', 'Completed'].includes(body.fulfilmentStatus);
      if (done && !existing.completedDate) props['Completed Date'] = { date: { start: today() } };
      if (ORDER_OPEN_FULFILMENT.includes(body.fulfilmentStatus) && existing.completedDate) props['Completed Date'] = { date: null };
      await patchRow(body.pageId, props);
      return jsonResp(200, { ok: true });
    }

    if (body.action === 'delete') {
      if (!isAdmin) return jsonResp(403, { error: 'Only a village admin can delete — cancel the order instead to keep the record' });
      if (!existing) return jsonResp(404, { error: 'Order not found' });
      await archiveRow(body.pageId);
      return jsonResp(200, { ok: true });
    }

    return jsonResp(400, { error: 'Unknown action' });
  } catch (err) {
    return jsonResp(502, { error: err.message });
  }
};

/**
 * store-orders.js — orders and fulfilment for the Pop-Up Store.
 *
 * GET  /api/store-orders?village=&season=&format=csv → the season's orders as CSV
 * POST /api/store-orders { village?, action, ... }
 *   save      { pageId?, seller, season, buyerName, buyerEmail, buyerPhone?,
 *               items:[{productId, qty}], fulfilment?, collectionPoint?, notes? }
 *   payment   { pageId, paymentStatus }      what the SELLER reported
 *   fulfil    { pageId, fulfilmentStatus }
 *   delete    { pageId }                     village ADMIN only (soft delete)
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
 * steward. Buyer contact details live in Supabase behind deny-by-default RLS.
 */

import {
  T_SEASONS, T_SELLERS, T_PRODUCTS, T_ORDERS,
  ORDER_PAYMENT_STATUSES, ORDER_FULFILMENT_STATUSES, ORDER_OPEN_FULFILMENT, FULFILMENT_TYPES,
  jsonResp, clean, money, today, slugVillage, orderRef, priceOrder, csvCell,
  queryVillage, getRow, createRow, patchRow, archiveRow, stampFor, requireStore, sellerScope,
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
      const season = await getRow(T_SEASONS, q.season, village);
      if (!season) return jsonResp(404, { error: 'Season not found' });
      const [allOrders, allSellers] = await Promise.all([
        queryVillage(T_ORDERS, village, 'placed_date.asc.nullslast'),
        queryVillage(T_SELLERS, village),
      ]);
      const scope = sellerScope(auth.user, village, allSellers, isAdmin);
      const sellers = scope ? allSellers.filter((s) => scope.has(s.id)) : allSellers;
      const sellersById = Object.fromEntries(sellers.map((s) => [s.id, s]));
      const orders = allOrders
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
    const existing = body.pageId ? await getRow(T_ORDERS, body.pageId, village) : null;
    if (body.pageId && !existing) return jsonResp(404, { error: 'Order not found' });

    // Everything below is scoped to the order's seller.
    if (existing) {
      const owner = await getRow(T_SELLERS, existing.seller, village);
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

      const seller = await getRow(T_SELLERS, sellerId, village);
      if (!seller) return jsonResp(404, { error: 'Seller not found for this village' });
      const season = await getRow(T_SEASONS, seasonId, village);
      if (!season) return jsonResp(404, { error: 'Season not found for this village' });
      if (!mayManageSeller(auth.user, seller, isAdmin)) {
        return jsonResp(403, { error: 'You can only take orders for the sellers you are the steward for' });
      }
      const buyerName = clean(body.buyerName, 200);
      if (!buyerName) return jsonResp(400, { error: 'The order needs a buyer name' });
      if (body.fulfilment && !FULFILMENT_TYPES.includes(body.fulfilment)) return jsonResp(400, { error: 'Unknown fulfilment type' });

      // Re-price from the PRODUCT rows — a price or total from the client is
      // never trusted, and a basket spanning two sellers is refused.
      const allProducts = await queryVillage(T_PRODUCTS, village);
      const products = allProducts.filter((p) => p.season === season.id);
      const priced = priceOrder(body.items, products, seller);
      if (priced.error) return jsonResp(400, { error: priced.error });

      const deliveryFee = money(body.deliveryFee) ?? (seller.deliveryFee || 0);
      const total = Math.round((priced.subtotal + Number(deliveryFee || 0)) * 100) / 100;

      const values = {
        seller_id: seller.id,
        season_id: season.id,
        buyer_name: buyerName,
        buyer_email: clean(body.buyerEmail, 200),
        buyer_phone: clean(body.buyerPhone, 60),
        items: priced.items,
        subtotal: priced.subtotal,
        delivery_fee: money(deliveryFee),
        total,
        payment_method: seller.paymentMethod || null,
        fulfilment: FULFILMENT_TYPES.includes(body.fulfilment) ? body.fulfilment : (seller.fulfilment || 'Pickup at collection point'),
        collection_point: clean(body.collectionPoint, 400),
        notes: clean(body.notes, 4000),
        ...stamp,
      };

      if (existing) {
        await patchRow(T_ORDERS, existing.id, village, values);
        return jsonResp(200, { ok: true, pageId: existing.id, total });
      }
      if (seller.status !== 'Live') {
        return jsonResp(400, { error: `“${seller.name}” is ${seller.status}, not Live — a seller has to be Live before orders can be taken` });
      }
      const pageId = await createRow(T_ORDERS, {
        ...values,
        village_id: slugVillage(village),
        ref: orderRef(village),
        payment_status: 'Awaiting payment',
        fulfilment_status: 'New',
        placed_date: body.placedDate ? String(body.placedDate).slice(0, 10) : today(),
        logged_by: auth.user.email || 'admin',
      });
      return jsonResp(200, { ok: true, pageId, total });
    }

    /* ── PAYMENT (what the seller reported) ────────────────────────────── */
    if (body.action === 'payment') {
      if (!ORDER_PAYMENT_STATUSES.includes(body.paymentStatus)) return jsonResp(400, { error: 'Unknown payment status' });
      if (!existing) return jsonResp(404, { error: 'Order not found' });
      await patchRow(T_ORDERS, body.pageId, village, { payment_status: body.paymentStatus, ...stamp });
      return jsonResp(200, { ok: true });
    }

    /* ── FULFILMENT ────────────────────────────────────────────────────── */
    if (body.action === 'fulfil') {
      if (!ORDER_FULFILMENT_STATUSES.includes(body.fulfilmentStatus)) return jsonResp(400, { error: 'Unknown fulfilment status' });
      if (!existing) return jsonResp(404, { error: 'Order not found' });
      const values = { fulfilment_status: body.fulfilmentStatus, ...stamp };
      const done = ['Collected', 'Completed'].includes(body.fulfilmentStatus);
      if (done && !existing.completedDate) values.completed_date = today();
      if (ORDER_OPEN_FULFILMENT.includes(body.fulfilmentStatus) && existing.completedDate) values.completed_date = null;
      await patchRow(T_ORDERS, body.pageId, village, values);
      return jsonResp(200, { ok: true });
    }

    if (body.action === 'delete') {
      if (!isAdmin) return jsonResp(403, { error: 'Only a village admin can delete — cancel the order instead to keep the record' });
      if (!existing) return jsonResp(404, { error: 'Order not found' });
      await archiveRow(T_ORDERS, body.pageId, village);
      return jsonResp(200, { ok: true });
    }

    return jsonResp(400, { error: 'Unknown action' });
  } catch (err) {
    return jsonResp(502, { error: err.message });
  }
};

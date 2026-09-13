/**
 * store-catalogue.js — a seller's range for a pop-up season.
 *
 * POST /api/store-catalogue { village?, action, ... }
 *   save    { pageId?, seller, season, name, category?, description?, price,
 *             stock?, unlimitedStock?, fulfilment?, imageUrl?, sku?, sort?, notes? }
 *   status  { pageId, status }   Draft | Active | Sold out | Withdrawn
 *   delete  { pageId }          village ADMIN only (soft delete — recoverable)
 *
 * Reading happens through /api/store-admin?season=… (one round trip returns the
 * season, its sellers, products and orders), so this endpoint is write-only.
 *
 * Roles: admin | steward (Growth plan). A steward may only list products for a
 * seller they are the named steward of — the Services-directory pattern.
 * A product cannot go Active unless its seller is Live, so nothing can be
 * offered for sale by a seller the committee has not approved and confirmed a
 * direct payment arrangement for.
 */

import {
  T_SELLERS, T_SEASONS, T_PRODUCTS,
  PRODUCT_STATUSES, PRODUCT_CATEGORIES, FULFILMENT_TYPES,
  jsonResp, clean, money, int, slugify, slugVillage, sanitisePaymentLink,
  getRow, createRow, patchRow, archiveRow, stampFor, requireStore,
} from './_store.js';
import { requireRole } from './_auth.js';

const VILLAGE_OF = (v) => v || process.env.VILLAGE_NAME || 'Smiths Lake';

/** May this user manage `seller`'s listing? */
function mayManageSeller(user, seller, isAdmin) {
  if (isAdmin) return true;
  const mine = String(seller.stewardEmail || '').toLowerCase().split(/[,;\s]+/).filter(Boolean);
  return mine.includes(String(user?.email || '').toLowerCase());
}

export const handler = async (event, context) => {
  if (event.httpMethod !== 'POST') return jsonResp(405, { error: 'POST only' });

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
    const existing = body.pageId ? await getRow(T_PRODUCTS, body.pageId, village) : null;
    if (body.pageId && !existing) return jsonResp(404, { error: 'Product not found' });

    /* ── SAVE ──────────────────────────────────────────────────────────── */
    if (body.action === 'save') {
      const name = clean(body.name, 200);
      if (!name) return jsonResp(400, { error: 'The product needs a name' });

      const sellerId = clean(body.seller, 60) || (existing ? existing.seller : '');
      const seasonId = clean(body.season, 60) || (existing ? existing.season : '');
      if (!sellerId) return jsonResp(400, { error: 'Pick the seller this product belongs to' });
      if (!seasonId) return jsonResp(400, { error: 'Pick the pop-up season this product is listed in' });

      const seller = await getRow(T_SELLERS, sellerId, village);
      if (!seller) return jsonResp(404, { error: 'Seller not found for this village' });
      const season = await getRow(T_SEASONS, seasonId, village);
      if (!season) return jsonResp(404, { error: 'Season not found for this village' });
      if (!mayManageSeller(auth.user, seller, isAdmin)) {
        return jsonResp(403, { error: 'You can only list products for the sellers you are the steward for' });
      }
      if (body.category && !PRODUCT_CATEGORIES.includes(body.category)) return jsonResp(400, { error: 'Unknown category' });
      if (body.fulfilment && !FULFILMENT_TYPES.includes(body.fulfilment)) return jsonResp(400, { error: 'Unknown fulfilment type' });

      const price = money(body.price);
      if (price == null) return jsonResp(400, { error: 'Give the product a price (0 is fine for a free or “donation” item)' });

      const values = {
        name,
        seller_id: seller.id,
        season_id: season.id,
        category: body.category || null,
        description: clean(body.description, 4000),
        price,
        stock: int(body.stock),
        unlimited_stock: body.unlimitedStock === true || body.unlimitedStock === 'true',
        fulfilment: body.fulfilment || null,
        image_url: sanitisePaymentLink(body.imageUrl) || null,
        sku: clean(body.sku, 60) || slugify(name).slice(0, 40),
        sort: int(body.sort) ?? 100,
        notes: clean(body.notes, 2000),
        ...stamp,
      };

      if (existing) {
        await patchRow(T_PRODUCTS, existing.id, village, values);
        return jsonResp(200, { ok: true, pageId: existing.id });
      }
      const pageId = await createRow(T_PRODUCTS, {
        ...values, village_id: slugVillage(village), status: 'Draft',
        logged_by: auth.user.email || 'admin',
      });
      return jsonResp(200, { ok: true, pageId });
    }

    /* ── STATUS ────────────────────────────────────────────────────────── */
    if (body.action === 'status') {
      if (!PRODUCT_STATUSES.includes(body.status)) return jsonResp(400, { error: 'Unknown status' });
      if (!existing) return jsonResp(404, { error: 'Product not found' });
      const seller = await getRow(T_SELLERS, existing.seller, village);
      if (!seller) return jsonResp(404, { error: 'That product’s seller is no longer in the register' });
      if (!mayManageSeller(auth.user, seller, isAdmin)) {
        return jsonResp(403, { error: 'You can only change products for the sellers you are the steward for' });
      }
      // Nothing can be offered for sale by a seller who is not Live — going
      // Live is where the committee's approval and the direct-payment check
      // happen (store-admin.js), so this is the one gate that enforces both.
      if (body.status === 'Active' && seller.status !== 'Live') {
        return jsonResp(400, { error: `“${seller.name}” is ${seller.status}, not Live — a seller has to be Live before their products can go Active` });
      }
      await patchRow(T_PRODUCTS, body.pageId, village, { status: body.status, ...stamp });
      return jsonResp(200, { ok: true });
    }

    /* ── DELETE ────────────────────────────────────────────────────────── */
    if (body.action === 'delete') {
      if (!isAdmin) return jsonResp(403, { error: 'Only a village admin can delete — mark the product Withdrawn instead to keep the record' });
      if (!existing) return jsonResp(404, { error: 'Product not found' });
      // Past orders keep a title + price snapshot in their items JSON, so
      // deleting a product never corrupts the trading record.
      await archiveRow(T_PRODUCTS, body.pageId, village);
      return jsonResp(200, { ok: true });
    }

    return jsonResp(400, { error: 'Unknown action' });
  } catch (err) {
    return jsonResp(502, { error: err.message });
  }
};

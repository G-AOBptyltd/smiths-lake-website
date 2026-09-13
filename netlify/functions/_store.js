/**
 * _store.js — shared helper for the Online Pop-Up Store module.
 *
 * A pop-up store is a SEASON: the village opens it, local sellers list their
 * range, orders come in, the season closes. Four registers, the Season as the
 * spine (the same shape as Projects and Recovery):
 *
 *   store_seasons    the pop-up itself — opens, closes, pickup points
 *   store_sellers    the seller register + approval lifecycle
 *   store_products   a seller's range for a season
 *   store_orders     one order = ONE seller (see below)
 *
 * ── STORAGE: SUPABASE, NOT NOTION (changed 13 Sep 2026) ─────────────────────
 * Like the Recovery module, this first shipped on Notion to match the
 * grants/projects pattern, and moved the same day before any real row existed.
 * An ORDER carries a buyer's name, email and phone, and a SELLER carries a
 * contact's details and ABN — personal data belongs in the Sydney Supabase
 * project behind deny-by-default RLS, not in a shared Notion workspace.
 *
 * ══ THE MONEY INVARIANT — DO NOT BREAK THIS ═════════════════════════════════
 * Every seller keeps their own money. The platform NEVER holds, pools, routes
 * or receives another seller's funds. Concretely, and enforced here:
 *
 *   1. A seller record stores only a seller-supplied PAYMENT LINK or a
 *      "how to pay me" method. Never bank account details, never card data,
 *      never an API key, never a platform balance. sanitisePaymentLink() below
 *      refuses anything that is not an https URL, and migration 0011
 *      deliberately gives the table no column to put one in.
 *   2. Payment status on an order is a record of what the SELLER told us
 *      ("Paid — confirmed by seller"). The platform never asserts that it
 *      received money, because it never does.
 *   3. ONE SELLER PER ORDER. A basket spanning two sellers would force the
 *      platform to split and forward funds — which is exactly the payment-
 *      facilitator behaviour that attracts AFSL/AUSTRAC obligations in
 *      Australia. A buyer wanting two sellers places two orders.
 *
 * This is what keeps the VillageFirst ↔ Agility Ops merchant separation intact
 * (see CLAUDE.md) and keeps the platform out of payment-facilitator territory.
 * It also means the open Stripe-Connect-vs-BYO-processor decision in
 * VillageFirst-Village-Commercial-Module-Marketplace-Architecture-v2.html §10
 * is NOT needed to run a store: a seller can trade from day one on their own
 * payment link, and a rail can be added later without changing this data model.
 * ════════════════════════════════════════════════════════════════════════════
 */

import { requireRole } from './_auth.js';
import { requireEntitlement } from './_entitlements.js';
import {
  selectVillage, selectOne, insertRow, updateRow, archiveRowById,
  slugVillage, clean, num, money, int, dateOrNull, today, jsonResp, csvCell, stampBy,
} from './_supa.js';

export { jsonResp, csvCell, clean, num, money, int, dateOrNull, today, slugVillage };

export const T_SEASONS = 'store_seasons';
export const T_SELLERS = 'store_sellers';
export const T_PRODUCTS = 'store_products';
export const T_ORDERS = 'store_orders';

/* ── Vocabulary (mirrored by CHECK constraints in migration 0011) ────────── */

export const SEASON_STATUSES = ['Draft', 'Open', 'Closed', 'Archived'];

export const SELLER_STATUSES = ['Invited', 'Onboarding', 'Approved', 'Live', 'Suspended', 'Closed'];
export const SELLER_TYPES = [
  'Local business', 'Maker or artisan', 'Community group fundraiser',
  'Farm or produce', 'Cornerstone range', 'Other',
];
/** How a seller takes money — always THEIR arrangement, never the village's. */
export const PAYMENT_METHODS = [
  'Their own payment link',
  'Their own online store',
  'Bank transfer or invoice direct to the seller',
  'In person at pickup',
];
export const FULFILMENT_TYPES = ['Pickup at collection point', 'Local delivery', 'Post', 'Digital download', 'Pickup from the seller'];

export const PRODUCT_STATUSES = ['Draft', 'Active', 'Sold out', 'Withdrawn'];
export const PRODUCT_CATEGORIES = [
  'Food & produce', 'Drinks', 'Art & prints', 'Craft & handmade', 'Clothing & caps',
  'Books & maps', 'Plants & garden', 'Homewares', 'Services', 'Fundraising', 'Other',
];

export const ORDER_PAYMENT_STATUSES = ['Awaiting payment', 'Paid — confirmed by seller', 'Refunded by seller', 'Cancelled'];
export const ORDER_FULFILMENT_STATUSES = ['New', 'Packed', 'Ready for pickup', 'Collected', 'Shipped', 'Completed', 'Cancelled'];
export const ORDER_OPEN_FULFILMENT = ['New', 'Packed', 'Ready for pickup', 'Shipped'];

/* ── Value helpers ──────────────────────────────────────────────────────── */

export function slugify(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

/**
 * A seller's payment link must be an https URL and nothing else. This is the
 * code half of the money invariant: it makes it impossible to smuggle a BSB, an
 * account number or an API secret into the field by mistake.
 * Returns '' for anything it will not accept.
 */
export function sanitisePaymentLink(v) {
  const s = String(v == null ? '' : v).trim().slice(0, 500);
  if (!s) return '';
  let u;
  try { u = new URL(s); } catch (_) { return ''; }
  if (u.protocol !== 'https:') return '';
  return u.toString().slice(0, 500);
}

/* ── Row mappers ────────────────────────────────────────────────────────── */

const jsonArr = (v) => (Array.isArray(v) ? v : []);
const numOrNull = (v) => (v == null ? null : Number(v));

export function parseSeason(r) {
  return {
    id: r.id,
    name: r.name || '',
    village: r.village_id || '',
    status: r.status || 'Draft',
    opens: r.opens || '',
    closes: r.closes || '',
    collectionPoints: r.collection_points || '',
    terms: r.terms || '',
    coordinator: r.coordinator || '',
    notes: r.notes || '',
    loggedBy: r.logged_by || '',
    lastUpdatedBy: r.last_updated_by || '',
  };
}

export function parseSeller(r) {
  return {
    id: r.id,
    name: r.name || '',
    village: r.village_id || '',
    slug: r.slug || '',
    status: r.status || 'Invited',
    sellerType: r.seller_type || '',
    contactName: r.contact_name || '',
    contactEmail: r.contact_email || '',
    contactPhone: r.contact_phone || '',
    abn: r.abn || '',
    about: r.about || '',
    logoUrl: r.logo_url || '',
    paymentMethod: r.payment_method || '',
    paymentLink: r.payment_link || '',
    paymentConfirmed: r.payment_confirmed === true,
    fulfilment: r.fulfilment || '',
    deliveryFee: numOrNull(r.delivery_fee),
    stewardEmail: r.steward_email || '',
    approvedBy: r.approved_by || '',
    notes: r.notes || '',
    loggedBy: r.logged_by || '',
    lastUpdatedBy: r.last_updated_by || '',
  };
}

export function parseProduct(r) {
  return {
    id: r.id,
    name: r.name || '',
    village: r.village_id || '',
    seller: r.seller_id || '',
    season: r.season_id || '',
    status: r.status || 'Draft',
    category: r.category || '',
    description: r.description || '',
    price: numOrNull(r.price),
    stock: numOrNull(r.stock),
    unlimitedStock: r.unlimited_stock === true,
    fulfilment: r.fulfilment || '',
    imageUrl: r.image_url || '',
    sku: r.sku || '',
    sort: numOrNull(r.sort),
    notes: r.notes || '',
    lastUpdatedBy: r.last_updated_by || '',
  };
}

export function parseOrder(r) {
  return {
    id: r.id,
    ref: r.ref || '',
    village: r.village_id || '',
    seller: r.seller_id || '',
    season: r.season_id || '',
    buyerName: r.buyer_name || '',
    buyerEmail: r.buyer_email || '',
    buyerPhone: r.buyer_phone || '',
    items: jsonArr(r.items),
    subtotal: numOrNull(r.subtotal),
    deliveryFee: numOrNull(r.delivery_fee),
    total: numOrNull(r.total),
    paymentStatus: r.payment_status || 'Awaiting payment',
    paymentMethod: r.payment_method || '',
    fulfilmentStatus: r.fulfilment_status || 'New',
    fulfilment: r.fulfilment || '',
    collectionPoint: r.collection_point || '',
    placedDate: r.placed_date || '',
    completedDate: r.completed_date || '',
    notes: r.notes || '',
    loggedBy: r.logged_by || '',
    lastUpdatedBy: r.last_updated_by || '',
  };
}

const PARSERS = {
  [T_SEASONS]: parseSeason, [T_SELLERS]: parseSeller,
  [T_PRODUCTS]: parseProduct, [T_ORDERS]: parseOrder,
};

/* ── Data access ────────────────────────────────────────────────────────── */

export async function queryVillage(table, village, order) {
  const rows = await selectVillage(table, village, { order });
  return rows.map(PARSERS[table]);
}

/** One row, proven to belong to this village (the cross-tenant guard). */
export async function getRow(table, id, village) {
  const row = await selectOne(table, id, village);
  return row ? PARSERS[table](row) : null;
}

export async function createRow(table, values) { return insertRow(table, values); }
export async function patchRow(table, id, village, values) { return updateRow(table, id, village, values); }
export async function archiveRow(table, id, village) { return archiveRowById(table, id, village); }

export function stampFor(user) {
  return { last_updated_by: stampBy(user) };
}

/* ── Order maths ────────────────────────────────────────────────────────── */

/**
 * Re-price an order from the PRODUCT rows, never from the client. Returns the
 * priced items plus the totals, and refuses a basket that spans two sellers
 * (the money invariant) or a product that is not on sale.
 */
export function priceOrder(rawItems, products, seller) {
  const items = [];
  let subtotal = 0;
  let sellerId = seller ? seller.id : null;
  for (const raw of Array.isArray(rawItems) ? rawItems.slice(0, 50) : []) {
    const p = products.find((x) => x.id === raw.productId);
    if (!p) return { error: 'One of those products is no longer listed — reload and try again' };
    if (sellerId && p.seller !== sellerId) {
      return { error: 'An order can only contain items from ONE seller — each seller is paid directly, so a second seller needs its own order' };
    }
    if (!sellerId) sellerId = p.seller;
    const qty = Math.max(1, Math.min(999, Math.floor(Number(raw.qty) || 1)));
    if (!p.unlimitedStock && p.stock != null && qty > p.stock) {
      return { error: `Only ${p.stock} × “${p.name}” left` };
    }
    const unitPrice = money(p.price) || 0;
    subtotal += unitPrice * qty;
    items.push({ productId: p.id, title: p.name, qty, unitPrice });
  }
  if (!items.length) return { error: 'The order has no items' };
  return { items, sellerId, subtotal: Math.round(subtotal * 100) / 100 };
}

/** "SL-260913-4821" — readable, sortable, unique enough for a village store. */
export function orderRef(village) {
  const initials = String(village || 'VF').split(/\s+/).map((w) => w[0] || '').join('').toUpperCase().slice(0, 3) || 'VF';
  const d = today().slice(2).replace(/-/g, '');
  const rand = String(Math.floor(1000 + Math.random() * 9000));
  return `${initials}-${d}-${rand}`;
}

/* ── Guard ──────────────────────────────────────────────────────────────── */

/**
 * The store is a Growth-plan module (see _entitlements.js MODULE_MIN_PLAN), so
 * every endpoint checks the role AND the village's plan. Roles: the village
 * admin runs the store; a steward manages sellers (mirroring the Services
 * directory, where service stewards manage their own listings).
 */
export async function requireStore(context, village, anyOf) {
  const auth = requireRole(context, { village, anyOf: anyOf || ['admin', 'steward'] });
  if (!auth.ok) return auth;
  const ent = await requireEntitlement(village, 'popup');
  if (!ent.ok) return { ok: false, status: ent.status, error: ent.error };
  return auth;
}

/**
 * Is this user restricted to ONE seller's records? A steward who is named as a
 * seller's Steward Email manages that seller and no other; a village admin sees
 * every seller. Returns null for "sees everything", or the set of seller ids.
 */
export function sellerScope(user, village, sellers, isAdmin) {
  if (isAdmin) return null;
  const email = String(user?.email || '').toLowerCase();
  if (!email) return new Set();
  return new Set(
    sellers
      .filter((s) => String(s.stewardEmail || '').toLowerCase().split(/[,;\s]+/).filter(Boolean).includes(email))
      .map((s) => s.id)
  );
}

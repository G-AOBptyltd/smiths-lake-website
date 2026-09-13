/**
 * _store.js — shared helper for the Online Pop-Up Store module.
 *
 * A pop-up store is a SEASON: the village opens it, local sellers list their
 * range, orders come in, the season closes. Four registers, the Season as the
 * spine (same shape as Projects and Recovery):
 *
 *   🛍 VF Store Seasons    the pop-up itself — opens, closes, pickup points
 *   🏪 VF Store Sellers    the seller register + approval lifecycle
 *   📦 VF Store Products   a seller's range for a season
 *   🧾 VF Store Orders     one order = ONE seller (see below)
 *
 * Each DB resolves env var → Notion search by title → auto-create under the
 * Contributions DB's parent page, so a new village needs no manual Notion setup.
 *
 * ══ THE MONEY INVARIANT — DO NOT BREAK THIS ═════════════════════════════════
 * Every seller keeps their own money. The platform NEVER holds, pools, routes
 * or receives another seller's funds. Concretely, and enforced here:
 *
 *   1. A seller record stores only a seller-supplied PAYMENT LINK or a
 *      "how to pay me" method. Never bank account details, never card data,
 *      never an API key, never a platform balance. sanitisePaymentLink() below
 *      refuses anything that is not an https URL.
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

const NOTION_VERSION = '2022-06-28';
const CONTRIB_DB_ID = process.env.NOTION_CONTRIB_DB_ID || '6d182a0d4f0c42c2879f13753e355861';

export const SEASONS_DB_TITLE = '🛍 VF Store Seasons';
export const SELLERS_DB_TITLE = '🏪 VF Store Sellers';
export const PRODUCTS_DB_TITLE = '📦 VF Store Products';
export const ORDERS_DB_TITLE = '🧾 VF Store Orders';

/* ── Vocabulary ─────────────────────────────────────────────────────────── */

export const SEASON_STATUSES = ['Draft', 'Open', 'Closed', 'Archived'];

export const SELLER_STATUSES = ['Invited', 'Onboarding', 'Approved', 'Live', 'Suspended', 'Closed'];
// A seller may only have products shown while they are Live.
export const SELLER_TRADING = ['Live'];
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

/* ── Notion plumbing ────────────────────────────────────────────────────── */

export function notionHeaders() {
  return {
    Authorization: `Bearer ${process.env.NOTION_API_KEY}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  };
}

export function jsonResp(statusCode, obj) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}

export function rtChunks(s) {
  const out = [];
  s = String(s == null ? '' : s);
  for (let i = 0; i < s.length && out.length < 90; i += 1900) out.push({ text: { content: s.slice(i, i + 1900) } });
  return out;
}

export const rtText = (prop) => (prop?.rich_text || []).map((t) => t.plain_text).join('');
export const titleText = (prop) => (prop?.title || []).map((t) => t.plain_text).join('');
const selName = (prop) => prop?.select?.name || '';
const numOf = (prop) => (prop?.number ?? null);
const dateOf = (prop) => prop?.date?.start || '';
const urlOf = (prop) => prop?.url || '';

export function rtJson(prop, fallback) {
  try { const v = JSON.parse(rtText(prop) || 'null'); return v == null ? fallback : v; } catch (_) { return fallback; }
}

export function num(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Money, rounded to cents — never trust a float from a form. */
export function money(v) {
  const n = num(v);
  return n == null ? null : Math.round(n * 100) / 100;
}

export const dateOrNull = (v) => (v ? { date: { start: v } } : { date: null });
export const today = () => new Date().toISOString().slice(0, 10);
export const clean = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

export function slugify(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

/**
 * A seller's payment link must be an https URL and nothing else. This is the
 * code half of the money invariant: it makes it impossible to smuggle a BSB,
 * an account number or an API secret into the field by mistake.
 * Returns '' for anything it will not accept.
 */
export function sanitisePaymentLink(v) {
  const s = clean(v, 500);
  if (!s) return '';
  let u;
  try { u = new URL(s); } catch (_) { return ''; }
  if (u.protocol !== 'https:') return '';
  return u.toString().slice(0, 500);
}

const opts = (list) => ({ select: { options: list.map((name) => ({ name })) } });
const AUDIT = { 'Logged By': { rich_text: {} }, 'Last Updated By': { rich_text: {} } };

/* ── Schemas ────────────────────────────────────────────────────────────── */

const SEASON_SCHEMA = () => ({
  'Season': { title: {} },
  'Village': { rich_text: {} },
  'Status': opts(SEASON_STATUSES),
  'Opens': { date: {} },
  'Closes': { date: {} },
  'Collection Points': { rich_text: {} },
  'Terms': { rich_text: {} },
  'Coordinator': { rich_text: {} },
  'Notes': { rich_text: {} },
  ...AUDIT,
});

const SELLER_SCHEMA = () => ({
  'Seller': { title: {} },
  'Village': { rich_text: {} },
  'Slug': { rich_text: {} },
  'Status': opts(SELLER_STATUSES),
  'Seller Type': opts(SELLER_TYPES),
  'Contact Name': { rich_text: {} },
  'Contact Email': { rich_text: {} },
  'Contact Phone': { rich_text: {} },
  'ABN': { rich_text: {} },
  'About': { rich_text: {} },
  'Logo URL': { url: {} },
  // How THIS seller takes money. The village never holds it — see the header.
  'Payment Method': opts(PAYMENT_METHODS),
  'Payment Link': { url: {} },
  'Payment Confirmed': { checkbox: {} },   // the committee has seen the seller can be paid directly
  'Fulfilment': opts(FULFILMENT_TYPES),
  'Delivery Fee': { number: { format: 'australian_dollar' } },
  'Steward Email': { rich_text: {} },      // the Identity user who manages this seller's own listing
  'Approved By': { rich_text: {} },
  'Notes': { rich_text: {} },
  ...AUDIT,
});

const PRODUCT_SCHEMA = () => ({
  'Product': { title: {} },
  'Village': { rich_text: {} },
  'Seller': { rich_text: {} },             // the seller's page id
  'Season': { rich_text: {} },             // the season's page id
  'Status': opts(PRODUCT_STATUSES),
  'Category': opts(PRODUCT_CATEGORIES),
  'Description': { rich_text: {} },
  'Price': { number: { format: 'australian_dollar' } },
  'Stock': { number: {} },
  'Unlimited Stock': { checkbox: {} },
  'Fulfilment': opts(FULFILMENT_TYPES),
  'Image URL': { url: {} },
  'SKU': { rich_text: {} },
  'Sort': { number: {} },
  'Notes': { rich_text: {} },
  ...AUDIT,
});

const ORDER_SCHEMA = () => ({
  'Order': { title: {} },                  // human order reference
  'Village': { rich_text: {} },
  'Seller': { rich_text: {} },             // ONE seller per order — the money invariant
  'Season': { rich_text: {} },
  'Buyer Name': { rich_text: {} },
  'Buyer Email': { rich_text: {} },
  'Buyer Phone': { rich_text: {} },
  'Items': { rich_text: {} },              // JSON [{ productId, title, qty, unitPrice }]
  'Subtotal': { number: { format: 'australian_dollar' } },
  'Delivery Fee': { number: { format: 'australian_dollar' } },
  'Total': { number: { format: 'australian_dollar' } },
  'Payment Status': opts(ORDER_PAYMENT_STATUSES),
  'Payment Method': opts(PAYMENT_METHODS),
  'Fulfilment Status': opts(ORDER_FULFILMENT_STATUSES),
  'Fulfilment': opts(FULFILMENT_TYPES),
  'Collection Point': { rich_text: {} },
  'Placed Date': { date: {} },
  'Completed Date': { date: {} },
  'Notes': { rich_text: {} },
  ...AUDIT,
});

const REGISTERS = {
  seasons: { title: SEASONS_DB_TITLE, query: 'VF Store Seasons', env: 'NOTION_VF_STORE_SEASONS_DB_ID', schema: SEASON_SCHEMA },
  sellers: { title: SELLERS_DB_TITLE, query: 'VF Store Sellers', env: 'NOTION_VF_STORE_SELLERS_DB_ID', schema: SELLER_SCHEMA },
  products: { title: PRODUCTS_DB_TITLE, query: 'VF Store Products', env: 'NOTION_VF_STORE_PRODUCTS_DB_ID', schema: PRODUCT_SCHEMA },
  orders: { title: ORDERS_DB_TITLE, query: 'VF Store Orders', env: 'NOTION_VF_STORE_ORDERS_DB_ID', schema: ORDER_SCHEMA },
};

const cache = {};

async function findDbByTitle(title, query) {
  const res = await fetch('https://api.notion.com/v1/search', {
    method: 'POST', headers: notionHeaders(),
    body: JSON.stringify({ query, filter: { property: 'object', value: 'database' }, page_size: 20 }),
  });
  if (!res.ok) return null;
  const hits = (await res.json()).results || [];
  const hit = hits.find((d) => titleText(d) === title && !d.archived);
  return hit ? hit.id : null;
}

async function createDb(title, properties) {
  const res = await fetch(`https://api.notion.com/v1/databases/${CONTRIB_DB_ID}`, { headers: notionHeaders() });
  if (!res.ok) throw new Error(`Could not resolve a parent page for ${title}`);
  const parent = (await res.json()).parent || {};
  if (parent.type !== 'page_id') throw new Error(`Contributions DB has no page parent — set the ${title} DB id explicitly`);
  const cr = await fetch('https://api.notion.com/v1/databases', {
    method: 'POST', headers: notionHeaders(),
    body: JSON.stringify({ parent: { type: 'page_id', page_id: parent.page_id }, title: [{ text: { content: title } }], properties }),
  });
  if (!cr.ok) throw new Error(`Could not create ${title} (Notion ${cr.status})`);
  return (await cr.json()).id;
}

export async function dbId(which) {
  const reg = REGISTERS[which];
  if (!reg) throw new Error(`Unknown store register "${which}"`);
  if (cache[which]) return cache[which];
  const fromEnv = process.env[reg.env];
  if (fromEnv) { cache[which] = fromEnv; return cache[which]; }
  let id = await findDbByTitle(reg.title, reg.query);
  if (!id) id = await createDb(reg.title, reg.schema());
  cache[which] = id;
  return id;
}

/* ── Parsers ────────────────────────────────────────────────────────────── */

export function parseSeason(p) {
  const props = p.properties || {};
  return {
    id: p.id,
    name: titleText(props['Season']),
    village: rtText(props['Village']),
    status: selName(props['Status']) || 'Draft',
    opens: dateOf(props['Opens']),
    closes: dateOf(props['Closes']),
    collectionPoints: rtText(props['Collection Points']),
    terms: rtText(props['Terms']),
    coordinator: rtText(props['Coordinator']),
    notes: rtText(props['Notes']),
    loggedBy: rtText(props['Logged By']),
    lastUpdatedBy: rtText(props['Last Updated By']),
  };
}

export function parseSeller(p) {
  const props = p.properties || {};
  return {
    id: p.id,
    name: titleText(props['Seller']),
    village: rtText(props['Village']),
    slug: rtText(props['Slug']),
    status: selName(props['Status']) || 'Invited',
    sellerType: selName(props['Seller Type']),
    contactName: rtText(props['Contact Name']),
    contactEmail: rtText(props['Contact Email']),
    contactPhone: rtText(props['Contact Phone']),
    abn: rtText(props['ABN']),
    about: rtText(props['About']),
    logoUrl: urlOf(props['Logo URL']),
    paymentMethod: selName(props['Payment Method']),
    paymentLink: urlOf(props['Payment Link']),
    paymentConfirmed: props['Payment Confirmed']?.checkbox === true,
    fulfilment: selName(props['Fulfilment']),
    deliveryFee: numOf(props['Delivery Fee']),
    stewardEmail: rtText(props['Steward Email']),
    approvedBy: rtText(props['Approved By']),
    notes: rtText(props['Notes']),
    loggedBy: rtText(props['Logged By']),
    lastUpdatedBy: rtText(props['Last Updated By']),
  };
}

export function parseProduct(p) {
  const props = p.properties || {};
  return {
    id: p.id,
    name: titleText(props['Product']),
    village: rtText(props['Village']),
    seller: rtText(props['Seller']),
    season: rtText(props['Season']),
    status: selName(props['Status']) || 'Draft',
    category: selName(props['Category']),
    description: rtText(props['Description']),
    price: numOf(props['Price']),
    stock: numOf(props['Stock']),
    unlimitedStock: props['Unlimited Stock']?.checkbox === true,
    fulfilment: selName(props['Fulfilment']),
    imageUrl: urlOf(props['Image URL']),
    sku: rtText(props['SKU']),
    sort: numOf(props['Sort']),
    notes: rtText(props['Notes']),
    lastUpdatedBy: rtText(props['Last Updated By']),
  };
}

export function parseOrder(p) {
  const props = p.properties || {};
  return {
    id: p.id,
    ref: titleText(props['Order']),
    village: rtText(props['Village']),
    seller: rtText(props['Seller']),
    season: rtText(props['Season']),
    buyerName: rtText(props['Buyer Name']),
    buyerEmail: rtText(props['Buyer Email']),
    buyerPhone: rtText(props['Buyer Phone']),
    items: rtJson(props['Items'], []),
    subtotal: numOf(props['Subtotal']),
    deliveryFee: numOf(props['Delivery Fee']),
    total: numOf(props['Total']),
    paymentStatus: selName(props['Payment Status']) || 'Awaiting payment',
    paymentMethod: selName(props['Payment Method']),
    fulfilmentStatus: selName(props['Fulfilment Status']) || 'New',
    fulfilment: selName(props['Fulfilment']),
    collectionPoint: rtText(props['Collection Point']),
    placedDate: dateOf(props['Placed Date']),
    completedDate: dateOf(props['Completed Date']),
    notes: rtText(props['Notes']),
    loggedBy: rtText(props['Logged By']),
    lastUpdatedBy: rtText(props['Last Updated By']),
  };
}

/* ── Queries ────────────────────────────────────────────────────────────── */

export async function queryVillage(which, village, sorts) {
  const id = await dbId(which);
  const out = [];
  let cursor;
  do {
    const res = await fetch(`https://api.notion.com/v1/databases/${id}/query`, {
      method: 'POST', headers: notionHeaders(),
      body: JSON.stringify({
        filter: { property: 'Village', rich_text: { equals: village } },
        ...(sorts ? { sorts } : {}),
        ...(cursor ? { start_cursor: cursor } : {}),
      }),
    });
    if (!res.ok) throw new Error(`Notion responded ${res.status}`);
    const data = await res.json();
    (data.results || []).forEach((p) => out.push(p));
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  return out;
}

/** Fetch one row and prove it is in `which` register AND in `village`. */
export async function getRow(which, pageId, village, parse) {
  if (!pageId) return null;
  const id = await dbId(which);
  const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, { headers: notionHeaders() });
  if (!res.ok) return null;
  const page = await res.json();
  if (page.archived) return null;
  if ((page.parent?.database_id || '').replace(/-/g, '') !== String(id).replace(/-/g, '')) return null;
  const row = parse(page);
  if (village && row.village !== village) return null;
  return row;
}

export async function createRow(which, properties) {
  const id = await dbId(which);
  const res = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST', headers: notionHeaders(),
    body: JSON.stringify({ parent: { database_id: id }, properties }),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Notion responded ${res.status}: ${detail.slice(0, 200)}`);
  }
  return (await res.json()).id;
}

export async function patchRow(pageId, properties) {
  const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: 'PATCH', headers: notionHeaders(), body: JSON.stringify({ properties }),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Notion responded ${res.status}: ${detail.slice(0, 200)}`);
  }
}

export async function archiveRow(pageId) {
  const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: 'PATCH', headers: notionHeaders(), body: JSON.stringify({ archived: true }),
  });
  if (!res.ok) throw new Error(`Notion responded ${res.status}`);
}

export function stampFor(user) {
  return { 'Last Updated By': { rich_text: rtChunks(`${user?.email || 'admin'} · ${today()}`) } };
}

/* ── Order maths ────────────────────────────────────────────────────────── */

/**
 * Re-price an order from the PRODUCT rows, never from the client. Returns the
 * priced items plus the totals, and refuses a basket that spans two sellers
 * (the money invariant) or names a product from another village.
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

export const csvCell = (v) => {
  const s = String(v == null ? '' : v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

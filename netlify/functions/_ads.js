/**
 * _ads.js — shared helpers for the Advertising module.
 *
 * 📣 VF Advertisers (shared across villages, Village column — platform
 * pattern): one row per local business placement/sponsorship. Status flow
 * Draft → Active → Expired / Cancelled; only Active rows within their date
 * range are served publicly, and only their public-safe fields.
 *
 * v1 is committee-managed (they sell the placement, record the fee — bank
 * transfer until the village's own Tyro merchant). WHERE ads render on the
 * public site is a separate, explicitly-approved step — the console carries
 * a preview of the sponsor strip; nothing is mounted publicly by default.
 */

const NOTION_VERSION = '2022-06-28';

export const ADS_DB_ID = process.env.NOTION_VF_ADS_DB_ID || '3bfd508adfc181a290c1cb82448000d0';

export const AD_STATUSES = ['Draft', 'Active', 'Expired', 'Cancelled'];
export const AD_TIERS = ['Major Sponsor', 'Sponsor', 'Supporter'];

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

export function notProvisioned() {
  return jsonResp(503, { error: 'Advertising is not provisioned yet — set NOTION_VF_ADS_DB_ID.' });
}

export const rtChunks = (str) => {
  const s = String(str || '');
  if (!s) return [];
  const out = [];
  for (let i = 0; i < s.length; i += 1900) out.push({ text: { content: s.slice(i, i + 1900) } });
  return out;
};
export const rtText = (prop) => (prop?.rich_text || []).map((t) => t.plain_text).join('');

export async function queryAll(dbId, filter, sorts) {
  const results = [];
  let cursor;
  do {
    const res = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
      method: 'POST',
      headers: notionHeaders(),
      body: JSON.stringify({
        ...(filter ? { filter } : {}),
        ...(sorts ? { sorts } : {}),
        page_size: 100,
        ...(cursor ? { start_cursor: cursor } : {}),
      }),
    });
    if (!res.ok) throw new Error(`Notion responded ${res.status}`);
    const data = await res.json();
    results.push(...data.results);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return results;
}

export function parseAd(page) {
  const p = page.properties || {};
  return {
    id: page.id,
    business: p.Advertiser?.title?.[0]?.plain_text || '(unnamed)',
    village: rtText(p.Village),
    blurb: rtText(p.Blurb),
    website: p.Website?.url || '',
    phone: p.Phone?.phone_number || '',
    email: p.Email?.email || '',
    contact: rtText(p.Contact),
    tier: p.Tier?.select?.name || 'Supporter',
    startDate: p['Start Date']?.date?.start || null,
    endDate: p['End Date']?.date?.start || null,
    fee: p.Fee?.number ?? null,
    amountPaid: p['Amount Paid']?.number ?? null,
    paymentDate: p['Payment Date']?.date?.start || null,
    paymentReference: rtText(p['Payment Reference']),
    status: p.Status?.select?.name || 'Draft',
    note: rtText(p.Note),
    loggedBy: rtText(p['Logged By']),
    lastUpdatedBy: rtText(p['Last Updated By']),
  };
}

/** Is this ad currently live (Active + inside its date range)? */
export function adIsLive(ad, today = new Date().toISOString().slice(0, 10)) {
  if (ad.status !== 'Active') return false;
  if (ad.startDate && ad.startDate > today) return false;
  if (ad.endDate && ad.endDate < today) return false;
  return true;
}

export async function getAd(pageId) {
  const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, { headers: notionHeaders() });
  if (!res.ok) return null;
  const page = await res.json();
  const parent = page.parent?.database_id?.replace(/-/g, '');
  if (parent !== ADS_DB_ID.replace(/-/g, '')) return null;
  return parseAd(page);
}

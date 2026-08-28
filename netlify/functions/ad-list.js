/**
 * ad-list.js — GET /api/ad-list?village=   (PUBLIC)
 *
 * The live sponsors/placements for a village — public-safe fields only
 * (business, blurb, website, tier). Fees, contacts and payment details never
 * leave the admin endpoint. Ready for whichever public surface the committee
 * approves; currently consumed by the console's preview strip.
 */

import { ADS_DB_ID, jsonResp, notProvisioned, queryAll, parseAd, adIsLive } from './_ads.js';

const TIER_ORDER = { 'Major Sponsor': 0, 'Sponsor': 1, 'Supporter': 2 };

export const handler = async (event) => {
  if (event.httpMethod !== 'GET') return jsonResp(405, { error: 'GET only' });
  if (!ADS_DB_ID) return notProvisioned();

  const village = event.queryStringParameters?.village || process.env.VILLAGE_NAME || 'Smiths Lake';

  try {
    const ads = (await queryAll(ADS_DB_ID, { property: 'Village', rich_text: { equals: village } }))
      .map(parseAd)
      .filter((a) => adIsLive(a))
      .sort((a, b) => (TIER_ORDER[a.tier] ?? 9) - (TIER_ORDER[b.tier] ?? 9) || a.business.localeCompare(b.business))
      .map((a) => ({ business: a.business, blurb: a.blurb, website: a.website, tier: a.tier }));
    return jsonResp(200, { ads });
  } catch (err) {
    return jsonResp(502, { error: err.message });
  }
};

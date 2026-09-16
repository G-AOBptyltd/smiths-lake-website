/**
 * subscriber-list.js — GET /api/subscriber-list?village=Smiths Lake
 *
 * The human-facing newsletter subscriber list for the /admin/subscribers/
 * module. Admin-gated (PII). Returns plain people data — no Mailchimp/Supabase
 * internals — so the committee sees a clean mailing list, not plumbing.
 *
 * Since migration 0020 it also carries the consent truth the list never had:
 * per subscriber `confirmed` / `consentAt` / `consentMethod`, and a `pending`
 * total. Every pre-existing key keeps its exact name and shape — the console
 * was extended to SHOW more, never to read something different.
 */

import { jsonResp } from './_stewards.js';
import { requireRole } from './_auth.js';
import { supa, supaConfigured, slugVillage } from './_mailchimp.js';

export const handler = async (event, context) => {
  const village = event.queryStringParameters?.village || process.env.VILLAGE_NAME || 'Smiths Lake';

  const auth = requireRole(context, { village, anyOf: ['admin'] });
  if (!auth.ok) return jsonResp(auth.status, { error: auth.error });
  if (!supaConfigured()) return jsonResp(200, { configured: false, subscribers: [], counts: {} });

  const vslug = slugVillage(village);
  const r = await supa(
    `subscribers?village_id=eq.${vslug}` +
    `&select=email,first_name,last_name,status,tags,interests,merge_fields,source,subscribed_at,created_at` +
    `,confirmed_at,consent_at,consent_method` +
    `&order=created_at.desc`
  );
  if (!r.ok) return jsonResp(502, { error: 'Could not load subscribers' });

  // Cross-badge: which subscribers are also active volunteers (email match).
  const volEmails = new Set();
  try {
    const vr = await supa(`volunteers?village_id=eq.${vslug}&status=eq.active&select=email`);
    if (vr.ok) for (const v of (Array.isArray(vr.data) ? vr.data : [])) if (v.email) volEmails.add(v.email.toLowerCase());
  } catch (_) { /* fail-open */ }

  const subscribers = (Array.isArray(r.data) ? r.data : []).map((s) => ({
    name: `${s.first_name || ''} ${s.last_name || ''}`.trim(),
    email: s.email || '',
    phone: (s.merge_fields && (s.merge_fields.PHONE || s.merge_fields.MMERGE6)) || '',
    status: s.status || 'subscribed',
    tags: Array.isArray(s.tags) ? s.tags : [],
    interests: Array.isArray(s.interests) ? s.interests : [],
    isVolunteer: volEmails.has((s.email || '').toLowerCase()),
    since: s.subscribed_at || s.created_at || null,
    // Added by 0020 — the double opt-in and consent record.
    confirmed: !!s.confirmed_at,
    consentAt: s.consent_at || null,
    consentMethod: s.consent_method || '',
  }));

  // Distinct interest names present (for the filter dropdown).
  const interestSet = new Set();
  subscribers.forEach((s) => s.interests.forEach((i) => interestSet.add(i)));

  const counts = {
    total: subscribers.length,
    subscribed: subscribers.filter((s) => s.status === 'subscribed').length,
    unsubscribed: subscribers.filter((s) => s.status === 'unsubscribed').length,
    // Signed up but not yet confirmed — nothing is ever sent to these
    // addresses. Also counts a 'subscribed' row with no confirmed_at, which
    // only a pre-0020 import can produce.
    pending: subscribers.filter((s) => s.status === 'pending' || (s.status === 'subscribed' && !s.confirmed)).length,
  };

  return jsonResp(200, { configured: true, subscribers, counts, interests: [...interestSet].sort() });
};

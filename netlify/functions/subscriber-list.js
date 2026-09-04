/**
 * subscriber-list.js — GET /api/subscriber-list?village=Smiths Lake
 *
 * The human-facing newsletter subscriber list for the /admin/subscribers/
 * module. Admin-gated (PII). Returns plain people data — no Mailchimp/Supabase
 * internals — so the committee sees a clean mailing list, not plumbing.
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
    `&select=email,first_name,last_name,status,tags,source,subscribed_at,created_at` +
    `&order=created_at.desc`
  );
  if (!r.ok) return jsonResp(502, { error: 'Could not load subscribers' });

  const subscribers = (Array.isArray(r.data) ? r.data : []).map((s) => ({
    name: `${s.first_name || ''} ${s.last_name || ''}`.trim(),
    email: s.email || '',
    status: s.status || 'subscribed',
    tags: Array.isArray(s.tags) ? s.tags : [],
    since: s.subscribed_at || s.created_at || null,
  }));

  const counts = {
    total: subscribers.length,
    subscribed: subscribers.filter((s) => s.status === 'subscribed').length,
    unsubscribed: subscribers.filter((s) => s.status === 'unsubscribed').length,
  };

  return jsonResp(200, { configured: true, subscribers, counts });
};

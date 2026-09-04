/**
 * mailchimp-webhook.js — POST /api/mailchimp-webhook   (PUBLIC, secret-guarded)
 *
 * Ongoing Mailchimp → Supabase sync. Point a Mailchimp audience webhook at:
 *   https://villagefirst.org.au/api/mailchimp-webhook?secret=<MAILCHIMP_WEBHOOK_SECRET>
 * Mailchimp fires subscribe / unsubscribe / cleaned / profile / upemail events
 * (form-encoded). We upsert the change into `subscribers`. Best-effort and
 * always returns 200 quickly so Mailchimp doesn't retry-storm.
 *
 * GET verification (Mailchimp pings the URL on setup) → 200 OK.
 */

import {
  MC_AUDIENCE, supaConfigured, supa, slugVillage,
} from './_mailchimp.js';

const VILLAGE = process.env.VILLAGE_NAME || 'Smiths Lake';

function jsonp(statusCode, obj) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}

export const handler = async (event) => {
  // Mailchimp verifies the endpoint with a GET on setup.
  if (event.httpMethod === 'GET') return jsonp(200, { ok: true });
  if (event.httpMethod !== 'POST') return jsonp(405, { error: 'POST only' });

  // Shared-secret gate (only enforced when a secret is configured).
  const secret = process.env.MAILCHIMP_WEBHOOK_SECRET;
  if (secret) {
    const given = event.queryStringParameters?.secret || '';
    if (given !== secret) return jsonp(401, { error: 'bad secret' });
  }
  if (!supaConfigured()) return jsonp(200, { ok: true, note: 'supabase not configured' });

  try {
    const p = new URLSearchParams(event.body || '');
    const type = p.get('type');
    const listId = p.get('data[list_id]');
    if (MC_AUDIENCE && listId && listId !== MC_AUDIENCE) return jsonp(200, { ok: true, note: 'other list' });

    const vslug = slugVillage(VILLAGE);
    const email = (p.get('data[email]') || '').toLowerCase();
    const fname = p.get('data[merges][FNAME]');
    const lname = p.get('data[merges][LNAME]');
    const nowIso = new Date().toISOString();

    // Email change: move the existing row to the new address.
    if (type === 'upemail') {
      const oldEmail = (p.get('data[old_email]') || '').toLowerCase();
      const newEmail = (p.get('data[new_email]') || '').toLowerCase();
      if (oldEmail && newEmail) {
        await supa(`subscribers?village_id=eq.${vslug}&email=eq.${encodeURIComponent(oldEmail)}`, {
          method: 'PATCH', headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ email: newEmail, last_synced_at: nowIso, updated_at: nowIso }),
        });
      }
      return jsonp(200, { ok: true });
    }

    if (!email) return jsonp(200, { ok: true, note: 'no email' });

    const statusByType = { subscribe: 'subscribed', unsubscribe: 'unsubscribed', cleaned: 'cleaned' };
    const row = {
      village_id: vslug, email, source: 'mailchimp',
      last_synced_at: nowIso, updated_at: nowIso,
      ...(fname != null ? { first_name: fname } : {}),
      ...(lname != null ? { last_name: lname } : {}),
      ...(statusByType[type] ? { status: statusByType[type] } : {}),   // 'profile' → keep status
    };
    await supa('subscribers?on_conflict=village_id,email', {
      method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify([row]),
    });
    return jsonp(200, { ok: true });
  } catch (_) {
    return jsonp(200, { ok: true });   // ack anyway — never retry-storm; full sync self-heals
  }
};

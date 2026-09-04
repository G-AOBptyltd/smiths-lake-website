/**
 * _mailchimp.js — shared Mailchimp Marketing API client + Supabase `subscribers`
 * helpers for the Mailchimp → Supabase migration and ongoing sync.
 *
 * Env (villagefirst.org.au / smiths-lake Netlify site):
 *   MAILCHIMP_API_KEY      the Mailchimp API key (its "-usX" suffix = datacenter)
 *   MAILCHIMP_AUDIENCE_ID  the audience / list id to sync
 *   MAILCHIMP_DC           optional override for the datacenter (else derived)
 *   MAILCHIMP_WEBHOOK_SECRET optional shared secret for the webhook endpoint
 *   VAPP_SUPABASE_URL / VAPP_SUPABASE_SERVICE_KEY  (reused; service role)
 */

export const MC_KEY = process.env.MAILCHIMP_API_KEY;
export const MC_AUDIENCE = process.env.MAILCHIMP_AUDIENCE_ID;
const SUPA_URL = process.env.VAPP_SUPABASE_URL;
const SUPA_KEY = process.env.VAPP_SUPABASE_SERVICE_KEY;

export function mcConfigured() { return !!(MC_KEY && MC_AUDIENCE); }
export function supaConfigured() { return !!(SUPA_URL && SUPA_KEY); }

function mcDc() {
  if (process.env.MAILCHIMP_DC) return process.env.MAILCHIMP_DC;
  const i = (MC_KEY || '').lastIndexOf('-');
  return i >= 0 ? MC_KEY.slice(i + 1) : '';
}

export async function mcFetch(path, opts = {}) {
  const dc = mcDc();
  const auth = Buffer.from(`anystring:${MC_KEY}`).toString('base64');   // Mailchimp Basic auth
  const res = await fetch(`https://${dc}.api.mailchimp.com/3.0/${path}`, {
    ...opts,
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const text = await res.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; }
  return { ok: res.ok, status: res.status, data };
}

export async function supa(path, opts = {}) {
  const res = await fetch(`${SUPA_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const text = await res.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; }
  return { ok: res.ok, status: res.status, data };
}

export function slugVillage(v) {
  return String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

const MC_STATUSES = ['subscribed', 'unsubscribed', 'cleaned', 'pending', 'transactional'];

// Map a Mailchimp member object → a `subscribers` row (upsert shape).
export function memberToRow(m, village) {
  const mf = m.merge_fields || {};
  return {
    village_id: slugVillage(village),
    email: (m.email_address || '').toLowerCase(),
    first_name: mf.FNAME || null,
    last_name: mf.LNAME || null,
    status: MC_STATUSES.includes(m.status) ? m.status : 'subscribed',
    tags: (m.tags || []).map((t) => (t && t.name) ? t.name : t).filter(Boolean),
    merge_fields: mf,
    source: 'mailchimp',
    mailchimp_id: m.id || null,
    mailchimp_web_id: m.web_id != null ? String(m.web_id) : null,
    subscribed_at: m.timestamp_opt || m.timestamp_signup || null,
    last_synced_at: new Date().toISOString(),
  };
}

// Idempotent upsert of subscriber rows, keyed by (village_id, email).
export async function upsertSubscribers(rows) {
  if (!rows.length) return { ok: true, status: 204, data: null };
  return supa('subscribers?on_conflict=village_id,email', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(rows),
  });
}

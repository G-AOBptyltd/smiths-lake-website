/**
 * mailchimp-sync.js — one-time (and re-runnable) Mailchimp audience → Supabase
 * `subscribers` import. Part of making Supabase the source of truth for the
 * newsletter audience.
 *
 * SAFE BY DESIGN (mirrors vapp-migrate):
 *   • SUPER-ADMIN only (reads PII, writes production data).
 *   • GET  = DRY RUN. Reports Mailchimp member count + current Supabase count.
 *            Writes nothing.
 *   • POST = COMMIT. Pages the whole audience and UPSERTs by (village_id,email),
 *            so it is idempotent — safe to re-run; existing rows are updated,
 *            not duplicated. Requires body.confirm === true.
 *
 * GET  /api/mailchimp-sync?village=Smiths Lake
 * POST /api/mailchimp-sync  { village, confirm:true }
 */

import { jsonResp } from './_stewards.js';
import { requireRole, getRoles } from './_auth.js';
import {
  MC_AUDIENCE, mcConfigured, supaConfigured, mcFetch, supa, slugVillage,
  memberToRow, upsertSubscribers,
} from './_mailchimp.js';

function safeBody(event) { try { return event.body ? JSON.parse(event.body) : {}; } catch (_) { return {}; } }

const MEMBER_FIELDS = [
  'members.id', 'members.email_address', 'members.status', 'members.merge_fields',
  'members.tags', 'members.web_id', 'members.timestamp_opt', 'members.timestamp_signup',
  'total_items',
].join(',');

async function audienceTotal() {
  const r = await mcFetch(`lists/${MC_AUDIENCE}/members?count=1&fields=total_items`);
  if (!r.ok) throw new Error(`Mailchimp responded ${r.status}${r.data?.detail ? ' — ' + r.data.detail : ''}`);
  return r.data?.total_items ?? 0;
}

async function supabaseCount(vslug) {
  // HEAD with count=exact returns the total in the Content-Range header; simpler
  // to just select ids with a high cap — audiences here are modest.
  const r = await supa(`subscribers?village_id=eq.${vslug}&select=id`);
  return (r.ok && Array.isArray(r.data)) ? r.data.length : 0;
}

export const handler = async (event, context) => {
  const village = event.queryStringParameters?.village
    || safeBody(event).village || process.env.VILLAGE_NAME || 'Smiths Lake';

  // Super-admin only, every method.
  const auth = requireRole(context, { village, anyOf: ['admin'] });
  if (!auth.ok) return jsonResp(auth.status, { error: auth.error });
  if (!getRoles(auth.user).includes('super-admin')) {
    return jsonResp(403, { error: 'Mailchimp sync is restricted to the super-admin.' });
  }
  if (!mcConfigured()) return jsonResp(200, { configured: false, reason: 'Set MAILCHIMP_API_KEY and MAILCHIMP_AUDIENCE_ID in Netlify.' });
  if (!supaConfigured()) return jsonResp(200, { configured: false, reason: 'Set VAPP_SUPABASE_URL and VAPP_SUPABASE_SERVICE_KEY in Netlify.' });

  const vslug = slugVillage(village);

  try {
    const total = await audienceTotal();
    const already = await supabaseCount(vslug);

    // ── DRY RUN ──────────────────────────────────────────────────────────
    if (event.httpMethod !== 'POST') {
      return jsonResp(200, { mode: 'dry-run', configured: true, village, audienceTotal: total, inSupabase: already });
    }

    // ── COMMIT ───────────────────────────────────────────────────────────
    const body = safeBody(event);
    if (body.confirm !== true) return jsonResp(400, { error: 'Commit requires confirm:true', audienceTotal: total, inSupabase: already });

    let offset = 0, imported = 0, failedPages = 0;
    const PAGE = 1000;
    while (offset < total) {
      const r = await mcFetch(`lists/${MC_AUDIENCE}/members?count=${PAGE}&offset=${offset}&fields=${encodeURIComponent(MEMBER_FIELDS)}`);
      if (!r.ok) { failedPages++; break; }
      const members = r.data?.members || [];
      if (!members.length) break;
      const rows = members.map((m) => memberToRow(m, village)).filter((row) => row.email);
      const up = await upsertSubscribers(rows);
      if (up.ok) imported += rows.length; else failedPages++;
      offset += members.length;
    }

    const nowInSupabase = await supabaseCount(vslug);
    return jsonResp(200, {
      mode: 'commit', configured: true, village,
      audienceTotal: total, imported, failedPages, inSupabase: nowInSupabase,
    });
  } catch (err) {
    return jsonResp(502, { error: err.message });
  }
};

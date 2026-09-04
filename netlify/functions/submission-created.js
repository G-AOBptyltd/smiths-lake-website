/**
 * submission-created.js — Netlify-TRIGGERED function (special name; Netlify
 * invokes it automatically on every verified form submission — no route).
 *
 * Mirrors `newsletter` form submissions into the Supabase `subscribers` table
 * so Supabase captures web subscribers going forward (the "replace Mailchimp"
 * direction). DUAL-WRITE + FAIL-OPEN: the existing Netlify-form → Zapier →
 * Mailchimp path is completely untouched; this only ADDS a Supabase write and
 * swallows every error, so it can never affect a submission. When we later
 * build own-stack sending, the Mailchimp/Zapier side can be retired.
 *
 * Fires for every source of a `newsletter` submission — the /news/ sidebar
 * form, the membership "stay connected" opt-in, and the volunteer-signup
 * opt-in — because they all post to the same Netlify `newsletter` form.
 */

import { supa, supaConfigured, slugVillage } from './_mailchimp.js';

const VILLAGE = process.env.VILLAGE_NAME || 'Smiths Lake';

export const handler = async (event) => {
  try {
    if (!supaConfigured()) return { statusCode: 200, body: 'supabase not configured' };
    const payload = (JSON.parse(event.body || '{}').payload) || {};
    if (payload.form_name !== 'newsletter') return { statusCode: 200, body: 'ignored' };

    const data = payload.data || {};
    const email = String(data.email || payload.email || '').toLowerCase().trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { statusCode: 200, body: 'no email' };

    const nowIso = new Date().toISOString();
    const row = {
      village_id: slugVillage(VILLAGE),
      email,
      first_name: (data['first-name'] || '').trim() || null,
      last_name: (data['last-name'] || '').trim() || null,
      status: 'subscribed',
      source: 'website',
      last_synced_at: nowIso,
      updated_at: nowIso,
    };
    // Upsert by (village_id,email): merge-duplicates updates only these columns,
    // so a contact already imported from Mailchimp keeps its tags/merge_fields.
    await supa('subscribers?on_conflict=village_id,email', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify([row]),
    });
    return { statusCode: 200, body: 'ok' };
  } catch (_) {
    return { statusCode: 200, body: 'ok' };   // best-effort; never disrupt the form pipeline
  }
};

/**
 * subscribe.js — POST /api/subscribe   (PUBLIC, no auth)
 *
 * The ONE way anybody joins the community mailing list. It replaces three
 * near-identical Netlify forms (news sidebar, membership page, the orphaned
 * SubscriptionForm) and two fire-and-forget re-posts that fabricated a consent
 * value the person never saw.
 *
 * Deliberately narrow, same shape as contrib-pledge / member-join:
 *   - a honeypot field ("website") must be empty, or we silently accept-and-drop
 *   - all fields are length-capped; the email is regex-checked and lowercased
 *   - the ONLY statuses this path can write are 'pending' and 'subscribed'
 *   - it can never unsubscribe anyone, and never downgrades a live subscriber
 *
 * ── CONSENT IS RECORDED AS DATA ────────────────────────────────────────────
 * `consentText` is what the PAGE ACTUALLY DISPLAYED next to the ticked box,
 * submitted by the form itself and stored verbatim (capped at 500 chars). That
 * is the evidence the Spam Act expects a sender to be able to produce, and it
 * is why the field is required: a signup with no wording behind it is a signup
 * we cannot later justify. Alongside it: consent_at, consent_source (the page
 * path), consent_method (which surface), and consent_ip_hash —
 * sha256(ip + VF_CONSENT_SALT), NEVER the raw IP, because the hash proves a
 * submission came from somewhere without storing where.
 *
 * ── DOUBLE OPT-IN ──────────────────────────────────────────────────────────
 * A new address lands as 'pending' and is emailed a confirmation link. Nothing
 * is ever sent to an unconfirmed address. The response is the SAME for a new
 * address, an existing confirmed one, and a returning unsubscriber — enumerating
 * a village's mailing list through this endpoint must not be possible.
 *
 * Body: { village?, firstName, lastName?, email, residentType?, interests?[],
 *         consentText, sourcePage, method?, website? }
 *
 * OPTIONAL confirmation email (env-gated) — reuses the VillageFirst Resend
 * account vars from contrib-pledge:
 *   VF_RESEND_API_KEY / VF_PLEDGE_FROM / VF_PLEDGE_NOTIFY_TO (reply-to)
 * If Resend is NOT configured the signup is still recorded, and confirmed on
 * the spot, so a misconfigured site loses nobody — it just loses the second
 * opt-in step until the key is set. The response says confirmationSent:false.
 *
 * ⛔ This does not touch Mailchimp. The committee's weekly newsletter keeps
 * going out through _mailchimp.js until Mailchimp is retired deliberately.
 */

import { createHash, randomUUID } from 'node:crypto';
import {
  RESIDENT_TYPES, CONSENT_METHODS,
  findSubscriberByEmail, upsertSubscriber, normaliseEmail, normaliseInterests,
  isEmail, jsonResp,
} from './_subscribers.js';

function esc(s) {
  return String(s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

/**
 * sha256(client IP + salt). A salted hash lets us show that two signups came
 * from the same place, or answer a complaint, without ever holding an address
 * that identifies a household. The fallback salt keeps the column populated on
 * a site that has not set VF_CONSENT_SALT — set it per village.
 */
function hashIp(event) {
  const h = event.headers || {};
  const raw = h['x-nf-client-connection-ip']
    || String(h['x-forwarded-for'] || '').split(',')[0].trim()
    || h['client-ip']
    || '';
  if (!raw) return null;
  const salt = process.env.VF_CONSENT_SALT || 'villagefirst-consent';
  return createHash('sha256').update(`${raw}${salt}`).digest('hex');
}

/**
 * The double opt-in email. Fail-open on send errors: the row is already saved
 * as 'pending', and a broken mail relay must not surface to the visitor as a
 * failed signup. Returns nothing — the response never reports what was sent to
 * whom, because that would reveal whether the address was already on the list.
 */
async function sendConfirmation({ village, email, firstName, token, consentText }) {
  const key = process.env.VF_RESEND_API_KEY;
  if (!key) return;
  const from = process.env.VF_PLEDGE_FROM || 'VillageFirst <noreply@villagefirst.org.au>';
  const replyTo = String(process.env.VF_PLEDGE_NOTIFY_TO || '').split(',')[0].trim();
  const base = process.env.URL || 'https://villagefirst.org.au';
  const link = `${base}/subscribed/?token=${encodeURIComponent(token)}`;

  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1f2937;">
    <h2 style="color:#15795f;">One tap and you're in 📬</h2>
    <p>Hi ${esc(firstName) || 'there'} — someone (we hope you) asked for ${esc(village)} community updates at this address.</p>
    <p style="margin:24px 0;"><a href="${link}" style="background:#15795f;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;">Yes, confirm my subscription</a></p>
    <p style="font-size:13px;color:#6b7280;">Or paste this into your browser:<br>${esc(link)}</p>
    <p style="font-size:13px;color:#6b7280;border-top:1px solid #e5e7eb;padding-top:12px;margin-top:20px;">
      What you agreed to: “${esc(consentText)}”<br>
      If this wasn't you, just ignore this email — nothing is sent to an address that hasn't been confirmed.
    </p>
  </div>`;

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [email],
        ...(replyTo ? { reply_to: replyTo } : {}),
        subject: `Please confirm your ${village} updates subscription`,
        html,
      }),
    });
  } catch (_) { /* best-effort; the row is already saved as pending */ }
}

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return jsonResp(405, { error: 'POST only' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch {
    return jsonResp(400, { error: 'Invalid request' });
  }

  // Honeypot — real people leave this empty. Pretend success so bots don't learn.
  if ((body.website || '').trim()) return jsonResp(200, { ok: true, pending: true });

  const firstName = (body.firstName || '').trim().slice(0, 100);
  const lastName = (body.lastName || '').trim().slice(0, 100);
  const email = normaliseEmail(body.email);
  if (!firstName) return jsonResp(400, { error: 'Please tell us your first name.' });
  if (!isEmail(email)) return jsonResp(400, { error: 'Please give us a valid email address.' });

  // The wording the visitor actually saw. No wording, no signup — see the header.
  const consentText = (body.consentText || '').trim().slice(0, 500);
  if (!consentText) return jsonResp(400, { error: 'Please tick the box to agree to receive updates.' });

  const village = (body.village || process.env.VILLAGE_NAME || 'Smiths Lake').slice(0, 100);
  const method = CONSENT_METHODS.includes(body.method) ? body.method : 'stay-connected';
  const sourcePage = (body.sourcePage || '').trim().slice(0, 200) || '/';
  const residentType = RESIDENT_TYPES.includes(body.residentType) ? body.residentType : null;
  const interests = normaliseInterests(body.interests);
  const now = new Date().toISOString();

  const consent = {
    consent_text: consentText,
    consent_at: now,
    consent_source: sourcePage,
    consent_method: method,
    consent_ip_hash: hashIp(event),
  };

  // Resend gates the second opt-in step. Reported as a capability of the SITE,
  // never as "did THIS address get an email" — that would leak existence.
  const canConfirm = !!process.env.VF_RESEND_API_KEY;

  try {
    const existing = await findSubscriberByEmail(village, email);
    const mergeFields = {
      ...((existing && existing.merge_fields) || {}),
      FNAME: firstName,
      ...(lastName ? { LNAME: lastName } : {}),
      ...(residentType ? { RESIDENT: residentType } : {}),
    };

    const base = {
      first_name: firstName,
      last_name: lastName || (existing ? existing.last_name : null),
      interests,
      merge_fields: mergeFields,
      source: existing ? (existing.source || 'website') : 'website',
      ...consent,
    };

    // A live, confirmed subscriber updating their details — refresh the record
    // and the consent, but NEVER downgrade their status to pending.
    const isLive = !!(existing && existing.confirmed_at && existing.status === 'subscribed');

    let token = null;
    let values;
    if (isLive) {
      values = base;
    } else if (canConfirm) {
      // New address, or one that had unsubscribed and is coming back: both go
      // through confirmation again, with a fresh token so an old link is dead.
      token = randomUUID();
      values = {
        ...base,
        status: 'pending',
        confirm_token: token,
        confirmed_at: null,
        unsubscribed_at: null,
        subscribed_at: null,
      };
    } else {
      // No mail relay configured: record the signup rather than drop it, and
      // be honest in the response that no confirmation went out.
      values = {
        ...base,
        status: 'subscribed',
        confirmed_at: now,
        unsubscribed_at: null,
        subscribed_at: (existing && existing.subscribed_at) || now,
      };
    }

    await upsertSubscriber(village, email, values);

    if (token) {
      await sendConfirmation({ village, email, firstName, token, consentText });
    }

    // Identical for a new address, a returning one and an existing subscriber.
    return jsonResp(200, { ok: true, pending: true, confirmationSent: canConfirm });
  } catch (err) {
    return jsonResp(502, { error: 'Sorry — we could not sign you up just now. Please try again shortly.' });
  }
};

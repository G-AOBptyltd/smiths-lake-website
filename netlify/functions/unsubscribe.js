/**
 * unsubscribe.js — GET or POST /api/unsubscribe?token=<uuid>
 * (PUBLIC, no auth — the token IS the authentication)
 *
 * The platform's OWN unsubscribe, which the list has never had. Until now,
 * opting out only worked through Mailchimp's footer link: retiring Mailchimp
 * would have left 74 people with no way to leave, which is exactly the
 * situation the Spam Act 2003 says a sender must not create.
 *
 * GET must work, and work with no JavaScript, for two reasons:
 *   1. RFC 8058 one-click List-Unsubscribe — the mail client hits the URL itself;
 *   2. a plain link in an email footer, opened in any browser.
 * /unsubscribe/ calls this from the page too, so both routes hit one code path.
 *
 * ── WHAT SURVIVES, AND WHY ─────────────────────────────────────────────────
 * The EMAIL STAYS as a suppression record — the only way to keep honouring a
 * withdrawal is to remember the address that withdrew. Everything else about
 * the person is cleared immediately (name, interests, tags, merge fields), and
 * the retention class `subscribers_unsubscribed` (migration 0016) finishes the
 * job 30 days later. See unsubscribeByToken() in _subscribers.js.
 *
 * Idempotent: unsubscribing twice is a success. An unknown or malformed token
 * is a flat 404 with no detail.
 *
 * Returns { ok:true, alreadyUnsubscribed? } or 404 { error }.
 */

import { unsubscribeByToken, jsonResp } from './_subscribers.js';
import { mcUnsubscribe } from './_mc-bridge.js';

export const handler = async (event) => {
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
    return jsonResp(405, { error: 'GET or POST only' });
  }

  let token = (event.queryStringParameters && event.queryStringParameters.token) || '';
  if (!token && event.httpMethod === 'POST') {
    try { token = (JSON.parse(event.body || '{}').token) || ''; } catch { token = ''; }
  }

  try {
    const result = await unsubscribeByToken(token);
    if (!result) return jsonResp(404, { error: 'That unsubscribe link is not valid. Email the committee and we will remove you by hand.' });

    // ⛔ NOT optional while Mailchimp is still the sender. Without this, we
    // would record the opt-out in Supabase and Mailchimp would keep sending
    // the weekly newsletter — the resident's request honoured on paper only.
    // A withdrawal of consent has to actually stop the mail. Remove together
    // with _mc-bridge.js when Mailchimp is retired.
    const mc = await mcUnsubscribe(result.row.email);

    return jsonResp(200, {
      ok: true,
      ...(result.already ? { alreadyUnsubscribed: true } : {}),
      // Surfaced rather than swallowed: if the sender could not be updated the
      // committee needs to know, because mail may still be in flight.
      ...(mc.propagated ? {} : { senderNotUpdated: true }),
    });
  } catch (err) {
    // A failed unsubscribe is the one failure that must never look like a
    // success — the visitor is told plainly, so they can ask a human instead.
    return jsonResp(502, { error: 'Sorry — we could not remove you just now. Please try again shortly, or email the committee.' });
  }
};

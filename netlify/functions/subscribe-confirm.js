/**
 * subscribe-confirm.js — GET or POST /api/subscribe-confirm?token=<uuid>
 * (PUBLIC, no auth — the token IS the authentication)
 *
 * Step two of double opt-in. The link in the confirmation email lands on
 * /subscribed/, which calls this with the token from the query string; the row
 * flips from 'pending' to 'subscribed' with confirmed_at stamped.
 *
 * GET is allowed deliberately: some mail clients and security scanners fetch
 * links, and a confirmation that only worked from JavaScript would strand
 * anyone reading mail in a locked-down client.
 *
 * Idempotent — a second click is a success, not an error (people forward
 * confirmation emails to themselves, and scanners pre-fetch). An unknown or
 * malformed token is a flat 404 with no detail: it must not be possible to
 * learn anything about the list by trying tokens.
 *
 * Returns { ok:true, alreadyConfirmed? } or 404 { error }.
 */

import { confirmSubscriber, jsonResp } from './_subscribers.js';
import { mcSubscribe } from './_mc-bridge.js';

export const handler = async (event) => {
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
    return jsonResp(405, { error: 'GET or POST only' });
  }

  let token = (event.queryStringParameters && event.queryStringParameters.token) || '';
  if (!token && event.httpMethod === 'POST') {
    try { token = (JSON.parse(event.body || '{}').token) || ''; } catch { token = ''; }
  }

  try {
    const result = await confirmSubscriber(token);
    // Unknown token, non-uuid token, or a row that has since been deleted.
    if (!result) return jsonResp(404, { error: 'That confirmation link is not valid — it may have been replaced by a newer one.' });

    // While Mailchimp is still the sender, a newly confirmed subscriber has to
    // reach the audience the weekly newsletter actually goes to — otherwise
    // they would never receive the thing they just confirmed. Fail-open and
    // silent: Supabase already has them, so a Mailchimp outage must not turn a
    // successful confirmation into an error. Remove with _mc-bridge.js.
    if (!result.already) {
      await mcSubscribe({
        email: result.row.email,
        firstName: result.row.first_name,
        lastName: result.row.last_name,
      });
    }

    return jsonResp(200, { ok: true, ...(result.already ? { alreadyConfirmed: true } : {}) });
  } catch (err) {
    return jsonResp(502, { error: 'Sorry — we could not confirm that just now. Please try the link again shortly.' });
  }
};

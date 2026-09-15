/**
 * _mc-bridge.js — keep Mailchimp in step while it is STILL THE SENDER.
 *
 * ⛔ TEMPORARY BY DESIGN. Delete this file, and its two call sites in
 * subscribe-confirm.js and unsubscribe.js, on the day Mailchimp is retired
 * (PII plan Phase 2, decision 4a). It exists to close a gap that opens the
 * moment the website stops feeding Netlify Forms → Zapier → Mailchimp:
 *
 *   1. A resident signs up on the new form and confirms. Their record is in
 *      Supabase — but the weekly newsletter still goes out FROM Mailchimp, so
 *      without this bridge they would never receive the thing they just asked
 *      for, and nobody would notice until someone compared two lists.
 *
 *   2. Worse in the other direction: a resident clicks unsubscribe on our own
 *      page, we mark them unsubscribed in Supabase, and Mailchimp — knowing
 *      nothing about it — keeps emailing them every week. That is a broken
 *      promise to the resident and a Spam Act problem (a withdrawal of consent
 *      must actually be honoured). Propagating the opt-out is the half of this
 *      bridge that is NOT optional.
 *
 * ONLY CONFIRMED ADDRESSES ARE SENT. Double opt-in means an unconfirmed
 * address is not yet a subscriber, so it is never handed to a third party.
 *
 * Failure policy differs by direction, on purpose:
 *   • subscribe  — fail-open and silent. A Mailchimp outage must never turn a
 *     resident's successful signup into an error; Supabase already has them.
 *   • unsubscribe — attempted the same way, but Supabase is authoritative and
 *     the caller is told whether it propagated, so a failure can be surfaced
 *     rather than assumed away.
 */

import { createHash } from 'node:crypto';
import { mcFetch, mcConfigured } from './_mailchimp.js';

/** Mailchimp addresses a member by the md5 of their lower-cased email. */
const memberHash = (email) => createHash('md5').update(String(email || '').trim().toLowerCase()).digest('hex');

/**
 * Add or update a CONFIRMED subscriber in the Mailchimp audience so the
 * committee's existing weekly send reaches them. Never throws.
 */
export async function mcSubscribe({ email, firstName, lastName }) {
  if (!mcConfigured() || !email) return { propagated: false, reason: 'not configured' };
  try {
    const res = await mcFetch(`lists/${process.env.MAILCHIMP_AUDIENCE_ID}/members/${memberHash(email)}`, {
      method: 'PUT',
      body: JSON.stringify({
        email_address: String(email).trim().toLowerCase(),
        status_if_new: 'subscribed',
        status: 'subscribed',
        merge_fields: {
          ...(firstName ? { FNAME: String(firstName).slice(0, 100) } : {}),
          ...(lastName ? { LNAME: String(lastName).slice(0, 100) } : {}),
        },
      }),
    });
    return { propagated: !!res.ok, status: res.status };
  } catch (_) {
    return { propagated: false, reason: 'error' };
  }
}

/**
 * Mark a subscriber unsubscribed in Mailchimp so the weekly send stops.
 * A 404 counts as success: not being in the audience is the desired end state.
 */
export async function mcUnsubscribe(email) {
  if (!mcConfigured() || !email) return { propagated: false, reason: 'not configured' };
  try {
    const res = await mcFetch(`lists/${process.env.MAILCHIMP_AUDIENCE_ID}/members/${memberHash(email)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'unsubscribed' }),
    });
    if (res.ok || res.status === 404) return { propagated: true, status: res.status };
    return { propagated: false, status: res.status };
  } catch (_) {
    return { propagated: false, reason: 'error' };
  }
}

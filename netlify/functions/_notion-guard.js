/**
 * _notion-guard.js — keeps this site from rate-limiting itself on Notion.
 *
 * THE INCIDENT THIS EXISTS FOR (12 Sep 2026). Notion allows roughly three
 * requests a second per integration token, and every VillageFirst admin
 * function shares ONE token. The volunteer ledger read four paginated
 * databases at once (one of them twice), which was enough to trip the limit —
 * and because almost none of the 74 Notion-calling functions retried, they
 * all threw a raw "Notion responded 429" at whoever was using them. One
 * greedy page took Notion access down across the entire console.
 *
 * Fixing 74 call sites by hand would be 74 chances to get it wrong. Instead
 * this module wraps `fetch` ONCE, on import, and only for api.notion.com:
 * every other request (Supabase, Resend, Mailchimp, Google) passes straight
 * through untouched. Importing it from _auth.js, _stewards.js and _projects.js
 * covers 57 of the 74 files; the remainder import it directly.
 *
 * Two behaviours, both deliberately conservative:
 *
 *   PACING — requests are queued and spaced so we stay under the limit rather
 *   than discovering it. This is the part that prevents the problem; retrying
 *   only survives it.
 *
 *   RETRY — a 429 or 5xx is retried with exponential backoff, honouring
 *   Retry-After when Notion sends one. After the last attempt the original
 *   response is returned rather than thrown, so each caller's own error
 *   handling still runs exactly as it did before.
 *
 * Importing this module has a side effect by design. That is unusual enough
 * to say out loud: it is the only way to protect every call site without
 * editing every call site during a live incident.
 */

const MIN_GAP_MS = 380;        // ~2.6 req/s — under Notion's ~3/s ceiling
const MAX_ATTEMPTS = 5;
const MAX_BACKOFF_MS = 8000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Serialises Notion calls: each waits for the previous, then for the gap.
// Module scope, so it is shared by everything in one function bundle — which
// is exactly the scope where our bursts were being generated.
let chain = Promise.resolve();
let lastAt = 0;

function paced(run) {
  const next = chain.then(async () => {
    const wait = MIN_GAP_MS - (Date.now() - lastAt);
    if (wait > 0) await sleep(wait);
    lastAt = Date.now();
    return run();
  });
  // Keep the chain alive even if this call rejects, or one failure would
  // wedge every Notion request that follows it in this invocation.
  chain = next.then(() => undefined, () => undefined);
  return next;
}

function isNotion(input) {
  try {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    return url.includes('api.notion.com');
  } catch (_) { return false; }
}

function backoffMs(res, attempt) {
  const hinted = Number(res.headers && res.headers.get && res.headers.get('retry-after')) * 1000;
  if (Number.isFinite(hinted) && hinted > 0) return Math.min(hinted, MAX_BACKOFF_MS);
  return Math.min(500 * (2 ** attempt), MAX_BACKOFF_MS);
}

// Guard against double-wrapping if more than one shared module imports this.
if (!globalThis.__vfNotionGuard) {
  globalThis.__vfNotionGuard = true;
  const realFetch = globalThis.fetch.bind(globalThis);

  globalThis.fetch = function vfGuardedFetch(input, init) {
    if (!isNotion(input)) return realFetch(input, init);
    return paced(async () => {
      let res;
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
        res = await realFetch(input, init);
        if (res.ok || !(res.status === 429 || res.status >= 500)) return res;
        if (attempt === MAX_ATTEMPTS - 1) break;
        await sleep(backoffMs(res, attempt));
      }
      // Out of attempts: hand back the real response so existing error
      // handling behaves as before rather than seeing a surprise exception.
      return res;
    });
  };
}

export const notionGuardActive = true;

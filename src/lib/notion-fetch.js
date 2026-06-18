/**
 * Resilient fetch for @notionhq/client.
 *
 * WHY THIS EXISTS:
 * @notionhq/client v2 bundles node-fetch v2, which throws
 * `ERR_STREAM_PREMATURE_CLOSE` ("Invalid response body ... Premature close")
 * while decompressing gzipped Notion responses on Node 18+. Netlify's "noble"
 * build image runs Node 22, so every Notion call in the build can fail this way
 * once a response is large enough to trip the bug (e.g. after a content update).
 *
 * THE FIX:
 * Pass this function as the Client's `fetch` option. It uses Node's native
 * (undici) fetch — which handles gzip correctly and does not have the bug — and
 * retries a bounded number of times on transient network/stream errors.
 *
 * Usage:
 *   import { resilientFetch } from './notion-fetch.js';
 *   const notion = new Client({ auth: KEY, fetch: resilientFetch });
 */

const RETRYABLE_CODES = new Set([
  'ERR_STREAM_PREMATURE_CLOSE',
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
]);

function isRetryable(err) {
  const code = err?.cause?.code || err?.code || err?.name || '';
  if (RETRYABLE_CODES.has(code)) return true;
  return /premature close|terminated|fetch failed|socket hang up|network|ECONNRESET/i.test(
    err?.message || ''
  );
}

const MAX_RETRIES = 4;

export async function resilientFetch(url, init = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      // globalThis.fetch === native undici fetch on Node 18+.
      return await globalThis.fetch(url, init);
    } catch (err) {
      lastErr = err;
      if (attempt === MAX_RETRIES || !isRetryable(err)) throw err;
      const delayMs = 400 * 2 ** attempt; // 400, 800, 1600, 3200 ms
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastErr;
}

export default resilientFetch;

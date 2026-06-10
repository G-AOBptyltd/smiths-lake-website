/**
 * publish-news.js — POST /.netlify/functions/publish-news
 *
 * Triggers a production rebuild via Netlify build hook so freshly published
 * Notion news appears on the site. The hook URL lives in the
 * NEWS_BUILD_HOOK_URL env var (Netlify dashboard) — never exposed client-side.
 */

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'POST only' }) };
  }

  const hookUrl = process.env.NEWS_BUILD_HOOK_URL;
  if (!hookUrl) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Build hook not configured. Set NEWS_BUILD_HOOK_URL in Netlify env vars.' }),
    };
  }

  try {
    const res = await fetch(hookUrl, { method: 'POST' });
    if (!res.ok) throw new Error(`Hook responded ${res.status}`);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, message: 'Rebuild started — the site will update in a few minutes.' }),
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: `Could not trigger rebuild: ${err.message}` }),
    };
  }
};

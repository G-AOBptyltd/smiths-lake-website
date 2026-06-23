/**
 * news-image.js — image storage for the News Desk (Netlify Blobs)
 *
 *  POST /api/news-image   (auth: village admin / steward / super-admin)
 *    Body: { village, storyKey, filename, contentType, dataBase64 }
 *    Stores the image in the "news-images" blob store under a UNIQUE key
 *    (so every upload is immutable/cacheable) and returns a stable URL:
 *      { ok: true, url: "/api/news-image?key=...", key }
 *    That URL is written to the story's Notion "Image URL" property by
 *    news-save.js, so the editor never touches Notion and the link never
 *    expires (unlike Notion's ~1h signed S3 URLs).
 *
 *  GET /api/news-image?key=...   (public — the website <img> reads this)
 *    Streams the stored image with long-lived immutable caching.
 *
 * Multi-village: keys are namespaced by village slug to avoid collisions.
 */

import { getStore } from '@netlify/blobs';
import { requireRole } from './_auth.js';

const STORE_NAME = 'news-images';
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB after client-side downscale
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

function json(statusCode, obj) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}

function slugify(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

function extFor(contentType) {
  return { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }[contentType] || 'jpg';
}

// getStore auto-configures inside the Netlify Functions runtime, but if the
// Blobs context isn't injected it throws — fall back to explicit siteID so the
// error is never a silent platform 500.
const SITE_ID_FALLBACK = '55e6fbf8-d466-4209-aebd-e1cd1c27fdbb'; // public site id (not a secret)

function openStore() {
  const siteID = process.env.SITE_ID || process.env.NETLIFY_SITE_ID || SITE_ID_FALLBACK;
  const token = process.env.NETLIFY_BLOBS_TOKEN || process.env.NETLIFY_API_TOKEN;
  try {
    // Explicit credentials when a token is configured (Netlify doesn't auto-inject
    // the Blobs context for these functions); otherwise try auto-config.
    if (token) return getStore({ name: STORE_NAME, siteID, token });
    return getStore(STORE_NAME);
  } catch (e) {
    const err = new Error(`Blobs unavailable: ${e.name}: ${e.message}`);
    err._blobs = true;
    throw err;
  }
}

export const handler = async (event, context) => {
  // ---------- GET: serve a stored image (public) ----------
  if (event.httpMethod === 'GET') {
    const key = event.queryStringParameters?.key;
    if (!key) return json(400, { error: 'Missing key' });
    try {
      const store = openStore();
      const res = await store.getWithMetadata(key, { type: 'arrayBuffer' });
      if (!res || !res.data) return json(404, { error: 'Not found' });
      const contentType = (res.metadata && res.metadata.contentType) || 'image/jpeg';
      return {
        statusCode: 200,
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
        body: Buffer.from(res.data).toString('base64'),
        isBase64Encoded: true,
      };
    } catch (err) {
      return json(502, { error: err.message });
    }
  }

  // ---------- POST: store an uploaded image (auth) ----------
  if (event.httpMethod === 'POST') {
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Invalid JSON' }); }

    const village = body.village || 'Smiths Lake';
    const auth = requireRole(context, { village, anyOf: ['admin', 'steward'] });
    if (!auth.ok) return json(auth.status, { error: auth.error });

    const contentType = body.contentType || 'image/jpeg';
    if (!ALLOWED.has(contentType)) return json(400, { error: 'Unsupported image type' });
    if (!body.dataBase64) return json(400, { error: 'No image data' });

    const buffer = Buffer.from(body.dataBase64, 'base64');
    if (!buffer.length) return json(400, { error: 'Empty image' });
    if (buffer.length > MAX_BYTES) return json(413, { error: 'Image too large (max 8 MB)' });

    // Blobs accepts string | ArrayBuffer | Blob — convert the Node Buffer to a
    // clean ArrayBuffer slice (passing a Buffer directly can be rejected).
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

    const villageSlug = slugify(village) || 'village';
    const storyKey = slugify(body.storyKey) || 'story';
    const key = `${villageSlug}/${storyKey}/${Date.now()}.${extFor(contentType)}`;

    try {
      const store = openStore();
      await store.set(key, arrayBuffer, { metadata: { contentType, filename: body.filename || '', uploadedAt: new Date().toISOString() } });
      return json(200, { ok: true, key, url: `/api/news-image?key=${encodeURIComponent(key)}` });
    } catch (err) {
      // Surface the real cause (Blobs config, auth, etc.) instead of a silent 500.
      return json(502, { error: err.message, type: err.name });
    }
  }

  return json(405, { error: 'GET or POST only' });
};

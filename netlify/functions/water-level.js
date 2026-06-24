/**
 * water-level.js — GET /api/water-level
 *
 * Server-side proxy for the MHL (Manly Hydraulics Laboratory) gauge at
 * Tarbuck Bay, Smiths Lake (Site 209465). The browser cannot call the MHL
 * API directly (CORS + a required User-Agent header), so this function
 * fetches it server-side and returns a small, normalised JSON object the
 * water-level widget/ticker can render directly.
 *
 * Source endpoint (provided by MHL Client Data Manager, May 2026):
 *   https://api.manly.hydraulics.works/api/1.1/readings/latest/209465?username=publicwww
 *
 * Upstream shape (keyed by sensor id — DO NOT hard-code the ids):
 *   {
 *     "<id>": { "unit_type": "Water Level",   "unit_label": "m",  "obsdate": "...+10:00", "value": [1.582] },
 *     "<id>": { "unit_type": "Precipitation",  "unit_label": "mm", "obsdate": null,        "value": { "last 3 hours": 9.5, ... } }
 *   }
 *
 * Response (normalised):
 *   {
 *     ok: true,
 *     level: 1.582, unit: "m AHD", obsdate: "2026-06-24T16:30:00+10:00",
 *     trigger: 2.1, margin: 0.52, marginText: "0.52 m below trigger",
 *     status: "normal" | "watch" | "near-trigger" | "open",
 *     statusLabel: "Normal",
 *     rain: { "3h": 9.5, "6h": 9.5, "24h": 9.5, "96h": 9.5, unit: "mm" },
 *     station: "Tarbuck Bay", siteNo: "209465",
 *     chartUrl: "https://mhl.nsw.gov.au/Site-209465",
 *     attribution: "Manly Hydraulics Laboratory"
 *   }
 *
 * Fail-open: on any upstream/parse error this still returns HTTP 200 with
 * { ok: false, message, chartUrl } so the widget shows its graceful fallback
 * ("check mhl.nsw.gov.au/Site-209465 directly") rather than an error.
 */

const SITE_NO = process.env.MHL_SITE_NO || '209465';
const USERNAME = process.env.MHL_USERNAME || 'publicwww';
const SOURCE_URL =
  process.env.MHL_API_URL ||
  `https://api.manly.hydraulics.works/api/1.1/readings/latest/${SITE_NO}?username=${USERNAME}`;

// Opening trigger for Smiths Lake (metres AHD). Configurable without a code change.
const TRIGGER = Number(process.env.SMITHS_LAKE_TRIGGER || '2.1');

// Status band thresholds (metres AHD).
const WATCH_AT = Number(process.env.SMITHS_LAKE_WATCH_AT || '1.7');
const NEAR_AT = Number(process.env.SMITHS_LAKE_NEAR_AT || '1.95');

const CHART_URL = `https://mhl.nsw.gov.au/Site-${SITE_NO}`;
const STATION = 'Tarbuck Bay';
const ATTRIBUTION = 'Manly Hydraulics Laboratory';

const STATUS_LABELS = {
  normal: 'Normal',
  watch: 'Watch',
  'near-trigger': 'Near trigger',
  open: 'Open',
};

function round2(n) {
  return Math.round(n * 100) / 100;
}

// Pull the rolling-window rainfall object into short keys. Tolerates missing
// windows and slightly different label wording.
function normaliseRain(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const pick = (re) => {
    const k = Object.keys(value).find((key) => re.test(key));
    return k != null && value[k] != null ? Number(value[k]) : null;
  };
  const rain = {
    '3h': pick(/3\s*hour/i),
    '6h': pick(/6\s*hour/i),
    '24h': pick(/24\s*hour/i),
    '96h': pick(/96\s*hour/i),
    unit: 'mm',
  };
  const hasAny = ['3h', '6h', '24h', '96h'].some((k) => rain[k] != null);
  return hasAny ? rain : null;
}

// Identify the lake's open state. The API only reports level, so "open" can't
// be derived from the reading alone — it's a manual override flipped by PPCA
// when MidCoast Council opens the sandbar. Env var first (no redeploy needed if
// set as a deploy context var), with ?open=1 supported for testing/preview.
function isLakeOpen(event) {
  const q = (event.queryStringParameters && event.queryStringParameters.open) || '';
  if (/^(1|true|yes)$/i.test(q)) return true;
  const flag = process.env.SMITHS_LAKE_OPEN || '';
  return /^(1|true|yes|open)$/i.test(flag.trim());
}

function statusFor(level, open) {
  if (open) return 'open';
  if (level >= NEAR_AT) return 'near-trigger';
  if (level >= WATCH_AT) return 'watch';
  return 'normal';
}

export const handler = async (event) => {
  if (event.httpMethod && event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: corsHeaders(), body: 'Method Not Allowed' };
  }

  const fallback = (message) => ({
    statusCode: 200,
    headers: corsHeaders(),
    body: JSON.stringify({
      ok: false,
      message: message || 'Live data temporarily unavailable',
      station: STATION,
      siteNo: SITE_NO,
      chartUrl: CHART_URL,
      attribution: ATTRIBUTION,
    }),
  });

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    let res;
    try {
      res = await fetch(SOURCE_URL, {
        headers: {
          'User-Agent': 'villagefirst.org.au water-level widget (PPCA community site)',
          Accept: 'application/json',
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) return fallback(`Upstream returned ${res.status}`);

    const data = await res.json();
    const entries = data && typeof data === 'object' ? Object.values(data) : [];

    // Match on unit_type — never on the sensor-id keys, which are not stable.
    const levelEntry = entries.find((e) => e && /water\s*level/i.test(e.unit_type || ''));
    const rainEntry = entries.find((e) => e && /precip|rain/i.test(e.unit_type || ''));

    let level = null;
    let obsdate = null;
    if (levelEntry) {
      const v = levelEntry.value;
      level = Array.isArray(v) ? Number(v[v.length - 1]) : Number(v);
      obsdate = levelEntry.obsdate || null;
    }

    if (level == null || !Number.isFinite(level)) {
      return fallback('No current water-level reading available');
    }

    const open = isLakeOpen(event);
    const status = statusFor(level, open);
    const margin = round2(TRIGGER - level);
    const marginText =
      margin > 0
        ? `${margin.toFixed(2)} m below trigger`
        : margin < 0
        ? `${Math.abs(margin).toFixed(2)} m above trigger`
        : 'at trigger level';

    const body = {
      ok: true,
      level: round2(level),
      unit: 'm AHD',
      obsdate,
      trigger: TRIGGER,
      margin,
      marginText,
      status,
      statusLabel: STATUS_LABELS[status],
      rain: rainEntry ? normaliseRain(rainEntry.value) : null,
      station: STATION,
      siteNo: SITE_NO,
      chartUrl: CHART_URL,
      attribution: ATTRIBUTION,
    };

    return {
      statusCode: 200,
      headers: {
        ...corsHeaders(),
        // Short CDN cache so we stay light on MHL even if the widget is busy.
        'Cache-Control': 'public, max-age=600',
      },
      body: JSON.stringify(body),
    };
  } catch (err) {
    console.error('water-level error:', err);
    return fallback('Live data temporarily unavailable');
  }
};

function corsHeaders() {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };
}

/**
 * _villages.js — shared helper to read a village's lifecycle status.
 * Fail-open to 'live' so Notion hiccups never block surveys.
 */
const NOTION_VERSION = '2022-06-28';
const VILLAGES_DB_ID = process.env.NOTION_VF_VILLAGES_DB_ID || '2c6272ccd9174103a077087c5de250d0';

export async function getVillageStatus(village) {
  if (!village) return 'live';
  try {
    const res = await fetch(`https://api.notion.com/v1/databases/${VILLAGES_DB_ID}/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.NOTION_API_KEY}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' },
      body: JSON.stringify({ filter: { property: 'Village Name', title: { equals: village } }, page_size: 1 }),
    });
    if (!res.ok) return 'live';
    const p = ((await res.json()).results || [])[0];
    return p ? (p.properties['Status']?.select?.name || 'live') : 'live';
  } catch (_) { return 'live'; }
}

/**
 * getVillageRecord(village) — full registry row for a village.
 * Returns { status, contentDbId, newsBuildHook } with safe fallbacks so
 * Smiths Lake keeps working even if the registry is unreadable.
 */
export async function getVillageRecord(village) {
  const fallback = {
    status: 'live',
    contentDbId: process.env.NOTION_CONTENT_DB_ID || '2cad508adfc1809d8438c8f3a5dd8d42',
    newsBuildHook: process.env.NEWS_BUILD_HOOK_URL || null,
  };
  if (!village || village === (process.env.VILLAGE_NAME || 'Smiths Lake')) {
    // Try the registry but never fail the default village
    try {
      const rec = await queryVillage(village || process.env.VILLAGE_NAME || 'Smiths Lake');
      if (rec) return { ...fallback, ...rec, contentDbId: rec.contentDbId || fallback.contentDbId, newsBuildHook: rec.newsBuildHook || fallback.newsBuildHook };
    } catch (_) {}
    return fallback;
  }
  try {
    const rec = await queryVillage(village);
    if (rec) return { status: rec.status || 'live', contentDbId: rec.contentDbId || null, newsBuildHook: rec.newsBuildHook || null };
  } catch (_) {}
  return { status: 'live', contentDbId: null, newsBuildHook: null };
}

async function queryVillage(village) {
  const res = await fetch(`https://api.notion.com/v1/databases/${VILLAGES_DB_ID}/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.NOTION_API_KEY}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' },
    body: JSON.stringify({ filter: { property: 'Village Name', title: { equals: village } }, page_size: 1 }),
  });
  if (!res.ok) return null;
  const p = ((await res.json()).results || [])[0];
  if (!p) return null;
  return {
    status: p.properties['Status']?.select?.name || 'live',
    contentDbId: (p.properties['Content DB ID']?.rich_text || []).map(t => t.plain_text).join('').replace(/[^a-f0-9]/gi, '') || null,
    newsBuildHook: p.properties['News Build Hook']?.url || null,
    publicModules: (p.properties['Public Modules']?.multi_select || []).map(o => o.name),
  };
}

/**
 * Modules whose PUBLIC surfaces are gated by the registry's "Public Modules"
 * multi-select — a village must explicitly switch these on (fail-CLOSED, the
 * opposite of everything else here) via the admin-hub toggle. Modules not in
 * this list are always public once shipped.
 */
const PUBLICLY_GATED = ['events', 'bookings'];

export async function isModulePublic(village, module) {
  if (!PUBLICLY_GATED.includes(module)) return true;
  try {
    const rec = await queryVillage(village || process.env.VILLAGE_NAME || 'Smiths Lake');
    return !!rec && Array.isArray(rec.publicModules) && rec.publicModules.includes(module);
  } catch (_) { return false; } // gated modules fail closed
}

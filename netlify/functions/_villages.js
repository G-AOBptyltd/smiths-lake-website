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

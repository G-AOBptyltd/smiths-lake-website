#!/usr/bin/env node
// Read-only: dump all rows of the VF Villages registry (properties only).
const KEY = process.env.NOTION_API_KEY;
const DB = process.env.NOTION_VF_VILLAGES_DB_ID || '2c6272ccd9174103a077087c5de250d0';
const r = await fetch(`https://api.notion.com/v1/databases/${DB}/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${KEY}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
  body: JSON.stringify({ page_size: 50 }),
});
const data = await r.json();
for (const p of data.results || []) {
  const g = (n) => p.properties[n];
  const txt = (n) => (g(n)?.rich_text || []).map(t => t.plain_text).join('');
  console.log(JSON.stringify({
    name: (g('Village Name')?.title || []).map(t => t.plain_text).join(''),
    status: g('Status')?.select?.name,
    pkg: g('Package')?.select?.name,
    contentDb: txt('Content DB ID').slice(0, 12) + (txt('Content DB ID') ? '…' : ''),
    siteUrl: txt('Site URL'),
    modules: (g('Modules')?.multi_select || []).map(o => o.name).join(','),
    publicModules: (g('Public Modules')?.multi_select || []).map(o => o.name).join(','),
    notes: txt('Notes').slice(0, 80),
    id: p.id,
  }));
}

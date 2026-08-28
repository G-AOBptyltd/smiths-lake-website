#!/usr/bin/env node
// Read-only: find the E2E test volunteer row by email across candidate DBs.
const KEY = process.env.NOTION_API_KEY;
const EMAIL = 'e2e-pilot@example.com';
const DBS = {
  'COOMBA-clone': process.argv[2],
  'FLAGSHIP-shared': '3bfd508adfc181b88653c4c957393fd8',
};
for (const [label, id] of Object.entries(DBS)) {
  const r = await fetch(`https://api.notion.com/v1/databases/${id}/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
    body: JSON.stringify({ filter: { property: 'Email', email: { equals: EMAIL } }, page_size: 5 }),
  });
  const data = await r.json();
  const hits = (data.results || []).map(p => {
    const props = p.properties;
    const vil = props['Village'];
    return {
      village: (vil?.rich_text || []).map(t => t.plain_text).join('') || vil?.select?.name || '?',
      created: p.created_time,
      id: p.id,
    };
  });
  console.log(label, JSON.stringify(hits));
}

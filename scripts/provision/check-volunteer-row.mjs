#!/usr/bin/env node
// Read-only E2E check: confirm the test volunteer row landed in the right village's
// OWN Volunteers DB and did NOT land in the flagship's DB.
const KEY = process.env.NOTION_API_KEY;
const [dbId, label] = [process.argv[2], process.argv[3] || ''];
const r = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${KEY}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
  body: JSON.stringify({ page_size: 20 }),
});
const data = await r.json();
const rows = (data.results || []).map(p => {
  const props = p.properties;
  const title = Object.values(props).find(x => x.type === 'title');
  const email = Object.values(props).find(x => x.type === 'email');
  const vil = props['Village'];
  return {
    name: (title?.title || []).map(t => t.plain_text).join(''),
    email: email?.email || '',
    village: (vil?.rich_text || vil?.select && [{plain_text: vil.select?.name}] || []).map?.(t => t.plain_text).join('') || vil?.select?.name || '',
  };
});
console.log(label, JSON.stringify(rows, null, 1));

/**
 * project-list.js — GET /api/project-list?village=Smiths Lake
 *
 * Returns the village's Project Hub items (from the site content DB) so the
 * survey builder can offer a project dropdown instead of free-text entry.
 *
 * Response: { projects: [{ id, title, slug }] }
 */

const NOTION_VERSION = '2022-06-28';
const CONTENT_DB_ID = process.env.NOTION_DATABASE_ID;

function notionHeaders() {
  return {
    Authorization: `Bearer ${process.env.NOTION_API_KEY}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  };
}

function slugify(str) {
  return String(str || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function sectionMatches(prop, name) {
  if (!prop) return false;
  if (prop.type === 'select') return prop.select?.name === name;
  if (prop.type === 'multi_select') return (prop.multi_select || []).some(o => o.name === name);
  return false;
}

export const handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  if (!CONTENT_DB_ID) {
    return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ projects: [], error: 'Content DB not configured' }) };
  }

  try {
    const projects = [];
    let cursor;
    // Paginate through the content DB, keep only Project Hub items.
    do {
      const res = await fetch(`https://api.notion.com/v1/databases/${CONTENT_DB_ID}/query`, {
        method: 'POST',
        headers: notionHeaders(),
        body: JSON.stringify(cursor ? { start_cursor: cursor, page_size: 100 } : { page_size: 100 }),
      });
      if (!res.ok) {
        return { statusCode: 502, headers: corsHeaders(), body: JSON.stringify({ error: 'Failed to load projects' }) };
      }
      const data = await res.json();
      (data.results || []).forEach(p => {
        const props = p.properties || {};
        if (!sectionMatches(props['Section'], 'Project Hub')) return;
        const title = props['Title']?.title?.[0]?.plain_text || '';
        if (!title) return;
        const slug = props['Slug']?.rich_text?.[0]?.plain_text || slugify(title);
        const status = props['Status / Stage / Phase']?.multi_select?.map(o => o.name).join(', ')
          || props['Status on Web']?.select?.name || '';
        projects.push({ id: p.id, title, slug, status });
      });
      cursor = data.has_more ? data.next_cursor : null;
    } while (cursor);

    projects.sort((a, b) => a.title.localeCompare(b.title));
    return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ projects }) };
  } catch (err) {
    console.error('project-list error:', err);
    return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ error: 'Internal error' }) };
  }
};

function corsHeaders() {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };
}

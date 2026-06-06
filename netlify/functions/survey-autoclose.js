/**
 * survey-autoclose.js — scheduled (daily) auto-close + admin notification.
 *
 * Finds live surveys whose Close Date has passed, sets Status=closed (Active=false),
 * and emails the admin via Resend with the list. Inert-safe: if RESEND_API_KEY is
 * not set it still closes the surveys and just skips the email.
 *
 * Schedule is declared below via `export const config`. Can also be run manually
 * from the Netlify UI (Functions → survey-autoclose → Run).
 */

const NOTION_VERSION = '2022-06-28';
const DB_ID = process.env.NOTION_VF_SURVEYS_DB_ID || 'dd226ceaec144baaac9fddc63a767596';

export const config = { schedule: '@daily' };

function notionHeaders() {
  return {
    Authorization: `Bearer ${process.env.NOTION_API_KEY}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  };
}

export const handler = async () => {
  const now = new Date();
  const closed = [];

  try {
    // Fetch all surveys, find ones that should now be closed.
    const res = await fetch(`https://api.notion.com/v1/databases/${DB_ID}/query`, {
      method: 'POST', headers: notionHeaders(), body: JSON.stringify({}),
    });
    if (!res.ok) {
      console.error('autoclose: Notion query failed', res.status);
      return { statusCode: 502, body: 'Notion query failed' };
    }
    const data = await res.json();

    for (const page of (data.results || [])) {
      const p = page.properties;
      const status = (p['Status']?.select?.name || '').toLowerCase();
      const active = p['Active']?.checkbox || false;
      const closeDate = p['Close Date']?.date?.start || null;
      const name = p['Survey Name']?.title?.[0]?.plain_text || 'Survey';
      if (status === 'closed' || status === 'draft') continue;       // already closed / not opened
      const isOpen = status === 'live' || status === 'scheduled' || active;
      if (!isOpen) continue;
      if (!closeDate || new Date(closeDate) >= now) continue;        // not past close date

      // Close it
      const patch = await fetch(`https://api.notion.com/v1/pages/${page.id}`, {
        method: 'PATCH', headers: notionHeaders(),
        body: JSON.stringify({ properties: { 'Status': { select: { name: 'closed' } }, 'Active': { checkbox: false } } }),
      });
      if (patch.ok) closed.push(name);
      else console.error('autoclose: failed to close', name, await patch.text());
    }

    if (closed.length) await notifyAdmin(closed);

    console.log(`autoclose: closed ${closed.length} survey(s)`, closed);
    return { statusCode: 200, body: JSON.stringify({ closed }) };
  } catch (err) {
    console.error('autoclose error:', err);
    return { statusCode: 500, body: 'Internal error' };
  }
};

async function notifyAdmin(closedNames) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) { console.warn('autoclose: RESEND_API_KEY not set — skipping email'); return; }
  const from = process.env.RESEND_FROM || 'VillageFirst <support@villagefirst.org.au>';
  const to = (process.env.SURVEY_ADMIN_EMAILS || 'admin@villagefirst.org.au').split(',')[0].trim();
  const list = closedNames.map(n => `<li>${n}</li>`).join('');
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from, to,
        subject: `VillageFirst: ${closedNames.length} survey(s) auto-closed`,
        html: `<p>The following survey(s) reached their close date and were automatically closed:</p><ul>${list}</ul><p>Results remain available per each survey's visibility setting.</p>`,
      }),
    });
  } catch (e) { console.error('autoclose: email send failed', e); }
}

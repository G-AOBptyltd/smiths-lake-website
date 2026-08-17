/**
 * volunteer-provision.js — POST /api/volunteer-provision   (SUPER-ADMIN only)
 *
 * One-time setup for the Volunteer hub: creates the three Notion databases
 * (VF Stewards, VF Volunteers, VF Activities) as siblings of the VF Members
 * DB (same parent page), and reports the ids to put into the Netlify env vars:
 *
 *   NOTION_VF_STEWARDS_DB_ID / NOTION_VF_VOLUNTEERS_DB_ID / NOTION_VF_ACTIVITIES_DB_ID
 *
 * Idempotent: any DB whose env var is already set is skipped and its id echoed.
 * DBs created by this integration are automatically shared with it — but per
 * the standing VF gotcha, connect any OTHER integration (VF1) manually in
 * Notion (⋯ → Connections) if it ever needs these DBs.
 */

import { requireRole } from './_auth.js';
import { MEMBERS_DB_ID } from './_members.js';
import { STEWARDS_DB_ID, VOLUNTEERS_DB_ID, ACTIVITIES_DB_ID, notionHeaders, jsonResp } from './_stewards.js';

const SCHEMAS = {
  stewards: {
    title: '🧭 VF Stewards',
    existing: STEWARDS_DB_ID,
    envVar: 'NOTION_VF_STEWARDS_DB_ID',
    properties: {
      'Steward': { title: {} },
      'Email': { email: {} },
      'Village': { rich_text: {} },
      'Cards': { rich_text: {} },
      'Status': { select: { options: [{ name: 'Active', color: 'green' }, { name: 'Removed', color: 'gray' }] } },
      'Added By': { rich_text: {} },
      'Date Added': { date: {} },
    },
  },
  volunteers: {
    title: '🙋 VF Volunteers',
    existing: VOLUNTEERS_DB_ID,
    envVar: 'NOTION_VF_VOLUNTEERS_DB_ID',
    properties: {
      'Volunteer': { title: {} },
      'First Name': { rich_text: {} },
      'Last Name': { rich_text: {} },
      'Email': { email: {} },
      'Phone': { phone_number: {} },
      'Village': { rich_text: {} },
      'Cards': { rich_text: {} },
      'Status': { select: { options: [{ name: 'Applied', color: 'yellow' }, { name: 'Active', color: 'green' }, { name: 'Inactive', color: 'gray' }] } },
      'PPCA Member': { checkbox: {} },
      'Message': { rich_text: {} },
      'Date Joined': { date: {} },
      'Logged By': { rich_text: {} },
      'Last Updated By': { rich_text: {} },
    },
  },
  activities: {
    title: '🛠 VF Activities',
    existing: ACTIVITIES_DB_ID,
    envVar: 'NOTION_VF_ACTIVITIES_DB_ID',
    properties: {
      'Activity': { title: {} },
      'Village': { rich_text: {} },
      'Card Path': { rich_text: {} },
      'Card Title': { rich_text: {} },
      'Date': { date: {} },
      'Description': { rich_text: {} },
      'Status': { select: { options: [{ name: 'Draft', color: 'yellow' }, { name: 'Confirmed', color: 'green' }, { name: 'Pushed', color: 'blue' }] } },
      'Attendance': { rich_text: {} },
      'Total Hours': { number: {} },
      'Created By': { rich_text: {} },
      'Last Updated By': { rich_text: {} },
      'Contribution ID': { rich_text: {} },
      'Note': { rich_text: {} },
    },
  },
};

/**
 * Find a Notion page to parent the new DBs under. Tries the Members DB first,
 * then the Contributions and Surveys DBs, walking block parents up to the
 * containing page (DBs nested inside page sections have block parents, not
 * page parents). An explicit parentPageId in the body always wins.
 */
async function findParentPage(explicit) {
  if (explicit) return String(explicit).replace(/[^a-f0-9-]/gi, '');
  const candidates = [
    MEMBERS_DB_ID,
    process.env.NOTION_CONTRIB_DB_ID || '6d182a0d4f0c42c2879f13753e355861',
    process.env.NOTION_VF_SURVEYS_DB_ID || 'dd226ceaec144baaac9fddc63a767596',
  ];
  const trail = [];
  for (const dbId of candidates) {
    try {
      const res = await fetch(`https://api.notion.com/v1/databases/${dbId}`, { headers: notionHeaders() });
      if (!res.ok) { trail.push(`${dbId.slice(0, 8)}→${res.status}`); continue; }
      let parent = (await res.json()).parent;
      for (let hop = 0; hop < 5 && parent; hop++) {
        if (parent.type === 'page_id') return parent.page_id;
        if (parent.type !== 'block_id') break;
        const b = await fetch(`https://api.notion.com/v1/blocks/${parent.block_id}`, { headers: notionHeaders() });
        if (!b.ok) break;
        parent = (await b.json()).parent;
      }
      trail.push(`${dbId.slice(0, 8)}→${parent?.type || 'none'}`);
    } catch (_) { trail.push(`${dbId.slice(0, 8)}→err`); }
  }
  throw new Error(`No page parent found (${trail.join(', ')}) — POST again with {"parentPageId":"<notion page id>"}`);
}

export const handler = async (event, context) => {
  if (event.httpMethod !== 'POST') return jsonResp(405, { error: 'POST only' });

  const auth = requireRole(context, { anyOf: ['super-admin'] });
  if (!auth.ok) return jsonResp(auth.status, { error: auth.error });

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (_) {}

  try {
    const parentPageId = await findParentPage(body.parentPageId);

    const out = {};
    const created = [];
    for (const [key, spec] of Object.entries(SCHEMAS)) {
      if (spec.existing) { out[spec.envVar] = spec.existing.replace(/-/g, ''); continue; }
      const res = await fetch('https://api.notion.com/v1/databases', {
        method: 'POST',
        headers: notionHeaders(),
        body: JSON.stringify({
          parent: { type: 'page_id', page_id: parentPageId },
          title: [{ type: 'text', text: { content: spec.title } }],
          properties: spec.properties,
        }),
      });
      if (!res.ok) {
        const detail = await res.text();
        throw new Error(`Creating ${spec.title} failed: ${res.status} ${detail.slice(0, 200)}`);
      }
      const db = await res.json();
      out[spec.envVar] = db.id.replace(/-/g, '');
      created.push(spec.title);
    }

    return jsonResp(200, {
      ok: true,
      created,
      envVars: out,
      next: created.length
        ? 'Set these env vars on the Netlify site and redeploy; the new DBs are already shared with this integration.'
        : 'All volunteer DBs already provisioned.',
    });
  } catch (err) {
    return jsonResp(502, { error: err.message });
  }
};

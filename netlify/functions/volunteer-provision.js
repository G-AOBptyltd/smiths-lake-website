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

export const handler = async (event, context) => {
  if (event.httpMethod !== 'POST') return jsonResp(405, { error: 'POST only' });

  const auth = requireRole(context, { anyOf: ['super-admin'] });
  if (!auth.ok) return jsonResp(auth.status, { error: auth.error });

  try {
    // Parent page = wherever the VF Members DB lives (Smiths Lake Community).
    const memRes = await fetch(`https://api.notion.com/v1/databases/${MEMBERS_DB_ID}`, { headers: notionHeaders() });
    if (!memRes.ok) throw new Error(`Could not read Members DB (${memRes.status}) to find the parent page`);
    const members = await memRes.json();
    const parentPageId = members.parent?.page_id;
    if (!parentPageId) throw new Error('Members DB has no page parent — create the volunteer DBs manually');

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

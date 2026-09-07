/**
 * vapp-matrix.js — the volunteers × groups membership grid.
 *
 * GET  /api/vapp-matrix?village=Smiths Lake
 *        → { configured, volunteers:[{id,name,email,groups:[slug]}], groups:[{slug,title}] }
 * POST /api/vapp-matrix  { village, volunteerId, groupSlug, groupTitle, on }
 *        Adds/removes a volunteer_groups row (Supabase = source of truth) AND
 *        emails the volunteer a friendly "you've joined / been removed from X".
 *
 * Admin only (bulk PII editing). Columns are the groups volunteers are already
 * in (correct slugs/titles from volunteer_groups). volunteers.group_id (the
 * app's legacy PRIMARY group) is left untouched.
 */

import { resolveScope, jsonResp } from './_stewards.js';

const SUPA_URL = process.env.VAPP_SUPABASE_URL;
const SUPA_KEY = process.env.VAPP_SUPABASE_SERVICE_KEY;

function slugVillage(v) { return String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
function safeBody(event) { try { return event.body ? JSON.parse(event.body) : {}; } catch (_) { return {}; } }
function asArr(r) { return Array.isArray(r.data) ? r.data : []; }
function esc(s) { return String(s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
function titleCase(slug) {
  return String(slug || '').split('-').filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') || '(group)';
}

async function supa(path, opts = {}) {
  const res = await fetch(`${SUPA_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const text = await res.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; }
  return { ok: res.ok, status: res.status, data };
}

// Friendly heads-up to a volunteer when they're added to / removed from a group.
async function sendGroupEmail({ email, name, groupTitle, village, added }) {
  const key = process.env.VF_RESEND_API_KEY;
  if (!key || !email) return;
  const from = process.env.VF_PLEDGE_FROM || 'VillageFirst <noreply@villagefirst.org.au>';
  const replyTo = (process.env.VF_PLEDGE_NOTIFY_TO || '').split(',')[0].trim();
  const appUrl = process.env.VOLUNTEER_APP_URL || 'https://smithslake-stewards.village1st.com.au';
  const first = String(name || '').trim().split(/\s+/)[0] || 'there';
  const html = added
    ? `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1f2937;max-width:520px;">
        <p>Hi ${esc(first)},</p>
        <p>Great news — you've been added to <b>${esc(groupTitle)}</b> at ${esc(village)}. Thanks for pitching in!</p>
        <p>You'll see this group's working bees and can log your hours in the volunteer app:</p>
        <p><a href="${appUrl}" style="display:inline-block;background:#15795f;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;">Open the volunteer app</a></p>
        <p style="color:#6b7280;font-size:13px;">Not expecting this? Just reply and we'll sort it.</p>
        <p>Thanks,<br>The ${esc(village)} team</p>
      </div>`
    : `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1f2937;max-width:520px;">
        <p>Hi ${esc(first)},</p>
        <p>You've been removed from <b>${esc(groupTitle)}</b> at ${esc(village)}. You won't get this group's updates anymore.</p>
        <p style="color:#6b7280;font-size:13px;">If that's not right, just reply and we'll pop you back on.</p>
        <p>Thanks,<br>The ${esc(village)} team</p>
      </div>`;
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: email, subject: `${added ? 'Added to' : 'Removed from'} ${groupTitle} — ${village}`, html, ...(replyTo ? { reply_to: replyTo } : {}) }),
    });
  } catch (_) { /* best-effort */ }
}

export const handler = async (event, context) => {
  const village = event.queryStringParameters?.village || safeBody(event).village || process.env.VILLAGE_NAME || 'Smiths Lake';
  const scope = await resolveScope(context, village);
  if (!scope.ok) return jsonResp(scope.status, { error: scope.error });
  if (!scope.isAdmin) return jsonResp(403, { error: 'The groups grid is admin-only.' });
  if (!SUPA_URL || !SUPA_KEY) return jsonResp(200, { configured: false, volunteers: [], groups: [] });
  const vslug = slugVillage(village);

  // ── POST: toggle a membership + email the volunteer ────────────────────
  if (event.httpMethod === 'POST') {
    const body = safeBody(event);
    const { volunteerId, groupSlug, on } = body;
    const groupTitle = body.groupTitle || titleCase(groupSlug);
    if (!volunteerId || !groupSlug) return jsonResp(400, { error: 'Bad request' });
    const vr = await supa(`volunteers?id=eq.${encodeURIComponent(volunteerId)}&village_id=eq.${vslug}&select=first_name,last_name,email`);
    if (!vr.ok || !asArr(vr).length) return jsonResp(404, { error: 'Volunteer not found' });
    const vol = asArr(vr)[0];
    if (on) {
      const up = await supa('volunteer_groups?on_conflict=volunteer_id,group_id', {
        method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
        body: JSON.stringify([{ volunteer_id: volunteerId, village_id: vslug, group_id: groupSlug, group_title: groupTitle, is_primary: false, source: 'admin' }]),
      });
      if (!up.ok) return jsonResp(502, { error: 'Could not add to group' });
    } else {
      const del = await supa(`volunteer_groups?volunteer_id=eq.${encodeURIComponent(volunteerId)}&group_id=eq.${encodeURIComponent(groupSlug)}`, {
        method: 'DELETE', headers: { Prefer: 'return=minimal' },
      });
      if (!del.ok) return jsonResp(502, { error: 'Could not remove from group' });
    }
    await sendGroupEmail({ email: vol.email, name: `${vol.first_name || ''} ${vol.last_name || ''}`.trim(), groupTitle, village, added: !!on });
    return jsonResp(200, { ok: true });
  }

  // ── GET: the grid ──────────────────────────────────────────────────────
  try {
    const [vr, gr] = await Promise.all([
      supa(`volunteers?village_id=eq.${vslug}&status=eq.active&select=id,first_name,last_name,email&order=first_name.asc`),
      supa(`volunteer_groups?village_id=eq.${vslug}&select=volunteer_id,group_id,group_title`),
    ]);
    if (!vr.ok) return jsonResp(502, { error: 'Could not read volunteers' });
    const byVol = new Map();
    const groupTitles = new Map();
    for (const m of asArr(gr)) {
      if (!byVol.has(m.volunteer_id)) byVol.set(m.volunteer_id, new Set());
      byVol.get(m.volunteer_id).add(m.group_id);
      if (m.group_id && !groupTitles.has(m.group_id)) groupTitles.set(m.group_id, m.group_title || titleCase(m.group_id));
    }
    const groups = [...groupTitles.entries()].map(([slug, title]) => ({ slug, title })).sort((a, b) => a.title.localeCompare(b.title));
    const volunteers = asArr(vr).map((v) => ({
      id: v.id, name: `${v.first_name || ''} ${v.last_name || ''}`.trim() || v.email || '(no name)',
      email: v.email || '', groups: [...(byVol.get(v.id) || [])],
    }));
    return jsonResp(200, { configured: true, volunteers, groups });
  } catch (err) {
    return jsonResp(502, { error: err.message });
  }
};

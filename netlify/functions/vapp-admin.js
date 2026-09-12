/**
 * vapp-admin.js — bridge the /admin/ console to the Volunteer APP's Supabase
 * data (RSVPs, on-site attendance, hours pending approval, new joiners).
 * Mirrors the in-app steward console for the committee / desktop (part B of the
 * "steward sees it in the app AND the console" design).
 *
 * Auth: Netlify Identity. An admin sees the whole village; a steward is scoped
 * to their VF Stewards cards (same model as the rest of the Volunteer hub).
 * The volunteer data lives in the volunteer APP's Supabase project; this reads
 * and writes it with the SERVICE ROLE (bypasses RLS) and re-checks scope in
 * code — the UI filter is never the gate.
 *
 * Env (set on the villagefirst.org.au / smiths-lake Netlify site):
 *   VAPP_SUPABASE_URL          e.g. https://xxxx.supabase.co
 *   VAPP_SUPABASE_SERVICE_KEY  the service_role key (server only)
 * Until both are set the endpoint returns { configured:false } (no error) so
 * the page shows a friendly "connect me" notice.
 *
 * GET  /api/vapp-admin?village=Smiths Lake
 *        → { configured, pending, decided, totals, rsvps, onsite, joiners, scope }
 *        `decided` is the recent approve/reject history with who decided and
 *        when — without it a decision disappeared the moment it was made.
 * POST /api/vapp-admin  { village, action:'approve'|'reject', id, hours? }
 *        Works on an already-decided row too, so a decision can be changed.
 */

import { normPath, resolveScope, jsonResp } from './_stewards.js';
import { findAppVolunteer } from './_vapp.js';

const SUPA_URL = process.env.VAPP_SUPABASE_URL;
const SUPA_KEY = process.env.VAPP_SUPABASE_SERVICE_KEY;

// The volunteer app's tenant slug: lower-case, non-alphanumerics → hyphen.
function slugVillage(v) {
  return String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
// A steward card path is "environment/landcare-…"; the app's group_id is the slug.
function slugOfPath(p) { return normPath(p).split('/').pop(); }

function safeBody(event) { try { return event.body ? JSON.parse(event.body) : {}; } catch (_) { return {}; } }
function asArr(res) { return Array.isArray(res.data) ? res.data : []; }
function nameOf(row) {
  // `volunteer` is the aliased embed used for hours (two FKs to volunteers, so
  // each must name its constraint); `volunteers` is the plain one used by
  // rsvps/attendance, which have only one.
  const v = row.volunteer || row.volunteers;
  const n = v ? `${v.first_name || ''} ${v.last_name || ''}`.trim() : '';
  return n || 'A volunteer';
}

async function supa(path, opts = {}) {
  const res = await fetch(`${SUPA_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`,
      'Content-Type': 'application/json', ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; }
  return { ok: res.ok, status: res.status, data };
}

export const handler = async (event, context) => {
  const village = event.queryStringParameters?.village
    || safeBody(event).village || process.env.VILLAGE_NAME || 'Smiths Lake';

  const scope = await resolveScope(context, village);
  if (!scope.ok) return jsonResp(scope.status, { error: scope.error });

  if (!SUPA_URL || !SUPA_KEY) {
    return jsonResp(200, {
      configured: false, pending: [], decided: [], totals: {}, rsvps: [], onsite: [], joiners: [],
      scope: { isAdmin: scope.isAdmin },
    });
  }

  const vslug = slugVillage(village);
  const allowed = scope.isAdmin ? null : new Set((scope.cards || []).map((c) => slugOfPath(c.path)));
  const inScope = (gid) => !allowed || (gid != null && allowed.has(gid));

  // ── Approve / reject a pending hours entry ─────────────────────────────
  if (event.httpMethod === 'POST') {
    const body = safeBody(event);
    const { action, id } = body;
    if (!id || !['approve', 'reject'].includes(action)) return jsonResp(400, { error: 'Bad request' });
    const chk = await supa(`hours?id=eq.${encodeURIComponent(id)}&select=village_id,group_id,status`);
    if (!chk.ok || !Array.isArray(chk.data) || !chk.data.length) return jsonResp(404, { error: 'Not found' });
    const row = chk.data[0];
    if (slugVillage(row.village_id) !== vslug) return jsonResp(403, { error: 'Wrong village' });
    if (!inScope(row.group_id)) return jsonResp(403, { error: 'Out of your group scope' });
    const patch = {
      status: action === 'approve' ? 'approved' : 'rejected',
      approved_at: new Date().toISOString(),
    };
    // Record WHO decided, not just when. The app already does this; the
    // console never did, so anything decided at a desk showed no decider.
    // Only works if the signed-in admin/steward also has an app volunteer
    // record — if not, approved_by stays null and the row still decides fine.
    const decider = await findAppVolunteer({ email: scope.user?.email, village });
    if (decider) patch.approved_by = decider.id;
    if (action === 'approve' && body.hours != null && body.hours !== '') {
      const n = Number(body.hours);
      if (!Number.isFinite(n) || n < 0) return jsonResp(400, { error: 'Bad hours' });
      patch.hours = Math.round(n * 100) / 100;
    }
    const up = await supa(`hours?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(patch),
    });
    if (!up.ok) return jsonResp(502, { error: 'Update failed' });
    return jsonResp(200, { ok: true });
  }

  // ── Read the group's app activity ──────────────────────────────────────
  try {
    const sel = 'volunteers(first_name,last_name)';
    const cutoff = new Date(Date.now() - 24 * 3.6e6).toISOString();
    // ⚠️ `hours` has TWO foreign keys to volunteers — volunteer_id and
    // approved_by (added by migration 0004). A bare `volunteers(...)` embed is
    // therefore ambiguous, and PostgREST rejects the WHOLE request rather than
    // picking one. asArr() then yields [] and the page cheerfully reports
    // "nothing waiting" — which is why Hours to approve had been permanently
    // empty here even with pending rows sitting in the table. Both embeds must
    // name their constraint. rsvps/attendance have a single FK, so `sel` is
    // still fine for those.
    const whoSel = 'volunteer:volunteers!hours_volunteer_id_fkey(first_name,last_name)';
    const hoursSel = `id,hours,worked_on,activity_type,group_id,note,volunteer_id,${whoSel}`;
    // `decided` is the audit trail: once hours were approved or rejected they
    // vanished from every screen, so nobody could check what had been waved
    // through, spot a mistake, or answer "did you approve mine?".
    const decidedSel = `${hoursSel},status,approved_at,`
      + 'decided_by:volunteers!hours_approved_by_fkey(first_name,last_name)';
    const [hRes, rRes, aRes, jRes, dRes] = await Promise.all([
      supa(`hours?village_id=eq.${vslug}&status=eq.pending&select=${hoursSel}&order=worked_on.desc`),
      supa(`rsvps?village_id=eq.${vslug}&status=eq.going&select=id,activity_id,group_id,volunteer_id,${sel}`),
      supa(`attendance?village_id=eq.${vslug}&signed_in_at=gte.${cutoff}&select=id,activity_id,group_id,signed_in_at,signed_out_at,volunteer_id,${sel}&order=signed_in_at.desc`),
      supa(`volunteers?village_id=eq.${vslug}&select=id,first_name,last_name,group_id,status,joined_at&order=joined_at.desc&limit=30`),
      supa(`hours?village_id=eq.${vslug}&status=in.(approved,rejected)&select=${decidedSel}&order=approved_at.desc.nullslast&limit=100`),
    ]);
    const pending = asArr(hRes).filter((r) => inScope(r.group_id)).map((r) => ({
      id: r.id, name: nameOf(r), hours: r.hours, worked_on: r.worked_on,
      activity: r.activity_type, group_id: r.group_id, note: r.note,
      auto: !!r.note && /^auto/i.test(r.note),
    }));
    const rsvps = asArr(rRes).filter((r) => inScope(r.group_id)).map((r) => ({
      id: r.id, name: nameOf(r), activity_id: r.activity_id, group_id: r.group_id,
    }));
    const onsite = asArr(aRes).filter((r) => inScope(r.group_id)).map((r) => ({
      id: r.id, name: nameOf(r), activity_id: r.activity_id, group_id: r.group_id,
      signed_in_at: r.signed_in_at, signed_out_at: r.signed_out_at,
    }));
    const joiners = asArr(jRes).filter((r) => inScope(r.group_id)).map((r) => ({
      id: r.id, name: `${r.first_name || ''} ${r.last_name || ''}`.trim(),
      group_id: r.group_id, status: r.status, joined_at: r.joined_at,
    }));
    const decided = asArr(dRes).filter((r) => inScope(r.group_id)).map((r) => ({
      id: r.id, name: nameOf(r), hours: r.hours, worked_on: r.worked_on,
      activity: r.activity_type, group_id: r.group_id, note: r.note,
      status: r.status, decidedAt: r.approved_at,
      decidedBy: r.decided_by
        ? `${r.decided_by.first_name || ''} ${r.decided_by.last_name || ''}`.trim()
        : null,
    }));
    const totals = decided.reduce((t, r) => {
      if (r.status === 'approved') { t.approvedCount += 1; t.approvedHours += Number(r.hours) || 0; }
      else t.rejectedCount += 1;
      return t;
    }, { approvedCount: 0, approvedHours: 0, rejectedCount: 0 });
    totals.approvedHours = Math.round(totals.approvedHours * 100) / 100;

    return jsonResp(200, {
      configured: true, pending, rsvps, onsite, joiners, decided, totals,
      scope: { isAdmin: scope.isAdmin, cards: scope.cards },
    });
  } catch (err) {
    return jsonResp(502, { error: err.message });
  }
};

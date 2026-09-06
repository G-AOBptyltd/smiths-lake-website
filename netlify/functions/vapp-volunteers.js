/**
 * vapp-volunteers.js — the Volunteers DIRECTORY for the /admin/ console.
 *
 * Part of making the volunteer APP's Supabase the single source of truth for
 * volunteers. This is the read/manage surface behind the "Volunteers" tab
 * (sits between Stewards and Sign-up groups). Unlike vapp-admin.js (the
 * hours/RSVP APPROVALS surface, which lists only the last-30 joiners) this
 * returns the FULL directory, grouped by lifecycle status, with the group(s)
 * each volunteer belongs to (read from the volunteer_groups join table, with a
 * fallback to the legacy single group_id until migration 0006 is applied).
 *
 * MERGED view (transition aid while the Notion roster is migrated into
 * Supabase): it also reads the Notion 🙋 VF Volunteers roster and flags anyone
 * present there but NOT yet in Supabase as `notMigrated` — that gap IS the
 * migration to-do list, and it drains to zero once vapp-migrate + the signup
 * write-cutover have run.
 *
 * Auth: Netlify Identity. Admin sees the whole village; a steward is scoped to
 * their VF Stewards cards. Supabase is read/written with the SERVICE ROLE
 * (bypasses RLS); scope is always re-checked in code. Mirrors vapp-admin.js.
 *
 * Env (villagefirst.org.au / smiths-lake Netlify site):
 *   VAPP_SUPABASE_URL          e.g. https://xxxx.supabase.co
 *   VAPP_SUPABASE_SERVICE_KEY  the service_role key (server only)
 * Until both are set → { configured:false } (friendly "connect me" notice).
 *
 * GET  /api/vapp-volunteers?village=Smiths Lake
 *        → { configured, scope, volunteers:[…], counts:{…} }
 * POST /api/vapp-volunteers  { village, action:'setStatus', id, status }
 *        status ∈ active | inactive | archived   (app volunteers only)
 */

import {
  resolveScope, jsonResp, normPath,
  queryAll, parseVolunteer, VOLUNTEERS_DB_ID,
} from './_stewards.js';

const SUPA_URL = process.env.VAPP_SUPABASE_URL;
const SUPA_KEY = process.env.VAPP_SUPABASE_SERVICE_KEY;

const APP_STATUSES = ['active', 'inactive', 'archived'];

// Newsletter interest → volunteer group. A subscriber with a matching interest
// surfaces as a read-only "interested" lead on that group. Extend as more
// interest groups map to volunteer cards.
const INTEREST_GROUPS = [
  { match: /landcare/i, slug: 'landcare-and-bush-regeneration', title: 'Landcare & Bush Regeneration', path: 'environment/landcare-and-bush-regeneration' },
];

function esc(s) { return String(s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

function slugVillage(v) {
  return String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
// A steward card path is "environment/landcare-…"; the app's group slug is the last segment.
function slugOfPath(p) { return normPath(p).split('/').pop(); }
function safeBody(event) { try { return event.body ? JSON.parse(event.body) : {}; } catch (_) { return {}; } }
function asArr(res) { return Array.isArray(res.data) ? res.data : []; }
function titleCase(slug) {
  return String(slug || '').split('-').filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') || '(no group)';
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

// Group memberships for a village → Map(volunteer_id → [{slug,title}]).
// Reads the volunteer_groups join table; returns null if that table isn't there
// yet (pre-migration) so the caller can fall back to the single group_id.
async function loadGroupMemberships(vslug) {
  const res = await supa(
    `volunteer_groups?village_id=eq.${vslug}&select=volunteer_id,group_id,group_title,is_primary`
  );
  if (!res.ok) return null;                       // table absent → fall back
  const map = new Map();
  for (const r of asArr(res)) {
    if (!map.has(r.volunteer_id)) map.set(r.volunteer_id, []);
    map.get(r.volunteer_id).push({ slug: r.group_id, title: r.group_title || titleCase(r.group_id), primary: !!r.is_primary });
  }
  return map;
}

export const handler = async (event, context) => {
  const village = event.queryStringParameters?.village
    || safeBody(event).village || process.env.VILLAGE_NAME || 'Smiths Lake';

  const scope = await resolveScope(context, village);
  if (!scope.ok) return jsonResp(scope.status, { error: scope.error });

  if (!SUPA_URL || !SUPA_KEY) {
    return jsonResp(200, { configured: false, scope: { isAdmin: scope.isAdmin }, volunteers: [], counts: {} });
  }

  const vslug = slugVillage(village);
  const allowedSlugs = scope.isAdmin ? null : new Set((scope.cards || []).map((c) => slugOfPath(c.path)));
  const inAllowed = (slug) => !allowedSlugs || (slug != null && allowedSlugs.has(slug));

  // ── POST: lead actions + volunteer status (archive / restore) ─────────
  if (event.httpMethod === 'POST') {
    const body = safeBody(event);
    const { action } = body;

    // Convert a newsletter "interested" lead into a volunteer in a group.
    if (action === 'addLead') {
      const email = String(body.email || '').toLowerCase().trim();
      const groupSlug = body.groupSlug;
      const groupTitle = body.groupTitle || titleCase(groupSlug || '');
      if (!email || !groupSlug) return jsonResp(400, { error: 'Bad request' });
      if (!inAllowed(groupSlug)) return jsonResp(403, { error: 'Out of your group scope' });
      const ex = await supa(`volunteers?village_id=eq.${vslug}&email=eq.${encodeURIComponent(email)}&select=id`);
      if (ex.ok && Array.isArray(ex.data) && ex.data.length) return jsonResp(200, { ok: true, already: true });
      const ins = await supa('volunteers', {
        method: 'POST', headers: { Prefer: 'return=representation' },
        body: JSON.stringify([{
          village_id: vslug, first_name: body.firstName || '(no name)', last_name: body.lastName || '',
          mobile: '', email, group_id: groupSlug, status: 'active', member_status: null,
        }]),
      });
      const vid = ins.ok && Array.isArray(ins.data) ? ins.data[0]?.id : null;
      if (!vid) return jsonResp(502, { error: 'Could not add volunteer' });
      await supa('volunteer_groups', {
        method: 'POST', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify([{ volunteer_id: vid, village_id: vslug, group_id: groupSlug, group_title: groupTitle, is_primary: true, source: 'website' }]),
      });
      return jsonResp(200, { ok: true });
    }

    // Invite a lead to volunteer — short branded email via Resend (no mailto).
    if (action === 'inviteLead') {
      const email = String(body.email || '').toLowerCase().trim();
      const groupSlug = body.groupSlug;
      if (!email || !groupSlug) return jsonResp(400, { error: 'Bad request' });
      if (!inAllowed(groupSlug)) return jsonResp(403, { error: 'Out of your group scope' });
      const key = process.env.VF_RESEND_API_KEY;
      if (!key) return jsonResp(200, { ok: false, error: 'Email sending isn’t configured (VF_RESEND_API_KEY).' });
      const ig = INTEREST_GROUPS.find((g) => g.slug === groupSlug) || {};
      const groupTitle = body.groupTitle || ig.title || titleCase(groupSlug);
      const first = String(body.firstName || '').trim();
      const from = process.env.VF_PLEDGE_FROM || 'VillageFirst <noreply@villagefirst.org.au>';
      const replyTo = (process.env.VF_PLEDGE_NOTIFY_TO || '').split(',')[0].trim();
      const link = `https://villagefirst.org.au/${ig.path || ''}`;
      const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1f2937;max-width:520px;">
        <p>Hi${first ? ' ' + esc(first) : ' there'},</p>
        <p>You told us you're interested in <b>${esc(groupTitle)}</b> here at ${esc(village)} — that's wonderful. We'd love to have you lend a hand.</p>
        <p>Getting involved takes a minute:</p>
        <p><a href="${link}" style="display:inline-block;background:#15795f;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;">Volunteer for ${esc(groupTitle)}</a></p>
        <p style="color:#6b7280;font-size:13px;">No pressure — reply to this email if you'd just like to know more first. You'll stay on our newsletter either way.</p>
        <p>Thanks,<br>The ${esc(village)} team</p>
      </div>`;
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: email, subject: `Get involved with ${groupTitle}`, html, ...(replyTo ? { reply_to: replyTo } : {}) }),
      });
      if (!res.ok) return jsonResp(502, { error: 'Could not send the invite' });
      return jsonResp(200, { ok: true });
    }

    // Dismiss (or restore) a lead for a group — stops it showing as interested.
    if (action === 'dismissLead' || action === 'undismissLead') {
      const email = String(body.email || '').toLowerCase().trim();
      const groupSlug = body.groupSlug;
      if (!email || !groupSlug) return jsonResp(400, { error: 'Bad request' });
      if (!inAllowed(groupSlug)) return jsonResp(403, { error: 'Out of your group scope' });
      const cur = await supa(`subscribers?village_id=eq.${vslug}&email=eq.${encodeURIComponent(email)}&select=dismissed_groups`);
      if (!cur.ok || !Array.isArray(cur.data) || !cur.data.length) return jsonResp(404, { error: 'Not found' });
      let arr = Array.isArray(cur.data[0].dismissed_groups) ? cur.data[0].dismissed_groups : [];
      if (action === 'dismissLead') { if (!arr.includes(groupSlug)) arr.push(groupSlug); }
      else { arr = arr.filter((g) => g !== groupSlug); }
      const up = await supa(`subscribers?village_id=eq.${vslug}&email=eq.${encodeURIComponent(email)}`, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ dismissed_groups: arr }),
      });
      if (!up.ok) return jsonResp(502, { error: 'Update failed' });
      return jsonResp(200, { ok: true });
    }

    // setStatus (archive / restore) on an existing app volunteer.
    const { id, status } = body;
    if (action !== 'setStatus') return jsonResp(400, { error: 'Unknown action' });
    if (!id || !APP_STATUSES.includes(status)) return jsonResp(400, { error: 'Bad request' });
    const chk = await supa(`volunteers?id=eq.${encodeURIComponent(id)}&select=village_id,group_id`);
    if (!chk.ok || !Array.isArray(chk.data) || !chk.data.length) return jsonResp(404, { error: 'Not found' });
    const row = chk.data[0];
    if (slugVillage(row.village_id) !== vslug) return jsonResp(403, { error: 'Wrong village' });
    if (allowedSlugs) {                            // steward: any of their groups covers this volunteer?
      const gm = await loadGroupMemberships(vslug);
      const slugs = gm?.get(id)?.map((g) => g.slug) || (row.group_id ? [row.group_id] : []);
      if (!slugs.some(inAllowed)) return jsonResp(403, { error: 'Out of your group scope' });
    }
    const up = await supa(`volunteers?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status }),
    });
    if (!up.ok) return jsonResp(502, { error: 'Update failed' });
    return jsonResp(200, { ok: true });
  }

  // ── GET: the full directory ────────────────────────────────────────────
  try {
    // 1) App volunteers (Supabase — the source of truth).
    const vRes = await supa(
      `volunteers?village_id=eq.${vslug}` +
      `&select=id,first_name,last_name,email,mobile,group_id,status,member_status,joined_at` +
      `&order=joined_at.desc`
    );
    if (!vRes.ok) return jsonResp(502, { error: 'Could not read the volunteer app database' });

    const memberships = await loadGroupMemberships(vslug);   // Map or null (pre-migration)

    // slug → nice title, learned from steward cards + Notion roster cards.
    const titleBySlug = new Map();
    (scope.cards || []).forEach((c) => titleBySlug.set(slugOfPath(c.path), c.title));

    // 2) Notion roster (website sign-ups) — for the merge + not-migrated flag.
    let notionRows = [];
    try {
      const pages = await queryAll(VOLUNTEERS_DB_ID, { property: 'Village', rich_text: { equals: village } });
      notionRows = pages.map(parseVolunteer);
      for (const nv of notionRows) for (const c of (nv.cards || [])) {
        const s = slugOfPath(c.path); if (c.title && !titleBySlug.has(s)) titleBySlug.set(s, c.title);
      }
    } catch (_) { notionRows = []; /* fail-open: still show the app directory */ }

    const groupObj = (slug) => ({ slug, title: titleBySlug.get(slug) || titleCase(slug) });
    const groupsFor = (row) => {
      const mem = memberships?.get(row.id);
      if (mem && mem.length) return mem.map((g) => ({ slug: g.slug, title: titleBySlug.get(g.slug) || g.title }));
      return row.group_id ? [groupObj(row.group_id)] : [];
    };

    // 3) App-volunteer records (scoped), keyed by email for de-dup.
    const byEmail = new Map();
    const volunteers = [];
    for (const r of asArr(vRes)) {
      const groups = groupsFor(r);
      if (allowedSlugs && !groups.some((g) => inAllowed(g.slug))) continue;   // steward scope
      const email = (r.email || '').toLowerCase();
      const rec = {
        source: 'app', id: r.id, inApp: true, inNotion: false,
        name: `${r.first_name || ''} ${r.last_name || ''}`.trim() || '(no name)',
        firstName: r.first_name || '', lastName: r.last_name || '',
        email: r.email || '', phone: r.mobile || '',
        status: APP_STATUSES.includes(r.status) ? r.status : 'active',
        groups, isMember: r.member_status === 'member', memberStatus: r.member_status || null,
        joinedAt: r.joined_at || null, notMigrated: false,
      };
      volunteers.push(rec);
      if (email) byEmail.set(email, rec);
    }

    // 4) Fold in Notion-only volunteers (not yet in Supabase) — the migration gap.
    for (const nv of notionRows) {
      const email = (nv.email || '').toLowerCase();
      const existing = email && byEmail.get(email);
      if (existing) { existing.inNotion = true; continue; }          // present in both stores
      const cards = (nv.cards || []).map((c) => ({ slug: slugOfPath(c.path), title: c.title || titleCase(slugOfPath(c.path)) }));
      if (allowedSlugs && !cards.some((c) => inAllowed(c.slug))) continue;   // steward scope
      volunteers.push({
        source: 'notion', id: nv.id, inApp: false, inNotion: true,
        name: nv.name, firstName: nv.firstName, lastName: nv.lastName,
        email: nv.email || '', phone: nv.phone || '',
        status: (nv.status || 'Applied').toLowerCase(),             // Applied/Active/Inactive
        groups: cards, isMember: !!nv.isMember, memberStatus: null,
        joinedAt: nv.dateJoined || null, notMigrated: true,
      });
    }

    // 5) Fold in newsletter subscribers whose interests map to a volunteer group
    //    (e.g. Landcare) as read-only "interested" leads — NOT volunteers, so
    //    the group's steward/admin can see who to reach out to. Skips anyone
    //    already in the list (by email). PII → scope-gated like everything else.
    const shownEmails = new Set(volunteers.map((v) => (v.email || '').toLowerCase()).filter(Boolean));
    try {
      const subRes = await supa(`subscribers?village_id=eq.${vslug}&status=eq.subscribed&select=email,first_name,last_name,interests,dismissed_groups`);
      const subs = asArr(subRes);
      // Cross-badge: flag volunteers who are also on the newsletter.
      const subEmails = new Set(subs.map((s) => (s.email || '').toLowerCase()).filter(Boolean));
      for (const v of volunteers) { if (v.email && subEmails.has(v.email.toLowerCase())) v.onNewsletter = true; }
      for (const s of subs) {
        const ints = Array.isArray(s.interests) ? s.interests : [];
        if (!ints.length) continue;
        const dismissed = Array.isArray(s.dismissed_groups) ? s.dismissed_groups : [];
        const email = (s.email || '').toLowerCase();
        for (const ig of INTEREST_GROUPS) {
          if (!ints.some((i) => ig.match.test(i))) continue;
          if (dismissed.includes(ig.slug)) continue;         // dismissed as a lead here
          if (!inAllowed(ig.slug)) continue;                 // scope
          if (email && shownEmails.has(email)) continue;     // already a volunteer/lead
          if (email) shownEmails.add(email);
          volunteers.push({
            source: 'newsletter', id: 'sub:' + email, inApp: false, inNotion: false,
            name: `${s.first_name || ''} ${s.last_name || ''}`.trim() || s.email || '(no name)',
            firstName: s.first_name || '', lastName: s.last_name || '',
            email: s.email || '', phone: '',
            status: 'interested', interested: true,
            groups: [{ slug: ig.slug, title: ig.title }],
            isMember: false, memberStatus: null, joinedAt: null, notMigrated: false,
          });
        }
      }
    } catch (_) { /* fail-open: subscribers table optional */ }

    const counts = {
      total: volunteers.length,
      active: volunteers.filter((v) => v.inApp && v.status === 'active').length,
      inactive: volunteers.filter((v) => v.inApp && v.status === 'inactive').length,
      archived: volunteers.filter((v) => v.inApp && v.status === 'archived').length,
      notMigrated: volunteers.filter((v) => v.notMigrated).length,
      interested: volunteers.filter((v) => v.interested).length,
    };

    return jsonResp(200, {
      configured: true,
      migrated: memberships !== null,             // false until 0006 applied
      scope: { isAdmin: scope.isAdmin, cards: scope.cards },
      volunteers, counts,
    });
  } catch (err) {
    return jsonResp(502, { error: err.message });
  }
};

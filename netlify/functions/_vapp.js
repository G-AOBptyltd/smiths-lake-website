/**
 * _vapp.js — the bridge between this website's /admin/ console (Notion +
 * Netlify Identity) and the volunteer APP's Supabase project.
 *
 * WHY THIS EXISTS. The two halves of the volunteer hub were wired to different
 * stores and never introduced to each other:
 *
 *   • A steward appointed in /admin/volunteers/ got a Notion "VF Stewards" row
 *     and a Netlify Identity role — but NOTHING in Supabase. The app decides
 *     who is a steward by reading `volunteer_roles` (see Home.tsx), a table
 *     that no code ever wrote to. So a real steward opened the app and saw a
 *     plain volunteer screen: no group, no hours to approve.
 *   • Hours logged against a working bee went to the Notion activity ledger
 *     only, while the app reads the Supabase `hours` table only. Hours logged
 *     on the desktop were therefore invisible on the phone.
 *
 * Everything here runs with the SERVICE ROLE (bypasses RLS), so every caller
 * must have re-checked village + card scope BEFORE calling in. These helpers
 * are deliberately best-effort: a Supabase hiccup returns a warning string and
 * never fails the Notion write that is still the console's system of record.
 *
 * Env (villagefirst.org.au / smiths-lake Netlify site):
 *   VAPP_SUPABASE_URL          e.g. https://xxxx.supabase.co
 *   VAPP_SUPABASE_SERVICE_KEY  the service_role key (server only)
 * With either unset every helper no-ops and reports `configured: false`.
 */

const SUPA_URL = process.env.VAPP_SUPABASE_URL;
const SUPA_KEY = process.env.VAPP_SUPABASE_SERVICE_KEY;

export function vappConfigured() { return !!(SUPA_URL && SUPA_KEY); }

/** The app's tenant slug: lower-case, non-alphanumerics → hyphen. Must match
 *  vapp-admin.js / vapp-volunteers.js exactly — it is the partition key. */
export function slugVillage(v) {
  return String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** A steward card path is "environment/landcare-bush-regeneration"; the app's
 *  group_id is the last segment. Same rule as vapp-admin.js. */
export function slugOfPath(p) {
  return String(p || '').replace(/^\/+|\/+$/g, '').split('/').pop();
}

export async function supa(path, opts = {}) {
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

const norm = (s) => String(s || '').trim().toLowerCase();

/**
 * Find the app volunteer for a person. Email is the reliable key (it is what
 * the magic-link sign-in claims against — see app_claim_volunteer()); the name
 * fallback exists only because the Notion roster predates Supabase and some
 * older rows carry no email.
 */
export async function findAppVolunteer({ email, name, village }) {
  if (!vappConfigured()) return null;
  const vslug = slugVillage(village);
  const em = norm(email);
  if (em) {
    const r = await supa(`volunteers?village_id=eq.${vslug}&email=ilike.${encodeURIComponent(em)}&select=id,first_name,last_name,email&limit=2`);
    if (r.ok && Array.isArray(r.data) && r.data.length) return r.data[0];
  }
  const full = norm(name);
  if (!full) return null;
  const r = await supa(`volunteers?village_id=eq.${vslug}&select=id,first_name,last_name,email`);
  if (!r.ok || !Array.isArray(r.data)) return null;
  const hits = r.data.filter((v) => norm(`${v.first_name || ''} ${v.last_name || ''}`) === full);
  // Only trust a name match when it is UNAMBIGUOUS — two Jane Smiths must not
  // silently hand one of them the other's steward powers or hours.
  return hits.length === 1 ? hits[0] : null;
}

/**
 * Make the app agree with the console about who stewards what.
 *
 * `cards` is the steward's card list from the VF Stewards register; each card
 * becomes one `volunteer_roles` row scoped to that group slug. Pass an empty
 * array to revoke (steward removed / all cards taken away). We REPLACE the
 * group_leader grants rather than merge, so the console stays authoritative.
 *
 * Note we only ever touch role='group_leader'. Other grants (first_aid,
 * assoc_admin, platform_admin) are managed elsewhere and must survive.
 */
export async function syncStewardRole({ email, name, village, cards, active = true }) {
  if (!vappConfigured()) return { synced: false, warning: null };
  try {
    const vol = await findAppVolunteer({ email, name, village });
    if (!vol) {
      return {
        synced: false,
        warning: 'this steward has no volunteer record in the app yet — they need to open the app and '
          + 'sign up once, then re-save them here to switch on their steward view.',
      };
    }
    const vslug = slugVillage(village);
    const wanted = active
      ? Array.from(new Set((cards || []).map((c) => slugOfPath(c?.path)).filter(Boolean)))
      : [];

    const cur = await supa(`volunteer_roles?volunteer_id=eq.${vol.id}&role=eq.group_leader&select=id,group_id`);
    const existing = (cur.ok && Array.isArray(cur.data)) ? cur.data : [];
    const have = new Set(existing.map((r) => r.group_id).filter(Boolean));

    const toAdd = wanted.filter((g) => !have.has(g));
    const toDrop = existing.filter((r) => !wanted.includes(r.group_id));

    if (toAdd.length) {
      const ins = await supa('volunteer_roles', {
        method: 'POST', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify(toAdd.map((g) => ({
          volunteer_id: vol.id, village_id: vslug, role: 'group_leader', group_id: g,
        }))),
      });
      if (!ins.ok) return { synced: false, warning: 'switching on their steward view in the app failed — try re-saving.' };
    }
    for (const r of toDrop) {
      await supa(`volunteer_roles?id=eq.${r.id}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    }
    return { synced: true, warning: null, volunteerId: vol.id, groups: wanted };
  } catch (_) {
    return { synced: false, warning: 'the app steward view could not be updated — check it in the app.' };
  }
}

/**
 * Mirror a working bee's attendance into the app's `hours` table so hours
 * logged at a desk show up on the volunteer's phone.
 *
 * Idempotent by `source_ref` = the Notion activity page id: every re-save of
 * an activity deletes that activity's mirrored rows and rewrites them, so
 * editing attendance never leaves duplicates or orphans behind.
 *
 * These rows land as 'approved': a steward logging a working bee at the
 * console IS the approval — sending them back to that same steward's approval
 * queue in the app would be a loop, not a gate. Hours whose volunteer cannot
 * be matched to an app record are skipped (they stay in the Notion ledger,
 * which remains the audit trail behind grant claims).
 */
export async function mirrorActivityHours({ pageId, village, cardPath, date, attendance, activityTitle }) {
  if (!vappConfigured() || !pageId) return { mirrored: 0, warning: null };
  try {
    const vslug = slugVillage(village);
    const ref = String(pageId).replace(/-/g, '');
    // Clear this activity's previous mirror, then rewrite from scratch.
    await supa(`hours?source_ref=eq.${ref}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });

    // Resolve every attendee against ONE roster read — a working bee can have
    // 200 names on it, and a lookup each would be 200 round trips.
    const roster = await supa(`volunteers?village_id=eq.${vslug}&select=id,first_name,last_name`);
    const byName = new Map();
    for (const v of ((roster.ok && Array.isArray(roster.data)) ? roster.data : [])) {
      const k = norm(`${v.first_name || ''} ${v.last_name || ''}`);
      if (!k) continue;
      // Ambiguous names resolve to nobody rather than to the wrong person.
      byName.set(k, byName.has(k) ? null : v);
    }

    const rows = [];
    for (const a of (attendance || [])) {
      const vol = byName.get(norm(a?.name));
      if (!vol) continue;
      rows.push({
        village_id: vslug,
        volunteer_id: vol.id,
        group_id: slugOfPath(cardPath),
        activity_type: activityTitle || null,
        hours: a.hours,
        worked_on: date,
        source: 'manual',
        source_ref: ref,
        status: 'approved',
        note: 'Logged at a working bee by your steward',
      });
    }
    if (!rows.length) return { mirrored: 0, warning: null };
    const ins = await supa('hours', {
      method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(rows),
    });
    if (!ins.ok) return { mirrored: 0, warning: 'Activity saved, but these hours did not reach the volunteers’ app.' };
    return { mirrored: rows.length, warning: null };
  } catch (_) {
    return { mirrored: 0, warning: 'Activity saved, but these hours did not reach the volunteers’ app.' };
  }
}

/** Remove an activity's mirrored hours (used when the activity is deleted). */
export async function unmirrorActivityHours(pageId) {
  if (!vappConfigured() || !pageId) return;
  try {
    const ref = String(pageId).replace(/-/g, '');
    await supa(`hours?source_ref=eq.${ref}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
  } catch (_) { /* best-effort */ }
}

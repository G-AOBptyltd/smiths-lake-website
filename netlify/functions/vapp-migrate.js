/**
 * vapp-migrate.js — one-time Notion 🙋 VF Volunteers → Supabase migration.
 *
 * Moves website-roster volunteers into the volunteer APP's Supabase so Supabase
 * becomes the single source of truth. SAFE BY DESIGN:
 *   • SUPER-ADMIN only (this writes production data).
 *   • GET  = DRY RUN. Reads both stores, reports exactly what WOULD happen.
 *            Writes nothing.
 *   • POST = COMMIT. Refuses unless: body.confirm === true AND
 *            body.expected === <the dry-run insert count> AND the
 *            volunteer_groups table exists (migration 0006 applied). This makes
 *            an accidental or stale-count commit impossible.
 *   • Idempotent: a Notion volunteer already present in Supabase (matched by
 *            lower-cased email + village) is SKIPPED, never duplicated.
 *   • Never guesses: a Notion row with NO email can't be safely de-duped, so it
 *            is reported under `needsReview` and skipped — never inserted.
 *
 * GET  /api/vapp-migrate?village=Smiths Lake
 * POST /api/vapp-migrate  { village, confirm:true, expected:<n> }
 */

import {
  jsonResp, normPath, queryAll, parseVolunteer, VOLUNTEERS_DB_ID,
} from './_stewards.js';
import { requireRole, getRoles } from './_auth.js';

const SUPA_URL = process.env.VAPP_SUPABASE_URL;
const SUPA_KEY = process.env.VAPP_SUPABASE_SERVICE_KEY;

function slugVillage(v) {
  return String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
function slugOfPath(p) { return normPath(p).split('/').pop(); }
function safeBody(event) { try { return event.body ? JSON.parse(event.body) : {}; } catch (_) { return {}; } }
function titleCase(slug) {
  return String(slug || '').split('-').filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') || '(no group)';
}
// Notion Status → app lifecycle status.
function mapStatus(s) {
  const v = String(s || '').toLowerCase();
  if (v === 'inactive') return 'inactive';
  return 'active';        // Applied / Active / anything else → active
}
function splitName(nv) {
  let first = nv.firstName || '', last = nv.lastName || '';
  if (!first && !last && nv.name && nv.name !== '(no name)') {
    const parts = nv.name.trim().split(/\s+/);
    first = parts.shift() || ''; last = parts.join(' ');
  }
  return { first, last };
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

// Build the migration plan from the two stores (used by both dry-run and commit).
async function buildPlan(village) {
  const vslug = slugVillage(village);

  // Existing Supabase volunteers (for idempotent de-dup by email).
  const existing = await supa(`volunteers?village_id=eq.${vslug}&select=id,email`);
  if (!existing.ok) throw new Error('Could not read Supabase volunteers');
  const haveEmails = new Set(
    (Array.isArray(existing.data) ? existing.data : [])
      .map((r) => (r.email || '').toLowerCase()).filter(Boolean)
  );

  // Notion roster for this village.
  const pages = await queryAll(VOLUNTEERS_DB_ID, { property: 'Village', rich_text: { equals: village } });
  const rows = pages.map(parseVolunteer);

  const toInsert = [], alreadyPresent = [], needsReview = [];
  for (const nv of rows) {
    const email = (nv.email || '').toLowerCase();
    if (!email) { needsReview.push({ name: nv.name, reason: 'no email — cannot de-dup safely' }); continue; }
    if (haveEmails.has(email)) { alreadyPresent.push({ name: nv.name, email: nv.email }); continue; }
    const { first, last } = splitName(nv);
    const groups = (nv.cards || []).map((c, i) => ({
      slug: slugOfPath(c.path), title: c.title || titleCase(slugOfPath(c.path)), primary: i === 0,
    }));
    toInsert.push({
      village_id: vslug,
      first_name: first || '(unknown)', last_name: last || '',
      mobile: nv.phone || '', email: nv.email,
      group_id: groups[0]?.slug || null,
      status: mapStatus(nv.status),
      member_status: nv.isMember ? 'member' : null,
      joined_at: nv.dateJoined || null,
      _groups: groups,
    });
  }
  return { vslug, notionTotal: rows.length, toInsert, alreadyPresent, needsReview };
}

async function tableExists(table) {
  const r = await supa(`${table}?select=id&limit=1`);
  return r.ok;      // PostgREST 404/400 when the relation is absent
}

export const handler = async (event, context) => {
  const village = event.queryStringParameters?.village
    || safeBody(event).village || process.env.VILLAGE_NAME || 'Smiths Lake';

  // Super-admin only, for every method.
  const auth = requireRole(context, { village, anyOf: ['admin'] });
  if (!auth.ok) return jsonResp(auth.status, { error: auth.error });
  if (!getRoles(auth.user).includes('super-admin')) {
    return jsonResp(403, { error: 'Migration is restricted to the super-admin.' });
  }
  if (!SUPA_URL || !SUPA_KEY) return jsonResp(200, { configured: false });

  try {
    const plan = await buildPlan(village);
    const summary = {
      configured: true,
      village,
      notionTotal: plan.notionTotal,
      willInsert: plan.toInsert.length,
      alreadyInSupabase: plan.alreadyPresent.length,
      needsReview: plan.needsReview,
      preview: plan.toInsert.slice(0, 200).map((r) => ({
        name: `${r.first_name} ${r.last_name}`.trim(), email: r.email,
        status: r.status, groups: r._groups.map((g) => g.title),
      })),
    };

    // ── DRY RUN ──────────────────────────────────────────────────────────
    if (event.httpMethod !== 'POST') return jsonResp(200, { mode: 'dry-run', ...summary });

    // ── COMMIT (heavily guarded) ─────────────────────────────────────────
    const body = safeBody(event);
    if (body.confirm !== true) return jsonResp(400, { error: 'Commit requires confirm:true', ...summary });
    if (body.expected !== plan.toInsert.length) {
      return jsonResp(409, { error: `Count mismatch — expected ${body.expected}, plan has ${plan.toInsert.length}. Re-run the dry run.`, ...summary });
    }
    if (!(await tableExists('volunteer_groups'))) {
      return jsonResp(412, { error: 'Apply migration 0006 (volunteer_groups) to Supabase before committing.', ...summary });
    }

    const inserted = [], failed = [];
    for (const r of plan.toInsert) {
      const { _groups, ...vol } = r;
      const ins = await supa('volunteers', {
        method: 'POST', headers: { Prefer: 'return=representation' },
        body: JSON.stringify([vol]),
      });
      const newId = ins.ok && Array.isArray(ins.data) ? ins.data[0]?.id : null;
      if (!newId) { failed.push({ email: r.email, error: `insert ${ins.status}` }); continue; }
      if (_groups.length) {
        await supa('volunteer_groups', {
          method: 'POST', headers: { Prefer: 'return=minimal' },
          body: JSON.stringify(_groups.map((g) => ({
            volunteer_id: newId, village_id: plan.vslug,
            group_id: g.slug, group_title: g.title, is_primary: g.primary, source: 'migration',
          }))),
        });
      }
      inserted.push(r.email);
    }
    return jsonResp(200, { mode: 'commit', insertedCount: inserted.length, failed, ...summary });
  } catch (err) {
    return jsonResp(502, { error: err.message });
  }
};

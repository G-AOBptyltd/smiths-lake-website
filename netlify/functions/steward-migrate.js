/**
 * steward-migrate.js — one-time Notion "🧭 VF Stewards" → Supabase migration.
 *
 * Phase 3b of the PII plan: the steward register's Notion rows (9 counted on
 * 15 Sep 2026 — 8 Active, 1 Removed, all Smiths Lake) move into the
 * `stewards` table (migration 0018) so Supabase becomes the single source of
 * truth and the Notion rows can then be deleted BY HAND. This endpoint never
 * deletes, edits or archives anything in Notion.
 *
 * Nothing about Netlify Identity or the app's group_leader grants is touched
 * here: those were made when each steward was appointed and stay as they are.
 * Only WHERE the register row lives changes.
 *
 * SAFE BY DESIGN (same shape as contrib-migrate.js):
 *   • SUPER-ADMIN only, every method (this writes production data). The
 *     SURVEY_ADMIN_EMAILS migration bridge does NOT count here.
 *   • GET  = DRY RUN. Reads both stores and reports exactly what WOULD happen.
 *            Writes nothing.
 *   • POST = COMMIT. Refuses unless body.confirm === true AND
 *            body.expected === <the dry run's notionCount>. A stale or
 *            mistyped count cannot commit.
 *   • Idempotent: every migrated row carries notion_page_id (unique index);
 *            a Notion page already present is SKIPPED, never duplicated, and
 *            is reported under `alreadyMigrated` (with `mismatches` listing any
 *            whose Supabase copy no longer matches Notion — edits made after
 *            migration, which is expected and fine).
 *   • Sequential Notion reads (queryAll paginates one page at a time, with
 *            429 back-off) — ~3 req/s per token.
 *
 * GET  /api/steward-migrate
 * POST /api/steward-migrate  { confirm:true, expected:<notionCount> }
 *
 * Response (both): { mode, notionCount, supabaseCount, migratedCount,
 *   wouldInsert:[{notionId, name, email, status, cards:<count>, village}],
 *   alreadyMigrated:[...same shape], mismatches:[{notionId, field, notion, supabase}],
 *   conflicts:[{notionId, email, village, reason}] }
 *   plus, on commit, { insertedCount, failed:[{notionId, error}] }.
 * `conflicts` are Notion pages that CANNOT insert cleanly: no email (the column
 * is NOT NULL), or a second live row for the same email+village (the register
 * now allows one — the old Notion model allowed several and unioned their
 * cards). They are listed, skipped on commit, and left for a human decision.
 *
 * Mapping notes:
 *   • village_id = slug of the Notion "Village" text (default Smiths Lake).
 *   • status: Active / Removed as in Notion; anything else → Active.
 *   • A Notion page in the trash (archived) → archived_at = last_edited_time.
 *   • cards: normalised [{path,title}], de-duplicated by path.
 *   • date_added falls back to the page's created_time; created_at is kept.
 */

import { requireRole, getRoles } from './_auth.js';
import {
  STEWARDS_DB_ID, T_STEWARDS, STEWARD_STATUSES,
  queryAll, parseSteward, normPath, stewardRaw, jsonResp,
} from './_stewards.js';
import { supaConfigured, slugVillage } from './_supa.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cleanCards(raw) {
  const out = [];
  for (const c of (Array.isArray(raw) ? raw : []).slice(0, 100)) {
    const path = normPath(c?.path);
    if (!path || out.some((x) => x.path === path)) continue;
    out.push({ path, title: String(c?.title || path).slice(0, 200) });
  }
  return out;
}

/** Notion page → a `stewards` row (column names), plus its Notion id. */
function mapPage(page) {
  const s = parseSteward(page);
  const villageText = s.village || process.env.VILLAGE_NAME || 'Smiths Lake';
  const email = String(s.email || '').trim().toLowerCase().slice(0, 200);
  return {
    notion_page_id: page.id,
    village_id: slugVillage(villageText),
    name: String(s.name || '').trim().slice(0, 200),
    email: EMAIL_RE.test(email) ? email : null,
    cards: cleanCards(s.cards),
    status: STEWARD_STATUSES.includes(s.status) ? s.status : 'Active',
    added_by: String(s.addedBy || '').trim().slice(0, 200) || null,
    date_added: (s.dateAdded || '').slice(0, 10) || String(page.created_time || '').slice(0, 10) || undefined,
    last_updated_by: null,
    archived_at: page.archived ? (page.last_edited_time || new Date().toISOString()) : null,
    created_at: page.created_time || undefined,
  };
}

/** The safe-to-list shape — cards as a count, never the full list. */
const summarise = (r) => ({
  notionId: r.notion_page_id,
  name: r.name,
  email: r.email,
  status: r.status,
  cards: r.cards.length,
  village: r.village_id,
  ...(r.archived_at ? { archived: true } : {}),
});

const cardKey = (cards) => (cards || []).map((c) => normPath(c.path)).sort().join('|');

/** Reconcile the mapped Notion rows against what Supabase already holds. */
async function reconcile(mapped) {
  const all = await stewardRaw(`${T_STEWARDS}?select=id,notion_page_id,village_id,name,email,status,cards,archived_at`);
  const rows = Array.isArray(all) ? all : [];
  const byNotion = new Map(rows.filter((r) => r.notion_page_id).map((r) => [r.notion_page_id, r]));
  // Live rows keyed by village+email — the unique index a fresh insert must respect.
  const liveKeys = new Set(rows.filter((r) => !r.archived_at).map((r) => `${r.village_id}\n${String(r.email || '').toLowerCase()}`));

  const wouldInsert = [], alreadyMigrated = [], mismatches = [], conflicts = [];
  const pendingKeys = new Set();
  for (const r of mapped) {
    const have = byNotion.get(r.notion_page_id);
    if (have) {
      alreadyMigrated.push(summarise(r));
      for (const [field, a, b] of [
        ['name', r.name, have.name],
        ['email', r.email, have.email],
        ['status', r.status, have.status],
        ['village', r.village_id, have.village_id],
        ['cards', cardKey(r.cards), cardKey(have.cards)],
      ]) {
        if (String(a ?? '') !== String(b ?? '')) mismatches.push({ notionId: r.notion_page_id, field, notion: a, supabase: b });
      }
      continue;
    }
    if (!r.email) {
      conflicts.push({ notionId: r.notion_page_id, email: null, village: r.village_id, reason: 'No valid email on the Notion page — add one there and re-run, or leave it out.' });
      continue;
    }
    const key = `${r.village_id}\n${r.email}`;
    if (!r.archived_at && (liveKeys.has(key) || pendingKeys.has(key))) {
      conflicts.push({ notionId: r.notion_page_id, email: r.email, village: r.village_id, reason: 'A live steward row for this email already exists in this village (one per email+village) — merge the cards by hand.' });
      continue;
    }
    if (!r.archived_at) pendingKeys.add(key);
    wouldInsert.push(summarise(r));
  }
  return {
    notionCount: mapped.length,
    supabaseCount: rows.length,
    migratedCount: byNotion.size,
    wouldInsert,
    alreadyMigrated,
    mismatches,
    conflicts,
  };
}

function safeBody(event) { try { return event.body ? JSON.parse(event.body) : {}; } catch (_) { return {}; } }

export const handler = async (event, context) => {
  if (!['GET', 'POST'].includes(event.httpMethod)) return jsonResp(405, { error: 'GET or POST only' });

  // Super-admin only — the role itself, not the email allowlist bridge.
  const auth = requireRole(context, { anyOf: ['super-admin'] });
  if (!auth.ok) return jsonResp(auth.status, { error: auth.error });
  if (!getRoles(auth.user).includes('super-admin')) {
    return jsonResp(403, { error: 'Migration is restricted to the super-admin.' });
  }
  if (!supaConfigured()) return jsonResp(503, { error: 'Supabase is not configured on this site (VAPP_SUPABASE_URL / VAPP_SUPABASE_SERVICE_KEY).' });
  if (!process.env.NOTION_API_KEY) return jsonResp(503, { error: 'NOTION_API_KEY is not set — nothing to migrate from.' });
  if (!STEWARDS_DB_ID) return jsonResp(503, { error: 'NOTION_VF_STEWARDS_DB_ID is not set — nothing to migrate from.' });

  try {
    // Table present? PostgREST 404s on a missing relation.
    try { await stewardRaw(`${T_STEWARDS}?select=id&limit=1`); } catch (e) {
      if (e.status === 404) return jsonResp(412, { error: 'Apply migration 0018 (stewards) to Supabase before migrating.' });
      throw e;
    }

    // queryAll paginates sequentially and backs off on 429 — never Promise.all.
    const mapped = (await queryAll(STEWARDS_DB_ID)).map(mapPage);
    const plan = await reconcile(mapped);

    // ── DRY RUN ──────────────────────────────────────────────────────────
    if (event.httpMethod === 'GET') return jsonResp(200, { mode: 'dry-run', ...plan });

    // ── COMMIT (guarded) ─────────────────────────────────────────────────
    const body = safeBody(event);
    if (body.confirm !== true) return jsonResp(400, { error: 'Commit requires confirm:true', ...plan });
    if (body.expected !== plan.notionCount) {
      return jsonResp(409, { error: `Count mismatch — expected ${body.expected}, Notion holds ${plan.notionCount}. Re-run the dry run (GET) and pass its notionCount.`, ...plan });
    }

    const pending = new Set(plan.wouldInsert.map((w) => w.notionId));
    const failed = [];
    let insertedCount = 0;
    for (const r of mapped) {
      if (!pending.has(r.notion_page_id)) continue;   // already migrated or conflicting — skip, never duplicate
      try {
        const rows = await stewardRaw(T_STEWARDS, {
          method: 'POST',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify(r),
        });
        const row = Array.isArray(rows) ? rows[0] : rows;
        if (!row || !row.id) throw new Error('insert returned no row');
        insertedCount += 1;
      } catch (e) {
        // A unique-index clash (23505) means a concurrent commit got there first — not a loss.
        failed.push({ notionId: r.notion_page_id, error: String(e.message || e).slice(0, 200) });
      }
    }

    // Re-reconcile from Supabase only (no second Notion pass) so the caller sees the final state.
    const after = await reconcile(mapped);
    return jsonResp(200, { mode: 'commit', insertedCount, failed, ...after });
  } catch (err) {
    return jsonResp(502, { error: err.message });
  }
};

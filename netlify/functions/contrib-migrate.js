/**
 * contrib-migrate.js — one-time Notion "VF Contributions" → Supabase migration.
 *
 * Phase 3 of the PII plan: the ledger's 13 committee-entered Notion rows move
 * into the `contributions` table (migration 0015) so Supabase becomes the
 * single source of truth and the Notion rows can then be deleted BY HAND.
 * This endpoint never deletes, edits or archives anything in Notion.
 *
 * SAFE BY DESIGN:
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
 *   • Sequential Notion reads (never Promise.all) — ~3 req/s per token.
 *
 * GET  /api/contrib-migrate
 * POST /api/contrib-migrate  { confirm:true, expected:<notionCount> }
 *
 * Response (both): { mode, notionCount, supabaseCount, migratedCount,
 *   wouldInsert:[{notionId, contributor, type, amount, hours, date, village}],
 *   alreadyMigrated:[...same shape], mismatches:[{notionId, field, notion, supabase}] }
 *   plus, on commit, { insertedCount, failed:[{notionId, error}] }.
 * `contact` is deliberately never included in any list.
 *
 * Mapping notes:
 *   • Notion's "Archived" pseudo-status → status 'Received' + archived_at set
 *     (the row's last_edited_time), matching the archive-is-not-a-status model.
 *   • village_id = slug of the Notion "Village" text (default Smiths Lake).
 *   • Amount/Hours only if > 0, else null. Date falls back to created_time.
 */

import { requireRole, getRoles } from './_auth.js';
import {
  T_CONTRIB, CONTRIB_DB_ID, CONTRIB_TYPES, CONTRIB_STATUSES,
  contribRaw, supaConfigured, slugVillage, positive, clean, jsonResp,
} from './_contrib.js';

const NOTION_VERSION = '2022-06-28';

function notionHeaders() {
  return {
    Authorization: `Bearer ${process.env.NOTION_API_KEY}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  };
}

const rtText = (prop) => (prop?.rich_text || []).map((t) => t.plain_text).join('');

/** Every page in the Notion DB — sequential, paginated with start_cursor. */
async function readNotionPages() {
  const results = [];
  let cursor;
  do {
    const res = await fetch(`https://api.notion.com/v1/databases/${CONTRIB_DB_ID}/query`, {
      method: 'POST',
      headers: notionHeaders(),
      body: JSON.stringify({ page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) }),
    });
    if (!res.ok) throw new Error(`Notion responded ${res.status}`);
    const data = await res.json();
    results.push(...(data.results || []));
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return results;
}

/** Notion page → a `contributions` row (column names), plus its Notion id. */
function mapPage(page) {
  const p = page.properties || {};
  const notionStatus = p.Status?.select?.name || '';
  const type = p.Type?.select?.name || '';
  const villageText = rtText(p.Village) || process.env.VILLAGE_NAME || 'Smiths Lake';
  const archived = notionStatus === 'Archived';
  return {
    notion_page_id: page.id,
    village_id: slugVillage(villageText),
    contributor: (p.Contributor?.title?.[0]?.plain_text || '').trim().slice(0, 200) || '(no name)',
    type: CONTRIB_TYPES.includes(type) ? type : 'Money',
    status: CONTRIB_STATUSES.includes(notionStatus) ? notionStatus : 'Received',
    amount: positive(p.Amount?.number),
    hours: positive(p.Hours?.number),
    note: clean(rtText(p.Note), 2000),
    contact: clean(rtText(p.Contact), 200),
    date: p.Date?.date?.start?.slice(0, 10) || String(page.created_time || '').slice(0, 10) || null,
    show_publicly: p['Show Publicly']?.checkbox === true,
    display_name: clean(rtText(p['Display Name']), 60),
    logged_by: clean(rtText(p['Logged by']), 200),
    archived_at: archived ? (page.last_edited_time || new Date().toISOString()) : null,
    created_at: page.created_time || undefined,
  };
}

/** The safe-to-list shape — never includes contact or note. */
const summarise = (r) => ({
  notionId: r.notion_page_id,
  contributor: r.contributor,
  type: r.type,
  status: r.status,
  amount: r.amount,
  hours: r.hours,
  date: r.date,
  village: r.village_id,
  ...(r.archived_at ? { archived: true } : {}),
});

const numEq = (a, b) => (a == null && b == null) || Number(a) === Number(b);

/** Reconcile the mapped Notion rows against what Supabase already holds. */
async function reconcile(mapped) {
  const all = await contribRaw(`${T_CONTRIB}?select=id,notion_page_id,contributor,type,status,amount,hours,date,village_id`);
  const rows = Array.isArray(all) ? all : [];
  const byNotion = new Map(rows.filter((r) => r.notion_page_id).map((r) => [r.notion_page_id, r]));

  const wouldInsert = [], alreadyMigrated = [], mismatches = [];
  for (const r of mapped) {
    const have = byNotion.get(r.notion_page_id);
    if (!have) { wouldInsert.push(summarise(r)); continue; }
    alreadyMigrated.push(summarise(r));
    for (const [field, a, b] of [
      ['contributor', r.contributor, have.contributor],
      ['type', r.type, have.type],
      ['status', r.status, have.status],
      ['date', r.date, have.date],
      ['village', r.village_id, have.village_id],
    ]) {
      if (String(a ?? '') !== String(b ?? '')) mismatches.push({ notionId: r.notion_page_id, field, notion: a, supabase: b });
    }
    if (!numEq(r.amount, have.amount)) mismatches.push({ notionId: r.notion_page_id, field: 'amount', notion: r.amount, supabase: have.amount });
    if (!numEq(r.hours, have.hours)) mismatches.push({ notionId: r.notion_page_id, field: 'hours', notion: r.hours, supabase: have.hours });
  }
  return {
    notionCount: mapped.length,
    supabaseCount: rows.length,
    migratedCount: byNotion.size,
    wouldInsert,
    alreadyMigrated,
    mismatches,
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

  try {
    // Table present? PostgREST 404s on a missing relation.
    try { await contribRaw(`${T_CONTRIB}?select=id&limit=1`); } catch (e) {
      if (e.status === 404) return jsonResp(412, { error: 'Apply migration 0015 (contributions) to Supabase before migrating.' });
      throw e;
    }

    const mapped = (await readNotionPages()).map(mapPage);
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
      if (!pending.has(r.notion_page_id)) continue;   // already migrated — skip, never duplicate
      try {
        const rows = await contribRaw(T_CONTRIB, {
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

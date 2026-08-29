/**
 * _villages.js — shared helper to read a village's lifecycle status.
 * Fail-open to 'live' so Notion hiccups never block surveys.
 */
import { villageKey, getRoles } from './_auth.js';

const NOTION_VERSION = '2022-06-28';
const VILLAGES_DB_ID = process.env.NOTION_VF_VILLAGES_DB_ID || '2c6272ccd9174103a077087c5de250d0';

export async function getVillageStatus(village) {
  if (!village) return 'live';
  try {
    const res = await fetch(`https://api.notion.com/v1/databases/${VILLAGES_DB_ID}/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.NOTION_API_KEY}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' },
      body: JSON.stringify({ filter: { property: 'Village Name', title: { equals: village } }, page_size: 1 }),
    });
    if (!res.ok) return 'live';
    const p = ((await res.json()).results || [])[0];
    return p ? (p.properties['Status']?.select?.name || 'live') : 'live';
  } catch (_) { return 'live'; }
}

/**
 * getVillageRecord(village) — full registry row for a village.
 * Returns { status, contentDbId, newsBuildHook } with safe fallbacks so
 * Smiths Lake keeps working even if the registry is unreadable.
 */
export async function getVillageRecord(village) {
  const fallback = {
    status: 'live',
    contentDbId: process.env.NOTION_CONTENT_DB_ID || '2cad508adfc1809d8438c8f3a5dd8d42',
    newsBuildHook: process.env.NEWS_BUILD_HOOK_URL || null,
  };
  if (!village || village === (process.env.VILLAGE_NAME || 'Smiths Lake')) {
    // Try the registry but never fail the default village
    try {
      const rec = await queryVillage(village || process.env.VILLAGE_NAME || 'Smiths Lake');
      if (rec) return { ...fallback, ...rec, contentDbId: rec.contentDbId || fallback.contentDbId, newsBuildHook: rec.newsBuildHook || fallback.newsBuildHook };
    } catch (_) {}
    return fallback;
  }
  try {
    const rec = await queryVillage(village);
    if (rec) return { status: rec.status || 'live', contentDbId: rec.contentDbId || null, newsBuildHook: rec.newsBuildHook || null };
  } catch (_) {}
  return { status: 'live', contentDbId: null, newsBuildHook: null };
}

async function queryVillage(village) {
  const res = await fetch(`https://api.notion.com/v1/databases/${VILLAGES_DB_ID}/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.NOTION_API_KEY}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' },
    body: JSON.stringify({ filter: { property: 'Village Name', title: { equals: village } }, page_size: 1 }),
  });
  if (!res.ok) return null;
  const p = ((await res.json()).results || [])[0];
  if (!p) return null;
  return {
    status: p.properties['Status']?.select?.name || 'live',
    contentDbId: (p.properties['Content DB ID']?.rich_text || []).map(t => t.plain_text).join('').replace(/[^a-f0-9]/gi, '') || null,
    newsBuildHook: p.properties['News Build Hook']?.url || null,
    publicModules: (p.properties['Public Modules']?.multi_select || []).map(o => o.name),
    notifyEmails: parseEmails((p.properties['Notify Emails']?.rich_text || []).map(t => t.plain_text).join('')),
    moduleAccess: safeJson((p.properties['Module Access']?.rich_text || []).map(t => t.plain_text).join('')),
  };
}

/** Split a comma/newline/semicolon-separated address blob into clean addresses. */
function parseEmails(blob) {
  return String(blob || '').split(/[,\n;]+/).map((s) => s.trim()).filter(Boolean);
}

function safeJson(s) {
  try { return s ? JSON.parse(s) : null; } catch (_) { return null; }
}

/**
 * getNotifyRecipients(village) — WHO gets a village's admin notifications
 * (new members, pledges, bookings, events, and unstewarded volunteer signups).
 *
 * Per-village by design so one village's committee never sees another's data:
 * returns the village's own "Notify Emails" from the VF Villages registry, and
 * ONLY falls back to the global VF_PLEDGE_NOTIFY_TO (platform operators) when a
 * village has no list of its own. Fail-open to the env list on any Notion error.
 */
export async function getNotifyRecipients(village) {
  const envList = parseEmails(process.env.VF_PLEDGE_NOTIFY_TO);
  try {
    const rec = await queryVillage(village || 'Smiths Lake');
    if (rec && Array.isArray(rec.notifyEmails) && rec.notifyEmails.length) return rec.notifyEmails;
  } catch (_) { /* fall back to platform operators */ }
  return envList;
}

/* ── Role-derived notification recipients ─────────────────────────────────
 * Who gets a module's notification is the SAME question as who may see that
 * module's tile in the console: the super-admin's role×module matrix decides.
 * So recipients = the village's Netlify Identity users whose role level is
 * granted visibility to the notification's module (plus super-admins, for
 * oversight). This keeps one source of truth — nobody is emailed about a
 * module the matrix hides from their role. Falls back to getNotifyRecipients
 * (village list → platform operators) whenever the roster/matrix can't be
 * resolved or yields nobody, so a village always has a safety net.            */

const MATRIX_ROLES = ['admin', 'treasurer', 'pm', 'steward', 'viewer'];

// Default role visibility per module — mirrors public/admin/index.html tool.roles.
// Used only when a village has no matrix override for that role.
const DEFAULT_MODULE_ROLES = {
  surveys: ['admin', 'steward', 'viewer'],
  news: ['admin', 'steward'],
  publish: ['admin', 'steward'],
  playbook: ['admin', 'steward', 'viewer'],
  contrib: ['admin', 'treasurer'],
  cocon: ['admin', 'treasurer'],
  grants: ['admin', 'treasurer'],
  projects: ['admin', 'treasurer', 'pm'],
  profile: ['admin', 'steward'],
  services: ['admin', 'steward'],
  members: ['admin'],
  events: ['admin'],
  ads: ['admin'],
  volunteers: ['admin', 'steward'],
  bookings: ['admin'],
};

// Which role levels may see `module` in this village (per-role matrix override,
// else the module default) — mirrors admin console roleCanSee().
function rolesForModule(moduleAccess, module) {
  return MATRIX_ROLES.filter((role) =>
    (moduleAccess && Array.isArray(moduleAccess[role]))
      ? moduleAccess[role].includes(module)
      : (DEFAULT_MODULE_ROLES[module] || []).includes(role));
}

async function listIdentityUsers(identity) {
  const out = [];
  for (let page = 1; page <= 20; page++) {
    const res = await fetch(`${identity.url}/admin/users?per_page=100&page=${page}`, {
      headers: { Authorization: `Bearer ${identity.token}` },
    });
    if (!res.ok) break;
    const data = await res.json();
    const batch = (data && data.users) || [];
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out;
}

/**
 * getModuleRecipients({ village, module, context }) — emails of the village's
 * Identity users whose role may see `module` per the matrix, plus super-admins.
 * `context` must be the function's 2nd handler arg (carries the Identity admin
 * token). Falls back to getNotifyRecipients(village) on any gap.
 */
export async function getModuleRecipients({ village, module, context }) {
  const identity = context && context.clientContext && context.clientContext.identity;
  if (identity && identity.url && identity.token) {
    try {
      const rec = await queryVillage(village || 'Smiths Lake');
      const allowed = new Set(rolesForModule(rec && rec.moduleAccess, module));
      const vKey = villageKey(village || 'Smiths Lake');
      const users = await listIdentityUsers(identity);
      const seen = new Set();
      const emails = [];
      for (const u of users) {
        if (!u || !u.email) continue;
        const roles = getRoles(u);
        let include = roles.includes('super-admin'); // platform oversight
        if (!include) {
          for (const role of roles) {
            const idx = role.lastIndexOf(':');
            if (idx !== -1 && role.slice(0, idx) === vKey && allowed.has(role.slice(idx + 1))) { include = true; break; }
          }
        }
        if (include) {
          const key = u.email.toLowerCase();
          if (!seen.has(key)) { seen.add(key); emails.push(u.email); }
        }
      }
      if (emails.length) return emails;
    } catch (_) { /* fall through to the static fallback */ }
  }
  return getNotifyRecipients(village);
}

/**
 * Modules whose PUBLIC surfaces are gated by the registry's "Public Modules"
 * multi-select — a village must explicitly switch these on (fail-CLOSED, the
 * opposite of everything else here) via the admin-hub toggle. Modules not in
 * this list are always public once shipped.
 */
const PUBLICLY_GATED = ['events', 'bookings'];

export async function isModulePublic(village, module) {
  if (!PUBLICLY_GATED.includes(module)) return true;
  try {
    const rec = await queryVillage(village || process.env.VILLAGE_NAME || 'Smiths Lake');
    return !!rec && Array.isArray(rec.publicModules) && rec.publicModules.includes(module);
  } catch (_) { return false; } // gated modules fail closed
}

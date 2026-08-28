/**
 * village-modules.js — POST /api/village-modules   (village admin / super-admin)
 *
 * Two per-village module switches on the VF Villages registry row:
 *
 * 1. Public page toggle (village admin) — body: { village?, module, public: bool }
 *    Flips the module in "Public Modules" (multi-select). Only gated modules
 *    (events, bookings). OFF = the module's public pages show a friendly
 *    "not switched on yet" notice and its public APIs refuse writes; the admin
 *    console keeps working either way.
 *
 * 2. Module on/off toggle (super-admin) — body: { village?, module, enabled: bool }
 *    Flips the module in "Disabled Modules" (multi-select; created on first
 *    use). A disabled module's tile is hidden from that village's admins in
 *    the Village Admin portal. Fail-open: absent property = all modules on.
 *
 * 3. Module-access matrix (super-admin) — body: { village?, access: { admin: [ids], treasurer: [ids], steward: [ids], viewer: [ids] } }
 *    Which role levels SEE which module tiles in the Village Admin portal
 *    ("Module Access" rich_text JSON; created on first use). Visibility only —
 *    every endpoint keeps its own requireRole floor regardless of the matrix.
 *    Absent = the portal's built-in defaults.
 *
 * 4. Package level (super-admin) — body: { village?, package: 'foundation'|'interactive'|'complete' }
 *    Sets the village's Village1st package ("Package" select; created on
 *    first use). The package is the baseline for which modules a village
 *    gets (see village1st.com.au). Absent = 'complete' (fail-open — matches
 *    pre-package behaviour for existing villages).
 */

import { requireRole } from './_auth.js';

const NOTION_VERSION = '2022-06-28';
const VILLAGES_DB_ID = process.env.NOTION_VF_VILLAGES_DB_ID || '2c6272ccd9174103a077087c5de250d0';
const TOGGLABLE = ['events', 'bookings'];
// Modules a super-admin can switch on/off per village (portal tile ids).
const MODULES = ['surveys', 'news', 'contrib', 'cocon', 'grants', 'projects', 'profile', 'services', 'members', 'events', 'ads', 'volunteers', 'bookings'];
// Village1st service levels (village1st.com.au): Foundation | Interactive | Complete.
const PACKAGES = ['foundation', 'interactive', 'complete'];
// Role levels the access matrix can configure (visibility only). 'pm' = Project Manager.
const MATRIX_ROLES = ['admin', 'treasurer', 'pm', 'steward', 'viewer'];
// Tiles the matrix may reference: the toggleable modules plus the two utilities.
const MATRIX_MODULES = [...MODULES, 'publish', 'playbook'];

function nh() {
  return { Authorization: `Bearer ${process.env.NOTION_API_KEY}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' };
}

function resp(statusCode, obj) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}

async function getVillageRow(village) {
  const q = await fetch(`https://api.notion.com/v1/databases/${VILLAGES_DB_ID}/query`, {
    method: 'POST', headers: nh(),
    body: JSON.stringify({ filter: { property: 'Village Name', title: { equals: village } }, page_size: 1 }),
  });
  if (!q.ok) throw new Error(`Notion responded ${q.status}`);
  return ((await q.json()).results || [])[0] || null;
}

async function setMultiSelect(pageId, property, names) {
  return fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: 'PATCH', headers: nh(),
    body: JSON.stringify({ properties: { [property]: { multi_select: names.map((m) => ({ name: m })) } } }),
  });
}

export const handler = async (event, context) => {
  if (event.httpMethod !== 'POST') return resp(405, { error: 'POST only' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch {
    return resp(400, { error: 'Invalid JSON' });
  }

  const village = body.village || process.env.VILLAGE_NAME || 'Smiths Lake';
  const module = String(body.module || '');
  const isEnabledToggle = 'enabled' in body;
  const isPackageSet = 'package' in body;
  const isAccessSet = 'access' in body;

  // Module on/off + package + access matrix are platform decisions → super-admin. Public page → village admin.
  const auth = (isEnabledToggle || isPackageSet || isAccessSet)
    ? requireRole(context, { anyOf: ['super-admin'] })
    : requireRole(context, { village, anyOf: ['admin'] });
  if (!auth.ok) return resp(auth.status, { error: auth.error });

  try {
    // ── Module-access matrix (super-admin) ──────────────────────────
    if (isAccessSet) {
      const access = body.access;
      if (!access || typeof access !== 'object' || Array.isArray(access)) return resp(400, { error: 'access must be an object of role → module ids' });
      const clean = {};
      for (const role of MATRIX_ROLES) {
        const ids = access[role];
        if (ids === undefined) continue;
        if (!Array.isArray(ids)) return resp(400, { error: `access.${role} must be an array` });
        clean[role] = [...new Set(ids.filter((m) => MATRIX_MODULES.includes(m)))];
      }
      const row = await getVillageRow(village);
      if (!row) return resp(404, { error: `${village} is not in the Villages registry` });

      const json = JSON.stringify(clean);
      const setAccess = () => fetch(`https://api.notion.com/v1/pages/${row.id}`, {
        method: 'PATCH', headers: nh(),
        body: JSON.stringify({ properties: { 'Module Access': { rich_text: [{ text: { content: json.slice(0, 1900) } }] } } }),
      });
      let u = await setAccess();
      if (!u.ok && u.status === 400) {
        // Property doesn't exist yet — add it to the registry schema and retry once.
        const s = await fetch(`https://api.notion.com/v1/databases/${VILLAGES_DB_ID}`, {
          method: 'PATCH', headers: nh(),
          body: JSON.stringify({ properties: { 'Module Access': { rich_text: {} } } }),
        });
        if (!s.ok) throw new Error(`Notion schema update responded ${s.status}`);
        u = await setAccess();
      }
      if (!u.ok) throw new Error(`Notion responded ${u.status}`);
      return resp(200, { ok: true, moduleAccess: clean });
    }

    // ── Package level (super-admin) ─────────────────────────────────
    if (isPackageSet) {
      const pkg = String(body.package || '').toLowerCase();
      if (!PACKAGES.includes(pkg)) return resp(400, { error: 'Unknown package' });
      const label = pkg.charAt(0).toUpperCase() + pkg.slice(1);   // Foundation / Interactive / Complete

      const row = await getVillageRow(village);
      if (!row) return resp(404, { error: `${village} is not in the Villages registry` });

      const setPackage = () => fetch(`https://api.notion.com/v1/pages/${row.id}`, {
        method: 'PATCH', headers: nh(),
        body: JSON.stringify({ properties: { 'Package': { select: { name: label } } } }),
      });
      let u = await setPackage();
      if (!u.ok && u.status === 400) {
        // Property doesn't exist yet — add it to the registry schema and retry once.
        const s = await fetch(`https://api.notion.com/v1/databases/${VILLAGES_DB_ID}`, {
          method: 'PATCH', headers: nh(),
          body: JSON.stringify({ properties: { 'Package': { select: { options: PACKAGES.map((p) => ({ name: p.charAt(0).toUpperCase() + p.slice(1) })) } } } }),
        });
        if (!s.ok) throw new Error(`Notion schema update responded ${s.status}`);
        u = await setPackage();
      }
      if (!u.ok) throw new Error(`Notion responded ${u.status}`);
      return resp(200, { ok: true, package: pkg });
    }

    // ── Module ON/OFF (super-admin) ─────────────────────────────────
    if (isEnabledToggle) {
      if (!MODULES.includes(module)) return resp(400, { error: 'Unknown module' });
      const enable = body.enabled === true || body.enabled === 'true';

      const row = await getVillageRow(village);
      if (!row) return resp(404, { error: `${village} is not in the Villages registry` });

      const current = (row.properties['Disabled Modules']?.multi_select || []).map((o) => o.name);
      const next = enable
        ? current.filter((m) => m !== module)
        : [...new Set([...current, module])];

      let u = await setMultiSelect(row.id, 'Disabled Modules', next);
      if (!u.ok && u.status === 400) {
        // Property doesn't exist yet — add it to the registry schema and retry once.
        const s = await fetch(`https://api.notion.com/v1/databases/${VILLAGES_DB_ID}`, {
          method: 'PATCH', headers: nh(),
          body: JSON.stringify({ properties: { 'Disabled Modules': { multi_select: {} } } }),
        });
        if (!s.ok) throw new Error(`Notion schema update responded ${s.status}`);
        u = await setMultiSelect(row.id, 'Disabled Modules', next);
      }
      if (!u.ok) throw new Error(`Notion responded ${u.status}`);
      return resp(200, { ok: true, disabledModules: next });
    }

    // ── Public page ON/OFF (village admin) — unchanged behaviour ────
    if (!TOGGLABLE.includes(module)) return resp(400, { error: 'That module has no public toggle' });
    const makePublic = body.public === true || body.public === 'true';

    const row = await getVillageRow(village);
    if (!row) return resp(404, { error: `${village} is not in the Villages registry` });

    const current = (row.properties['Public Modules']?.multi_select || []).map((o) => o.name);
    const next = makePublic
      ? [...new Set([...current, module])]
      : current.filter((m) => m !== module);

    const u = await setMultiSelect(row.id, 'Public Modules', next);
    if (!u.ok) throw new Error(`Notion responded ${u.status}`);
    return resp(200, { ok: true, publicModules: next });
  } catch (err) {
    return resp(502, { error: err.message });
  }
};

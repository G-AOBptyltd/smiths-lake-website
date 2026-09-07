/**
 * _auth.js — shared auth helper for VillageFirst survey functions.
 *
 * Files prefixed with "_" are NOT deployed as standalone endpoints by Netlify,
 * but can be imported by the other functions.
 *
 * Identity model (Netlify Identity):
 *   - Netlify injects the signed-in user into `context.clientContext.user`
 *     ONLY when a valid Identity JWT is sent as `Authorization: Bearer <token>`.
 *   - Roles live on `user.app_metadata.roles`.
 *
 * Role naming:
 *   - "super-admin"            → full access, all villages
 *   - "<village>:admin"        → Village Admin    (e.g. "smithslake:admin")
 *   - "<village>:treasurer"    → Village Treasurer (finance modules)
 *   - "<village>:pm"           → Village Project Manager (manages projects; money read-only)
 *   - "<village>:steward"      → Survey / group Steward
 *   - "<village>:emergency"    → Emergency Coordinator (emergency & safety module)
 *   - "<village>:viewer"       → Committee Viewer
 *
 * Role matching below is generic — any "<village>:<name>" role works; the names
 * above are the ones the admin console assigns and gates on.
 *
 * Migration bridge: a user whose VERIFIED email (from the JWT, not a header)
 * is listed in SURVEY_ADMIN_EMAILS is treated as an admin until roles are
 * assigned in Phase 2. This is safe because the email comes from the token.
 */

export function getIdentityUser(context) {
  return context?.clientContext?.user || null;
}

export function getRoles(user) {
  const roles = user?.app_metadata?.roles;
  return Array.isArray(roles) ? roles : [];
}

export function villageKey(village) {
  return String(village || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function emailAllowlisted(user) {
  const email = (user?.email || '').toLowerCase();
  if (!email) return false;
  const allowed = (process.env.SURVEY_ADMIN_EMAILS || '')
    .split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  return allowed.includes(email);
}

/**
 * Does the user hold one of `anyOf` roles? Super-admin always passes.
 * A role matches if the user has it exactly, OR has it village-scoped
 * ("<village>:<role>"). If `village` is given, the scope must match that
 * village; otherwise any village-scoped match counts.
 */
export function hasRole(user, { village, anyOf } = {}) {
  if (!user) return false;
  const roles = getRoles(user);
  if (roles.includes('super-admin')) return true;
  if (emailAllowlisted(user)) return true;            // migration bridge
  if (!anyOf || !anyOf.length) return roles.length > 0;
  const vKey = village ? villageKey(village) : null;
  return anyOf.some(r =>
    roles.includes(r) ||
    roles.some(role => {
      const idx = role.lastIndexOf(':');
      if (idx === -1) return false;
      const scope = role.slice(0, idx);
      const name = role.slice(idx + 1);
      if (name !== r) return false;
      return vKey ? scope === vKey : true;
    })
  );
}

/**
 * Guard for a handler. Returns { ok, user } or { ok:false, status, error }.
 * Usage:
 *   const auth = requireRole(context, { anyOf: ['admin'] });
 *   if (!auth.ok) return { statusCode: auth.status, headers: corsHeaders(), body: JSON.stringify({ error: auth.error }) };
 */
export function requireRole(context, opts = {}) {
  const user = getIdentityUser(context);
  if (!user) return { ok: false, status: 401, error: 'Sign in required' };
  if (!hasRole(user, opts)) return { ok: false, status: 403, error: 'Insufficient permissions' };
  return { ok: true, user };
}

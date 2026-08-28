/**
 * identity-admin.js — manage VillageFirst Survey admins from inside the dashboard.
 *
 * Uses the Netlify Identity admin API exposed to functions via
 * context.clientContext.identity ({ url, token }) — an admin-scoped token.
 *
 * GET  /api/identity-admin                      → { users: [{id,email,roles}] }   (admin)
 * POST /api/identity-admin {action:'invite', email, role}    → invite a user      (super-admin)
 * POST /api/identity-admin {action:'setrole', userId, role}  → set a user's role  (super-admin)
 * POST /api/identity-admin {action:'reinvite', email, userId?, role?} → resend a pending invite (super-admin)
 * POST /api/identity-admin {action:'revoke', userId}         → clear roles, keep account (super-admin)
 * POST /api/identity-admin {action:'delete', userId}         → hard-delete (cancel a pending invite) (super-admin)
 *
 * Roles: 'super-admin' | '<village>:admin' | '<village>:steward' | '<village>:viewer' | '' (none)
 */

import { requireRole } from './_auth.js';

export const handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors() };

  const identity = context?.clientContext?.identity;
  if (!identity || !identity.url || !identity.token) {
    return { statusCode: 503, headers: cors(), body: JSON.stringify({ error: 'Identity admin API not available in this context.' }) };
  }
  const adminHeaders = { Authorization: `Bearer ${identity.token}`, 'Content-Type': 'application/json' };

  // ── LIST (any admin) ──
  if (event.httpMethod === 'GET') {
    const auth = requireRole(context, { anyOf: ['admin'] });
    if (!auth.ok) return resp(auth.status, { error: auth.error });
    try {
      const res = await fetch(`${identity.url}/admin/users`, { headers: adminHeaders });
      if (!res.ok) return resp(502, { error: 'Failed to list users' });
      const data = await res.json();
      const users = (data.users || []).map(u => ({
        id: u.id,
        email: u.email,
        roles: u.app_metadata?.roles || [],
        confirmed: !!u.confirmed_at,
      }));
      return resp(200, { users });
    } catch (e) { console.error(e); return resp(500, { error: 'Internal error' }); }
  }

  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  // ── INVITE / SETROLE (super-admin only) ──
  const auth = requireRole(context, { anyOf: ['super-admin'] });
  if (!auth.ok) return resp(auth.status, { error: auth.error });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_) { return resp(400, { error: 'Invalid JSON' }); }
  const { action } = body;

  try {
    if (action === 'invite') {
      const email = (body.email || '').trim();
      const role = (body.role || '').trim();
      if (!email) return resp(400, { error: 'Missing email' });
      const res = await fetch(`${identity.url}/invite`, {
        method: 'POST', headers: adminHeaders, body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const t = await res.text();
        console.error('invite error:', t);
        return resp(502, { error: 'Invite failed. The user may already exist, or invites must be enabled in Netlify Identity.' });
      }
      // Pre-assign the chosen role so the user has access as soon as they accept.
      if (role) {
        try {
          const lr = await fetch(`${identity.url}/admin/users`, { headers: adminHeaders });
          if (lr.ok) {
            const u = ((await lr.json()).users || []).find(x => (x.email || '').toLowerCase() === email.toLowerCase());
            if (u) await fetch(`${identity.url}/admin/users/${u.id}`, { method: 'PUT', headers: adminHeaders, body: JSON.stringify({ app_metadata: { roles: [role] } }) });
          }
        } catch (e) { console.error('invite role assign failed (non-fatal):', e); }
      }
      return resp(200, { success: true, message: `Invitation sent to ${email}${role ? ' (' + role + ')' : ''}` });
    }

    // Resend an invitation. GoTrue won't re-invite an email that already exists,
    // so for a still-pending account we remove the stale invite first (safe — it
    // was never accepted, so there's no session to orphan), then invite afresh
    // and re-apply the role. Fresh link, same as a first-time invite.
    if (action === 'reinvite') {
      const email = (body.email || '').trim();
      const role = (body.role || '').trim();
      const { userId } = body;
      if (!email) return resp(400, { error: 'Missing email' });
      if (userId) {
        await fetch(`${identity.url}/admin/users/${userId}`, { method: 'DELETE', headers: adminHeaders }).catch(() => {});
      }
      const res = await fetch(`${identity.url}/invite`, {
        method: 'POST', headers: adminHeaders, body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const t = await res.text();
        console.error('reinvite error:', t);
        return resp(502, { error: 'Could not resend the invite. Check invites are enabled in Netlify Identity.' });
      }
      if (role) {
        try {
          const lr = await fetch(`${identity.url}/admin/users`, { headers: adminHeaders });
          if (lr.ok) {
            const u = ((await lr.json()).users || []).find(x => (x.email || '').toLowerCase() === email.toLowerCase());
            if (u) await fetch(`${identity.url}/admin/users/${u.id}`, { method: 'PUT', headers: adminHeaders, body: JSON.stringify({ app_metadata: { roles: [role] } }) });
          }
        } catch (e) { console.error('reinvite role assign failed (non-fatal):', e); }
      }
      return resp(200, { success: true, message: `Invitation resent to ${email}` });
    }

    if (action === 'setrole') {
      const { userId } = body;
      const role = (body.role || '').trim();
      if (!userId) return resp(400, { error: 'Missing userId' });
      const roles = role ? [role] : [];
      const res = await fetch(`${identity.url}/admin/users/${userId}`, {
        method: 'PUT', headers: adminHeaders, body: JSON.stringify({ app_metadata: { roles } }),
      });
      if (!res.ok) {
        const t = await res.text();
        console.error('setrole error:', t);
        return resp(502, { error: 'Could not update role' });
      }
      return resp(200, { success: true, roles });
    }

    // Soft remove: strip all roles but KEEP the account. This revokes access
    // without destroying the login — so a signed-in user's browser session is
    // never orphaned (a hard delete leaves their stored token pointing at a
    // deleted user id, which GoTrue answers with {code:404,"user not found"}).
    // Prefer this over 'delete' for anyone who has ever signed in.
    if (action === 'revoke') {
      const { userId } = body;
      if (!userId) return resp(400, { error: 'Missing userId' });
      const res = await fetch(`${identity.url}/admin/users/${userId}`, {
        method: 'PUT', headers: adminHeaders, body: JSON.stringify({ app_metadata: { roles: [] } }),
      });
      if (!res.ok) { const t = await res.text(); console.error('revoke error:', t); return resp(502, { error: 'Could not remove access' }); }
      return resp(200, { success: true, roles: [] });
    }

    // Hard delete: only safe for pending invites (no accepted account, so no
    // browser session to orphan). Used to cancel an invitation outright.
    if (action === 'delete') {
      const { userId } = body;
      if (!userId) return resp(400, { error: 'Missing userId' });
      const res = await fetch(`${identity.url}/admin/users/${userId}`, { method: 'DELETE', headers: adminHeaders });
      if (!res.ok) { const t = await res.text(); console.error('delete user error:', t); return resp(502, { error: 'Could not remove user' }); }
      return resp(200, { success: true });
    }

    return resp(400, { error: 'Unknown action' });
  } catch (e) { console.error(e); return resp(500, { error: 'Internal error' }); }
};

function resp(statusCode, obj) { return { statusCode, headers: cors(), body: JSON.stringify(obj) }; }
function cors() {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

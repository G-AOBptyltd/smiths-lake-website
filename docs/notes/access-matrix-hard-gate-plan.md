# Access Matrix Hard-Gate Plan

**Date:** 2026-08-31  
**Status:** DRAFT — plan only, no code changed  
**Branch:** `feature/matrix-hard-gate-plan`

---

## Background

The `Module Access` JSON property on each VF Villages registry row (Notion DB
`2c6272ccd9174103a077087c5de250d0`) encodes a role×module visibility matrix,
shape `{ role: [moduleId, …] }`. As of Aug 2026 this matrix controls:

- Which console tiles a role sees in the Village Admin portal (`/admin/`)
- Which roles receive email notifications for a module
  (`getModuleRecipients` in `_villages.js`)

It does **not** control server-side data access. Every data endpoint enforces
access via `requireRole` / `resolveScope` in `_auth.js` / `_stewards.js`
using hard-coded role lists. The comment in `village-modules.js` states:

> "Visibility only — every endpoint keeps its own requireRole floor
>  regardless of the matrix."

This plan proposes making the matrix a **hard server-side gate** so that
removing a module from a role in the console also blocks that role's data
access — without removing existing `requireRole` floors.

---

## 1. Proposed Helper: `requireModuleAccess`

### Placement

Add to `netlify/functions/_auth.js` (already imported by every function that
uses `requireRole`). A thin wrapper that combines the existing role check with
a matrix lookup.

### Signature

```js
/**
 * requireModuleAccess(context, village, module)
 *
 * Combines requireRole with a matrix gate.
 * Returns { ok:true, user } or { ok:false, status, error }.
 *
 * Call AFTER knowing the village is determined. Pass the resolved village name
 * (not the raw query param) so the matrix lookup is deterministic.
 */
export async function requireModuleAccess(context, village, module) { … }
```

### Logic

```
1. const auth = requireRole(context, { village, anyOf: rolesAllowedByDefaultFloor(module) })
   → returns 401/403 immediately if not authed at all or role is below the floor.

2. super-admin → PASS (requireRole already handles this)

3. emailAllowlisted(user) → PASS (migration bridge — same as requireRole)

4. Load village matrix via queryVillage(village) → rec.moduleAccess
   → On Notion error OR null matrix → PASS (fail-open; see §1.3)

5. allowed = rolesForModule(rec.moduleAccess, module)
   → rolesForModule is already in _villages.js; import/re-export it

6. Does the user hold a role in allowed for this village? → PASS/FAIL 403
```

`requireRole` in step 1 keeps the **existing floor**: e.g. `member-list` will
always stay at minimum `['admin']`. The matrix in step 5 can only **restrict
further**, never grant access beyond the floor.

### Fail-open rule on Notion errors (§1.3)

**Recommendation: fail-open.** If the Notion call to read the matrix fails
(network timeout, API error, village row missing), the helper returns
`{ ok:true, user }` as if the matrix were absent — the existing `requireRole`
floor is still enforced. Rationale:

- Admins must not be locked out of their own tools because of a Notion
  connectivity blip.
- The matrix is a **restriction** layer, not a grant layer. Fail-open here
  means the worst-case error is briefly over-permissive for restricted roles,
  not a total lockout for admins.
- This mirrors the existing platform-wide fail-open convention
  (`getVillageStatus` returns `'live'`, `getNotifyRecipients` falls back to
  the env list, `isModulePublic` has no matrix dependency).

Log the Notion error to `console.error` so it appears in Netlify function logs.

### Backward-compat: villages with no matrix (§1.4)

`queryVillage` returns `moduleAccess: null` when the `Module Access` property
is absent or empty. The helper treats `null` as "default matrix applies"
(`DEFAULT_MODULE_ROLES` in `_villages.js`). This means:

- Existing villages with no matrix set → behaviour unchanged (same defaults
  the console already shows).
- A village that sets an empty object `{}` explicitly → all roles use their
  module defaults (also unchanged).

---

## 2. Endpoint Inventory and Module Mapping

Only **admin-side data endpoints** are candidates. Public endpoints (no auth)
and platform-level endpoints (super-admin only) are excluded.

### Module: `members`

| Function | Current floor | Add matrix gate? |
|---|---|---|
| `member-list.js` | `admin` | Yes |
| `member-update.js` | `admin` | Yes |
| `member-email.js` | `admin` | Yes |
| `member-join.js` | PUBLIC | No |

### Module: `events`

| Function | Current floor | Add matrix gate? |
|---|---|---|
| `event-admin.js` | `admin` | Yes |
| `event-list.js` | PUBLIC | No |
| `event-rsvp.js` | PUBLIC | No |

### Module: `bookings`

| Function | Current floor | Add matrix gate? |
|---|---|---|
| `booking-admin.js` | `admin` | Yes |
| `booking-email.js` | `admin` | Yes |
| `facility-admin.js` | `admin` | Yes |
| `booking-availability.js` | PUBLIC | No |
| `booking-request.js` | PUBLIC | No |
| `booking-provision.js` | super-admin | No (platform op) |

### Module: `volunteers`

| Function | Current floor | Add matrix gate? |
|---|---|---|
| `volunteer-roster.js` | `admin`, `steward` | Yes |
| `volunteer-activity.js` | `admin`, `steward` | Yes |
| `steward-admin.js` | `admin` | Yes |
| `volunteer-signup.js` | PUBLIC | No |
| `volunteer-provision.js` | super-admin | No (platform op) |

### Module: `services`

| Function | Current floor | Add matrix gate? |
|---|---|---|
| `service-list.js` | `admin`, `steward` | Yes |
| `service-update.js` | `admin`, `steward` | Yes |

### Module: `news` / `publish`

| Function | Current floor | Add matrix gate? |
|---|---|---|
| `news-list.js` | `admin`, `steward` | Yes (`news`) |
| `news-save.js` | `admin`, `steward` | Yes (`news`) |
| `news-toggle.js` | `admin`, `steward` | Yes (`news`) |
| `news-lifecycle.js` | `admin`, `steward` | Yes (`news`) |
| `news-body.js` | `admin`, `steward` | Yes (`news`) |
| `news-content-search.js` | `admin`, `steward` | Yes (`news`) |
| `news-image.js` | `admin`, `steward` | Yes (`news`) |
| `news-fetch.js` | `admin`, `steward` | Yes (`news`) |
| `publish-news.js` | `admin`, `steward` | Yes (`publish`) |

### Module: `surveys`

| Function | Current floor | Add matrix gate? |
|---|---|---|
| `survey-list.js` | `admin`, `steward`, `viewer` | Yes |
| `survey-config.js` | `admin` | Yes |
| `survey-update.js` | `admin` | Yes |
| `survey-delete.js` | `admin` | Yes |
| `survey-export.js` | `admin`, `steward` | Yes |
| `survey-moderate.js` | `admin`, `steward` | Yes |
| `survey-toggle.js` | `admin` | Yes |
| `survey-provision.js` | `admin` | Yes |
| `survey-autoclose.js` | `admin` | Yes |
| `survey-health.js` | `admin` | Yes |
| `survey-results.js` | `admin`, `steward` | Yes |
| `survey-submit.js` | PUBLIC | No |

### Module: `ads`

| Function | Current floor | Add matrix gate? |
|---|---|---|
| `ad-admin.js` | `admin` | Yes |
| `ad-list.js` | PUBLIC | No |

### Module: `contrib` / `cocon` / `grants`

| Function | Module | Current floor | Add matrix gate? |
|---|---|---|---|
| `contrib-list.js` | `contrib` | `admin`, `treasurer` | Yes |
| `contrib-save.js` | `contrib` | `admin`, `treasurer` | Yes |
| `contrib-lifecycle.js` | `contrib` | `admin`, `treasurer` | Yes |
| `contrib-pledge.js` | — | PUBLIC | No |
| `contrib-supporters.js` | — | PUBLIC | No |
| `cocon-save.js` | `cocon` | `admin`, `treasurer` | Yes |
| `cocon-get.js` | `cocon` | `admin`, `treasurer` | Yes |
| `cocon-export.js` | `cocon` | `admin`, `treasurer` | Yes |
| `cocon-lifecycle.js` | `cocon` | `admin`, `treasurer` | Yes |
| `grant-admin.js` | `grants` | `admin`, `treasurer` | Yes |

### Module: `projects`

| Function | Current floor | Add matrix gate? |
|---|---|---|
| `projects-list.js` | `admin`, `treasurer`, `pm` | Yes |
| `projects-get.js` | `admin`, `treasurer`, `pm` | Yes |
| `project-link-group.js` | `admin`, `pm` | Yes |
| `project-link-grant.js` | `admin`, `pm` | Yes |
| `projects-lifecycle.js` | `admin`, `pm` | Yes |
| `project-hub-publish.js` | `admin`, `pm` | Yes |
| `project-docs.js` | `admin`, `pm` | Yes |

### Module: `profile`

| Function | Current floor | Add matrix gate? |
|---|---|---|
| `profile-admin.js` | `admin`, `steward` | Yes |

### Platform / no matrix gate

These endpoints operate at platform level (super-admin only or fully public)
and are not candidates for per-module matrix gating:

- `identity-admin.js` — Netlify Identity management (super-admin)
- `village-list.js`, `village-add.js`, `village-remove.js`, `village-status.js`
  — village registry management
- `village-modules.js` — matrix editing itself
- `water-level.js` — public sensor data
- `pages-list.js`, `pages-save.js` — Google Drive docs (admin-level but
  "profile"/"playbook"; can be added later)

---

## 3. Implementation Sketch

```js
// netlify/functions/_auth.js (additions only — no changes to requireRole)

import { queryVillage } from './_villages.js';   // new named export

// Re-export so callers only import _auth.js
export { rolesForModule, DEFAULT_MODULE_ROLES } from './_villages.js';

/**
 * Async wrapper around requireRole that adds a matrix gate.
 * village: resolved village name string (never raw user input)
 * module:  one of the MATRIX_MODULES ids (e.g. 'members', 'events')
 *
 * The existing requireRole floor in each handler stays in place — this is an
 * ADDITIONAL check, not a replacement. Handlers that call this should REMOVE
 * their plain requireRole call and replace it with requireModuleAccess.
 */
export async function requireModuleAccess(context, village, module) {
  // 1. Basic auth + role floor (synchronous, fast path)
  const auth = requireRole(context, { village, anyOf: rolesAllowedByFloor(module) });
  if (!auth.ok) return auth;
  // 2. Super-admin and email-allowlisted users bypass the matrix
  const roles = getRoles(auth.user);
  if (roles.includes('super-admin') || emailAllowlisted(auth.user)) return auth;
  // 3. Load matrix (fail-open on error)
  let matrixAllowed;
  try {
    const rec = await queryVillage(village);
    matrixAllowed = new Set(rolesForModule(rec && rec.moduleAccess, module));
  } catch (err) {
    console.error('[requireModuleAccess] Notion error, failing open:', err.message);
    return auth; // fail-open
  }
  // 4. Check user's village-scoped roles against the matrix
  const vKey = villageKey(village);
  const passes = roles.some(role => {
    const idx = role.lastIndexOf(':');
    if (idx === -1) return false;
    return role.slice(0, idx) === vKey && matrixAllowed.has(role.slice(idx + 1));
  });
  if (!passes) return { ok: false, status: 403, error: 'Module not accessible for your role' };
  return auth;
}

// Helper — the minimum role set a function currently requires.
// Must stay in sync with what each handler uses in its requireRole call.
function rolesAllowedByFloor(module) {
  return DEFAULT_MODULE_ROLES[module] || ['admin'];
}
```

Each handler then replaces:
```js
const auth = requireRole(context, { village, anyOf: ['admin'] });
```
with:
```js
const auth = await requireModuleAccess(context, village, 'members');
```

Because `requireModuleAccess` is async, calling handlers must be `async` (most
already are).

### Caching consideration

`requireModuleAccess` calls `queryVillage` once per request. This is one extra
Notion API call per function invocation. For the current single-village
deployment this is acceptable. If latency becomes a concern, a short-TTL
in-memory cache (`Map<village, { rec, expiresAt }>`) with a 60-second TTL
would reduce it to near-zero in steady state without risk of stale data
blocking an admin.

---

## 4. Identity ↔ Notion Register Reconciliation

### Known drift example

`broncollocott@gmail.com` is **Status=Removed** in the VF Stewards Notion
register but still holds the `smithslake:steward` role in Netlify Identity. As
a result:

- They appear in `getModuleRecipients` results for the `volunteers` module
  (email notification goes to a removed steward).
- If `resolveScope` is called for them, `getStewardCards` returns `[]`
  (because the register row filters `Status = Active`) — so they cannot
  actually access any cards, but they can reach the portal entry page and
  trigger the volunteers function.

### Detection approach

Add a `GET /api/steward-admin?action=drift-report&village=Smiths+Lake`
(admin-only) that:

1. Calls `listIdentityUsers(identity)` to get all Identity users with a
   `<village>:steward` role.
2. Queries the VF Stewards DB for Active rows in the village.
3. Returns a diff: users in Identity-steward role but **absent or Removed** in
   the register — these are drift candidates.

This is a read-only report endpoint; no automatic remediation at this stage.

### Should removing a steward in the register also revoke the Identity role?

**Recommendation: YES, but with a guard.**

The existing steward-admin `remove` action already revokes the Identity role
rather than deleting the account (see CLAUDE.md "Steward Identity self-heal"
note — `revoke` keeps the account, `delete` cancels pending invites). The
gap is that setting `Status=Removed` **directly in Notion** (bypassing the
admin console) does not revoke the Identity role.

Two options:

**Option A (recommended for v1):** Make the drift-report endpoint actionable —
add an optional `?action=drift-fix` that iterates the report and revokes the
Identity role for each drifted user. Super-admin only; not automatic.

**Option B (v2, more complex):** A scheduled Netlify background function that
runs the drift check nightly and auto-revokes. More powerful but introduces
async remediation that is harder to audit.

For `broncollocott@gmail.com` specifically: run the drift-fix action (or
manually revoke via the Access tab → Remove) to bring Identity into sync.

### Broader reconcile notes

- The `resolveScope` card-scoping in `_stewards.js` already fails gracefully
  when a steward has `Status=Removed` — their card list is empty and every
  data call is 403'd at the card level. The Identity role issue is about
  **notification leakage** and **portal page visibility**, not data access.
- If the matrix hard-gate is implemented (§1–3), a steward whose module is
  removed from the matrix is blocked at data access regardless of whether
  the register is in sync. The drift risk narrows to notification emails.

---

## 5. Rollout Sequence

These steps are sequenced to avoid any regression:

1. **Export `queryVillage` from `_villages.js`** (currently unexported/internal).
   Zero observable effect; enables the import in `_auth.js`.

2. **Add `requireModuleAccess` to `_auth.js`**.  
   No existing handler calls it yet — purely additive.

3. **Migrate one low-risk endpoint first** (e.g. `ad-admin.js` — only
   `admin` role, small surface). Verify in preview deploy that:
   - Admin with matrix including `ads` → passes
   - Admin with matrix excluding `ads` → 403
   - No matrix set → passes (default)
   - Notion unreachable (mock) → passes (fail-open)

4. **Migrate remaining endpoints in module batches**, one PR each so the diff
   is reviewable: `members` → `events` → `bookings` → `volunteers` →
   `services` → `news/publish` → `surveys` → `contrib/cocon/grants` →
   `projects` → `profile` → `ads`.

5. **Add drift-report endpoint** to `steward-admin.js`. Run against prod;
   fix `broncollocott@gmail.com` manually via Access tab. Document result.

6. **Add in-memory caching** if Notion latency is measurable in function logs.

---

## 6. Open Questions for Greg

1. **Caching TTL:** 60 s feels right (matrix changes are deliberate, rare).
   Does the committee want instant propagation (no cache) or is 60 s fine?

2. **Drift auto-fix frequency:** daily scheduled function vs. on-demand
   report? A scheduled function needs a Netlify background function + cron
   trigger; the on-demand action is simpler.

3. **`queryVillage` export:** `_villages.js` has one `queryVillage` function
   that is currently unexported. Exporting it means `_auth.js` now imports
   from `_villages.js` — while `_villages.js` already imports from `_auth.js`.
   This **circular import** is resolved by esbuild (which inlines shared
   modules) but should be verified locally. Alternative: move `rolesForModule`
   and `DEFAULT_MODULE_ROLES` into `_auth.js` and have `_villages.js` import
   from there instead.

4. **Steward removal word:** when a steward is removed via the admin console,
   the action today revokes the Identity role. Should it also set
   `Status=Removed` in the Notion register (the inverse of the drift problem)?
   Currently it does NOT touch Notion — only Identity.

---

*This document is the full deliverable for this branch. No function code has
been changed. Implementation begins when Greg approves the approach.*

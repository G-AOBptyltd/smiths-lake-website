# Session 20 — Village Admin portal, packages, treasurer, new modules (26 Aug 2026)

All merged to main and live on villagefirst.org.au (final: `138c0a0`). Five branches, each deploy-verified on its Netlify preview before merge.

## Shipped

1. **Village Admin portal** (`public/admin/index.html`) — `/admin/` evolved from a tile launcher into the platform control-plane: **Modules** (per-village tiles, super-admin Module ON/OFF, events/bookings Public-page toggles, package gating), **All Villages** (lifecycle Live/Suspend/Archive/Delete, KPI rollup, + Village, package selector, named module chips), **Access & roles** (invites/roles now generated per village key, plus the role×module visibility matrix).
2. **Survey Admin decoupled** (`public/survey-admin/index.html`) — surveys only (dashboard, builder, results, playbook, survey defaults); All Villages / Access became links into the portal (`/admin/#villages`, `/admin/#access`). ~300 lines of village-admin code removed.
3. **Packages** — Foundation / Interactive / Complete per village (`Package` select on VF Villages, auto-created). Only `cocon` is Complete-gated; **Grant Portal is deliberately in every tier** (Greg: grants fund the upgrade). Unset package = Complete (fail-open).
4. **Treasurer role** — `<village>:treasurer` on all contrib/cocon endpoints (incl. grant amount); hard-delete stays admin-only; steward keeps only the `contrib-save` write path (volunteers in-kind flow). Finance tiles = admin|treasurer.
5. **Grant Portal** (`/admin/grants/` + `grant-admin.js`) — application pipeline Researching→Drafting→Submitted→Successful/Unsuccessful/Withdrawn, auto-stamped stage dates, project link. DB `🏆 VF Grants` auto-creates (env → search-by-title → create beside Contributions DB).
6. **Village Profile** (`/admin/profile/` + `profile-admin.js`) — the `/demo/community-profile-input` form promoted to an auth-gated per-village console (save/reload/example/Summary-Sheet print); whole profile stored as chunked JSON on `📇 VF Village Profiles` (auto-creates). Tier 1 aggregate only. Demo page untouched.
7. **Module-access matrix** — role×module checkboxes in Access (`Module Access` rich_text JSON on the registry; absent = defaults; reset = save `{}`). **Visibility only** — endpoints keep their `requireRole` floors; super-admin bypasses everything and cannot be stored in the matrix.
8. **Smaller fixes** — publish page now reads/sends the active village (was silently Smiths-Lake-only; per-village News Build Hook now actually used); display-only active-village chip in `admin-nav.js`; All Villages cards show modules as named on/off/locked chips (never counts).

## Registry properties added (all fail-open, auto-created on first write)

`Disabled Modules` (multi_select) · `Package` (select) · `Module Access` (rich_text JSON) — on VF Villages (`2c6272…50d0`). Absent = all-on / Complete / defaults.

## Gotchas for next session

- **No `/api/*` wildcard** in netlify.toml — every new function needs an explicit redirect block.
- Branch previews share **production** Notion + Identity: module/package/matrix writes are harmless (additive properties), but lifecycle + role changes on a preview are real.
- Old branch previews are **frozen snapshots** — a bookmarked preview reads as "prod is stale". Check the URL first when triaging.
- Display rule (Greg): admin UIs **enumerate, never count** — "anyone should look and see exactly what they have without a special explanation".
- Marketing counts "16 community modules"; the portal has 12 switchable consoles + publish/playbook utilities (website/CMS, project hub, service stewards make up the difference).

## Related updates outside this repo

village1st.com.au → v0.2.0, "All 16 community modules", grant portal in Foundation ("grants can fund your upgrade"). Both Resilience Canopy pitch decks → v2, 16 modules, Grant Portal + Village Profile cards.

## Open items

Treasurer access to Membership *data* (tile visible via matrix, API refuses — awaiting Greg's call) · Meeting Minutes + Village Document Library modules · optionally pin `NOTION_VF_GRANTS_DB_ID` / `NOTION_VF_PROFILES_DB_ID` env vars after first save.

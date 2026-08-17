# CLAUDE.md — smiths-lake-website (VillageFirst / Smiths Lake Community)

## Separation from Agility Ops (STRICT — read first)
VillageFirst is a **separate entity** from Agility Ops / InSite. There must be **zero
crossover** between VillageFirst and ANY Agility Ops tool, website, account or service —
including **payments** (VillageFirst payments run through PPCA's own Tyro merchant
facility, MID 341148 — no link to the Agility Ops Stripe account, keys, webhook or
runbook), Notion licence infrastructure, and the Central API.

**Payments (Aug 2026):** Stripe is NOT used — the old Payment Link scaffolding was removed.
Online memberships (primary) + donations (secondary) will use the **Tyro Connect Pay API
("Pay Online")**: server-side Pay Request via `netlify/functions/tyro-pay-request.js` →
embedded `tyro.js` card form on `/contribute/` → `tyro-webhook.js` writes the Contribution
to Notion as Received. Plan: `~/AgilityOpsBizAI/AOB/villagefirst/docs/payments-platform/VillageFirst-Tyro-PayOnline-Implementation-Plan.html`.
Blocked on Tyro enabling eCommerce for MID 341148 (call 1300 00 8976). Env vars (Netlify):
`TYRO_API_TOKEN`, `TYRO_LOCATION_ID`, `TYRO_LIVE_MODE`, `TYRO_WEBHOOK_SECRET`.

**The ONLY permitted connection** is course-signal logging: VillageFirst work may be logged
as coaching/course signals in `AOB-Course-Roadmap-Signal-Log.md` (per `.claude/rules/coaching-tips.md`).
Nothing else. **If you are ever unsure whether something creates an Agility Ops ↔ VillageFirst
crossover, STOP and ask Greg before proceeding.**

## Project Overview
- **Local path:** `~/AgilityOpsBizAI/repos/Village1stPlatform/smiths-lake-website` (moved here 14 Aug 2026 from `~/AOB Websites/`; repo index at `~/AgilityOpsBizAI/repos/CLAUDE.md`)
- **Live site:** https://villagefirst.org.au
- **GitHub repo:** G-AOBptyltd/smiths-lake-website
- **Hosting:** Netlify — project name `smithscommunityfirst`
- **Netlify dashboard:** https://app.netlify.com/sites/smithscommunityfirst
- **Framework:** Astro (static site generator)
- **CMS:** Notion (content fetched at build time via Notion API)

## Branch & Deploy Workflow
1. Always branch from current `main` — never reuse old merged branches
2. `git checkout -b feature/your-feature-name`
3. Make changes → commit → push → Netlify auto-builds a preview URL
4. Paste preview URL to user for approval
5. User approves → merge to main → production auto-deploys

**GitHub auth:** Password auth is deprecated. Use PAT as password:
```
git remote set-url origin https://G-AOBptyltd@github.com/G-AOBptyltd/smiths-lake-website.git
```

**Git lock fix** — if `git commit` fails with "Unable to create HEAD.lock" or "index.lock", run:
```bash
rm /Users/gregcollocott/AgilityOpsBizAI/repos/Village1stPlatform/smiths-lake-website/.git/index.lock 2>/dev/null; rm /Users/gregcollocott/AgilityOpsBizAI/repos/Village1stPlatform/smiths-lake-website/.git/HEAD.lock 2>/dev/null
```
Then retry the commit. Claude's sandbox cannot remove these files — must be run locally.

## Build Chain
```
node src/scripts/download-hero-images.js
  && node src/scripts/generate-search-index.js
  && astro build
```
Defined in `package.json` under `"build"`.

## Key Files
| File | Purpose |
|------|---------|
| `src/lib/notion-projects.js` (v2.4) | Fetches projects from Notion, reads hero image manifest, serves local image paths only (no Notion URL fallback) |
| `src/scripts/download-hero-images.js` (v2.0) | Build-time script: downloads section hero, card, project, and inline page body images from Notion; writes 4 manifests |
| `src/components/NotionPageContent.astro` (v1.1) | Renders Notion page body blocks; reads `/public/images/content/manifest.json` for stable inline image paths |
| `public/images/content/manifest.json` | Build-time generated: Notion block ID → local stable image path |
| `src/pages/projects/[slug].astro` | Project detail pages — feedback CTA, share button, Quick Actions sidebar |
| `src/pages/feedback.astro` | Community feedback form page |
| `src/components/Hero.astro` | Hero banner component (no diagonal stripes) |
| `src/pages/history/index.astro` | History timeline (newest-first sort) |
| `public/surveys/blueys-beach-survey.html` | Standalone Blueys Beach survey tool |
| `public/images/projects/manifest.json` | Build-time generated: slug → local image path map |

## Critical: generateSlug() Must Match Everywhere
Two files use `generateSlug()` and **they must be identical** or hero images will break:
- `src/scripts/download-hero-images.js` (writes manifest keys)
- `src/lib/notion-projects.js` (looks up manifest keys)

**Correct implementation (both files must use this):**
```javascript
function generateSlug(title) {
  if (!title) return 'untitled';
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 100);
}
```
Note: apostrophes become hyphens ("Bluey's" → "bluey-s"), ampersands become hyphens (not "and").

## Zapier / Notion Integration
**DO NOT change form field `name` attributes** — Zapier maps these to Notion columns.

Safe to change: button labels, page titles, field label text, placeholder text, CSS classes.

Active Zaps (all polling-based, ~15 min delay, Free plan):
- `feedback` form → Notion Community Inbox + Mailchimp
- `contact` form → Notion Community Inbox + Mailchimp
- `newsletter` form → Mailchimp only (no Notion entry)
- `project-subscription` form → Notion Community Inbox + Mailchimp

## Notion Workspace
- **Community Inbox DB:** `2c6d508adfc180148c2f9260af61fc1`
- **TECHNICAL-REFERENCE:** `30cd508adfc1809a9f3fe22f2c8c356a`
- **VillageFirst Playbooks:** `2cdd508adfc181db9136e2c4f72fc1ac`
- **VF Members DB (PPCA member register):** `494becca311c4d668a0f7f2750c08a74` — written by
  `/api/member-join` (env override `NOTION_MEMBERS_DB_ID`). Fees Individual $10 / Household $20,
  year 1 Jul–30 Jun, Status flow Applied → Approved → Paid → Lapsed. NOTE: child DBs do NOT
  inherit the parent page's integration connections — a new VF DB must be manually connected
  to BOTH `villagefirst-website` and `VF1` (⋯ → Connections) or writes 404 ("object_not_found").

## Membership (/membership/, added Aug 2026)
- `src/pages/membership.astro` — PPCA membership application form → `/api/member-join`
  (`netlify/functions/member-join.js`, modelled on contrib-pledge: honeypot, length caps,
  fee derived server-side, Status always Applied, env-gated PPCA notify via VF_RESEND vars).
- Stay Connected opt-in re-posts to the Netlify `newsletter` form (exact field names) so the
  Zapier → Mailchimp zap works unchanged — the zap watches the FORM NAME, not the page URL.
- `/newsletter/` is RETIRED (Aug 2026): page deleted, 301 → `/membership/#updates`; the free
  signup lives in the membership page's "Just want community updates?" section, and the static
  `newsletter` form also survives in the `/news/` sidebar (keeps Netlify form detection alive).
  Footer/homepage/sitemap/project CTAs all point to `/membership/` now.
- `/contribute/` coming-soon card links here; when Tyro Pay Online ships, membership payment
  happens on `/contribute/` and this page's payment options get a "pay online" path.
- **Membership ADMIN tool `/admin/members/`** (Aug 2026): the committee's register UI — status
  workflow (Applied → Approved → Paid → Lapsed), payment recording (date/method/reference/amount),
  year-by-year renewals (a renewal creates a NEW row for the next membership year, so the register
  is its own audit trail), filtered CSV export, and welcome/renewal emails via the VF Resend vars
  (reply-to = first `VF_PLEDGE_NOTIFY_TO` address). Functions: `member-list` (admin-only, PII),
  `member-update` (actions status/payment/details/renew/delete — delete is super-admin only;
  every write stamps `Last Updated By`), `member-email`, shared `_members.js`. The functions
  SELF-HEAL the DB schema (idempotent PATCH adds Payment Date / Payment Reference / Amount Paid /
  Last Email / Last Updated By) — no manual Notion property setup. Optional env:
  `VF_MEMBER_ORG_NAME` (sign-off, default PPCA), `VF_MEMBER_PAY_INSTRUCTIONS` (bank details
  block shown to unpaid members in emails).

## Volunteer hub (/admin/volunteers/, added Aug 2026)
Card-level volunteer management: network → village → **card** (a content page like
/environment/landcare-and-bush-regeneration/, keyed by its site path `sectionPath/slug`).

- **Permission model:** Identity role `<village>:steward` opens the portal; WHICH cards a
  steward runs comes from the **VF Stewards** Notion register (email → cards JSON). Admins see
  everything; `_stewards.js` `resolveScope()`/`scopeHasCard()` enforce it server-side in every
  function. Appointing a steward (admin-only, Stewards tab) upserts the register row AND
  auto-wires Netlify Identity via `context.clientContext.identity` (invites unknown emails,
  grants `<village>:steward` to role-less accounts, never downgrades existing roles).
- **Three shared DBs** (all villages, Village text column; created once by POST
  `/api/volunteer-provision`, super-admin): 🧭 VF Stewards, 🙋 VF Volunteers, 🛠 VF Activities —
  siblings of the VF Members DB. Ids live in env vars `NOTION_VF_STEWARDS_DB_ID` /
  `NOTION_VF_VOLUNTEERS_DB_ID` / `NOTION_VF_ACTIVITIES_DB_ID` (functions 503 until set).
  JSON blobs (Cards, Attendance) are chunked across 1900-char rich_text segments (`rtChunks`).
- **Public signup:** `VolunteerSignup.astro` renders on DetailPage cards in sections
  environment / groups / emergency only (Project Hub excluded — its Slug override would break
  path keying; services/history don't volunteer). Posts to `/api/volunteer-signup`
  (member-join-style hardening; upserts by email+village, appends cards for repeat signups,
  emails the card's stewards, falling back to VF_PLEDGE_NOTIFY_TO).
- **Functions:** `volunteer-roster` (GET scoped list / POST status·details·cards·delete[super]),
  `volunteer-activity` (working bees: attendance JSON + server-derived Total Hours; Draft →
  Confirmed → Pushed, where Pushed = locked, reserved for the contributions push stage),
  `steward-admin` (add/cards/remove/restore), `volunteer-provision`. Shared `_stewards.js`.
- **Hours → money (next stage):** admin reviews Confirmed activities and pushes them into the
  Contributions portal as time-in-kind entries linked back via `Contribution ID` — the grant
  co-contribution audit trail. Valuation reuses the co-contribution rates.
- **Steward home `/admin/volunteers/my/`** (the 60+-friendly surface): task-first phone-first UI —
  approvals queue, 4-step working-bee wizard (When → Where → Who → Done+Share), and the group's
  volunteers/hours page with an adventure-style trail map (parchment cartouche + sepia CARTO
  Voyager tiles, styled after the Smiths Lake Bridge poster in `~/AgilityOpsBizAI/AOB/villagefirst/events/`).
  Non-admin stewards hitting `/admin/volunteers/` are auto-redirected here (`?console=1` overrides).
  "Where" step: previous spots derived from past activities' Location/Lat/Lng (schema self-heals
  via `ensureActivitySchema`), new spots via Leaflet pin or phone geolocation. Wizard saves with
  `confirm:true` (lands Confirmed — the summary screen IS the confirm step). "Tell the village"
  share step reuses news-save (+news-image photo, downscaled client-side) + news-publish —
  privacy-safe default story text (counts, not names). Mockup preserved at
  `/admin/volunteers/mockup.html`.

## Facility bookings (/facilities/ + /admin/bookings/, added Aug 2026)
Community-hall hire: public page shows rates + a 2-month availability calendar (live from
`/api/booking-availability` — no rebuild when rates change) and posts requests (member-join
hardening) → 📅 VF Bookings as **Requested**; the committee confirms every booking (no
auto-confirm; clashes are flagged, not rejected — committee decides). 🏛 VF Facilities holds
the hireable spaces + rates/conditions, edited in the console (Facilities & rates tab).
Created by POST `/api/booking-provision` (super-admin; seeds the hall with placeholder rates);
env vars `NOTION_VF_FACILITIES_DB_ID` / `NOTION_VF_BOOKINGS_DB_ID`. Booking Date property
holds start+end datetimes → conflict check is one interval overlap. Status flow Requested →
Confirmed | Declined → Cancelled / Completed; payment recorded manually (fee/bond/reference/
bond-returned) until Tyro; emails (confirmed incl. `VF_BOOKING_PAY_INSTRUCTIONS` (falls back
to `VF_MEMBER_PAY_INSTRUCTIONS`) + conditions, declined) via VF Resend, stamped in Last Email.
Functions: `booking-availability` (public, no PII), `booking-request` (public), `booking-admin`
(admin, PII), `facility-admin`, `booking-email`, `booking-provision`, shared `_bookings.js`.

## Survey Tool
- **URL:** https://villagefirst.org.au/surveys/blueys-beach-survey.html
- **Backend:** Google Apps Script Web App (deployed under admin@villagefirst.org.au)
- **Data:** Google Sheet "Blueys Beach Survey Responses" (27 columns)
- **CORS:** Use default fetch mode with `Content-Type: text/plain;charset=utf-8` — do NOT use `mode: 'no-cors'`

## Known Issues / Deferred
- "Login and Submit" button on Project Hub page is misleading (navigates directly to form, no login). Deferred.
- Newsletter Subscribers Notion DB is empty by design — subscribers managed in Mailchimp only.

## Session History Summary
- **Sessions 1–3:** Zapier zaps, Netlify forms, Notion databases
- **Session 4 (Feb 19):** Zap troubleshooting, live end-to-end test, Volunteer Playbook
- **Session 5 (Feb 20):** Hero image fix — build-time download script, manifest.json approach
- **Session 6 (Feb 24):** Universal detail pages (DetailPage.astro), 5 section routes, slug alignment
- **Session 7 (Mar 11):** Remove hero stripes, reverse history timeline to newest-first
- **Session 8 (Apr 5):** Newsletter → Stay Connected rename, clickable section cards
- **Session 9 (Apr 11):** Blueys Beach survey architecture assessment (Scenario A vs B)
- **Session 10 (Apr 12–13):** Blueys Beach survey MVP deployment, CORS fix, Google Apps Script
- **Session 11 (Apr 18):** Survey anonymisation, 3-min refresh, ADR-001 v2, Back to Hub button
- **Session 12 (May 15):** Hero image slug mismatch fix, feedback button UX redesign, feedback form copy update
- **Session 13 (May 18):** News & Services page — BBC-inspired layout, dynamic Notion news feed, /news/[slug]/ article template, services 404 fix, News section added to Notion DB. Homepage Latest Updates removed → News & Services banner card. Feed duplication fixed (centre hero now shows unique second item, not repeat of lead).
- **Session 14 (May 19):** Fixed expiring inline page body images (Notion S3 URLs expire ~1hr). Root cause: `NotionPageContent.astro` was embedding raw Notion S3 URLs directly in static HTML. Fix: extended `download-hero-images.js` pre-build script with `downloadPageContentImages()` — downloads all Notion-hosted image blocks to `/public/images/content/[blockId].[ext]` and writes a manifest. `NotionPageContent.astro` now reads manifest at build time and uses stable local paths. Also removed expiring URL fallback in `notion-projects.js` project hero images. BBC centre hero block updated to use real card photo from manifest when available (previously always showed section colour gradient).

- **Session 14.5 (May 23):** Survey/Results buttons disappeared from Blueys Beach project page after the Notion entry was renamed. Root cause: `getSurveyUrl()` and `getSnapshotUrl()` used a hardcoded slug→URL map — the new slug wasn't in the map. Proper fix: added `Survey URL` and `Results URL` URL fields to the Notion DB; `notion-unified.js` maps them; `notion-projects.js` reads from Notion instead of the hardcoded map. Also fixed hardcoded `/projects/bluey-s-beach-village-centre/` back-links in `blueys-beach-survey.html`, `blueys-beach-results-27april2026.html`, `blueys-beach-results-21april2026.html`. Added a 301 redirect in `netlify.toml` for old slug → new slug. Added a `Slug` field to the Notion DB and locked the Blueys Beach slug to `bluey-s-beach-village-survey-concept-designs` so future title renames don't break URLs.

- **Session 15 (Jun 11):** News/Services split + deliberate publishing. Root cause of "fake news" fixed: feed no longer sorts all sections by `notionLastEditedTime`. New Notion properties `Publish Date` (date) + `Show in News Feed` (checkbox) drive the feed. `/news/` = image-forward feed (photo lead story + photo card grid + more-stories list), only items with checkbox ✓ AND a Publish Date, sorted by Publish Date desc. `/services/` = services directory only. Nav split: "News" + "Services". Homepage banner → /news/. Article template prefers Publish Date and uses card photo hero. New: `netlify/functions/publish-news.js` (POSTs to `NEWS_BUILD_HOOK_URL` env var) + `/admin/publish-news.html` maintainer button. Notion: "📰 News Desk" view added; How-to page updated. SETUP REQUIRED: create Netlify build hook + set `NEWS_BUILD_HOOK_URL` env var.

- **Session 16 (Jun 23):** News Desk image upload — editors now add story photos directly in `/admin/news/` (Netlify Blobs), removing the "photos go in Notion" stopgap and the expiring-S3-URL problem. New `news-image.js` function (`/api/news-image`), `Image URL` Notion property, client-side downscale, render prefers the stable URL over the build-time manifest. Full detail in "News Desk Image Pipeline" below. SETUP REQUIRED: `npm install @netlify/blobs` + add `Image URL` (URL) property to the content DB.
- **Session 17 (Jul 28):** `/news/` **hybrid layout** shipped (`src/pages/news/index.astro`, live). Fixed the "images don't display well" complaint — root cause was **data, not code**: every published story has a null `Image URL` (editors skip the News Desk photo-upload step); the render pipeline, `news-image` Blobs function, and deploy were all healthy. Replaced the photo-forward masthead (big splash + thumbnail tiles that showed empty gradient/emoji fillers with no photo) with a **graceful hybrid**: stories WITH a photo → a "Featured" band (max 2, full-bleed image tiles); every other story → a clean newspaper text row (date · section chip · serif headline · excerpt · read-more · thin section-colour left accent). The Featured band is **omitted entirely at zero photos**, so the page looks intentional today and grows richer as editors upload images. Sidebar (Netlify `newsletter` form, Have Your Say, Local Services) unchanged. **Process note:** an earlier CSS-tint restyle was rejected ("looks terrible") — for VF visual changes, build a **viewable HTML mockup first**, don't push a full Astro branch sight-unseen. **Open:** seed real photos onto current stories so the Featured band shows in prod; add an "add a photo" nudge to `/admin/news/`.

## Admin Hub & News Desk (added Session 15)
- **`/admin/`** — single bookmarkable admin hub. Registry-driven tiles (TOOLS array in `public/admin/index.html`), Netlify Identity gated, role-filtered (reuses survey role model from `_auth.js`: super-admin, `<village>:admin/steward/viewer`). Tiles: Surveys → /survey-admin/, News desk → /admin/news/, Publish website → /admin/publish-news.html, Playbook; Events & Advertising marked coming soon.
- **`/admin/news/`** — News Desk for non-technical maintainers. Three flows: Stories dashboard (feed toggles per story), Write a story (headline/body/date → Notion page Section=News), Share existing (click-select published items from any section → flips Show in News Feed + Publish Date). Publish button fires the build hook.
- **Functions:** `news-list`, `news-save`, `news-toggle`, `news-content-search` (all auth-guarded via `_auth.js` requireRole admin/steward) + `/api/news-publish` → existing `publish-news`. Content DB id: `NOTION_CONTENT_DB_ID` env or fallback `2cad508adfc1809d8438c8f3a5dd8d42`.
- **Multi-village:** all endpoints accept `village` param; v1 serves the single Smiths Lake content DB. When the network grows: resolve content DB id + build hook from the Villages registry per village.
- Drafts = Status on Web 'Pending' + checkbox off (never rendered). Live = Published + Show on Website TRUE + checkbox + date.
- Photos: editors now upload directly in the News Desk — see "News Desk Image Pipeline" below. (Notion `Hero Image File` still works as a legacy fallback.)

## News Desk Image Pipeline (added Session 16, Jun 23)
Editors upload story photos straight from `/admin/news/` — no Notion, no expiring URLs. Solves the two coupled problems that left photos "in Notion": Notion file URLs are ~1h signed S3 links, and the site is a build-time static build.

- **Storage:** Netlify Blobs (store `news-images`). Requires `@netlify/blobs` in `package.json` (esbuild must resolve the import — `npm install @netlify/blobs`).
- **Function `netlify/functions/news-image.js`** (redirect `/api/news-image`):
  - `POST` (auth admin/steward): accepts `{ village, storyKey, contentType, dataBase64 }`, stores under a UNIQUE key `<villageSlug>/<storyKey>/<timestamp>.<ext>` (immutable → safe long-cache), returns `{ url: "/api/news-image?key=..." }`.
  - `GET` (public): streams the blob with `Cache-Control: public, max-age=31536000, immutable`. This is the URL the website `<img>` reads — stable, never expires.
- **Notion:** new **`Image URL`** (URL property) on the content DB holds the stable link. `news-save.js` writes it only when provided (never clobbers with blank). `news-list.js` returns `imageUrl` + counts it toward `hasPhoto`.
- **Admin form (`public/admin/news/index.html`):** real `<input type=file>` + preview; client-side downscale to ≤1600px JPEG @0.82 (keeps payloads small, substitutes for not having Cloudinary resize). `saveStory()` = save text (get `pageId`) → upload photo keyed by `pageId` → re-save with `imageUrl`.
- **Render:** `notion-unified.js` parses `Image URL` → `item.imageUrl`; `news/index.astro` and `news/[slug].astro` prefer `item.imageUrl` over the build-time `cards/manifest.json`, falling back to it for legacy stories.
- **Publish:** unchanged — the existing build-hook button rebuilds the static pages.
- **SETUP REQUIRED:** (1) `npm install @netlify/blobs`; (2) add `Image URL` (URL type) property to the content DB in Notion; (3) Netlify Blobs needs no config on deploy.
- **v1 limitations:** "Remove photo" in the form only clears the *pending* selection — it does not blank an already-saved `Image URL` (no Notion removal yet). Old blobs from replaced photos are orphaned (harmless; add a cleanup later). MAX 8 MB server guard.

## News Desk — Archive & Delete (added Session 16, Jun 23)
Role-based story removal on the `/admin/news/` Stories dashboard. Function `netlify/functions/news-lifecycle.js` (redirect `/api/news-lifecycle`), POST `{ village, pageId, action }`.

- **Archive** (admin/steward+): Status on Web → UnPublished, Show on Website → FALSE, Show in News Feed → off. Story leaves the site + feed on next Publish but stays in Notion. **Restore** flips it back to Published/TRUE. (Render `getStaticPaths` uses `requireShowOnWebsite: true`, so UnPublished items lose both feed entry and article page.)
- **Request delete** (admin/steward): writes "Requested by <email> on <date>" into the new **`Delete Request`** text property. The super-admin sees a "🗑 delete requested" badge on that story (in-app notification — email is a later enhancement).
- **Delete** (SUPER-ADMIN ONLY — server-enforced via `getRoles(user).includes('super-admin')`, UI also hides the button): archives the Notion page (`PATCH {archived:true}` → Notion trash, recoverable). Normal admins never see Delete; they use Request delete.
- Frontend role gate: `isSuper = currentUser.app_metadata.roles.includes('super-admin')` (UX only; the server is the real gate). **SETUP:** assign the `super-admin` role (Access tab) to whoever should delete — until then Delete is hidden and only Request delete is available. Notion: added `Delete Request` (text) property to the content DB.

## News & Services Architecture (added Session 13)
- **`/services/`** — combined "News & Local Services" page. Fetches all published items via `fetchNotionContent()`, sorts News-section items first then by `notionLastEditedTime` descending. BBC 3-col layout: lead text + hero colour block + digest list, then 3 thumbnail cards below. Local services directory below the feed.
- **`/news/[slug]/`** — clean article template for Section = News items. Gradient hero + large emoji + headline, meta bar (date/category/read time), body paragraphs split on `\n`, documents block, share footer. No sidebar.
- **`/services/[slug]/`** — fixed to fetch both `'Services'` and `'Services & Amenities'` sections (was only fetching `'Services'`, causing 404s).
- **Notion DB:** `News` added as valid Section select option. Use `Status on Web = Published` + `Section = News` to publish an article.
- **`notionLastEditedTime`** (`page.last_edited_time`) mapped in `notion-unified.js` — always available, no custom field needed. Used as publication proxy for news feed ordering.
- **`getSectionColour()`** exported from `notion-detail-pages.js`. `News` added to all three section mappings (SECTION_TO_PATH, SECTION_COLOURS, SECTION_DISPLAY_NAMES).
- **Nav label:** "Services" → "News & Services" in `Header.astro`.
- **Branch rule:** NEVER use `@netlify/mcp` deploy — it deploys to production. Feature branch previews are triggered by git push only.

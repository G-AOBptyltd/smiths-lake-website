# CLAUDE.md — smiths-lake-website (VillageFirst / Smiths Lake Community)

## Project Overview
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
rm /Users/gregcollocott/AOB\ Websites/smiths-lake-website/.git/index.lock 2>/dev/null; rm /Users/gregcollocott/AOB\ Websites/smiths-lake-website/.git/HEAD.lock 2>/dev/null
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

## News & Services Architecture (added Session 13)
- **`/services/`** — combined "News & Local Services" page. Fetches all published items via `fetchNotionContent()`, sorts News-section items first then by `notionLastEditedTime` descending. BBC 3-col layout: lead text + hero colour block + digest list, then 3 thumbnail cards below. Local services directory below the feed.
- **`/news/[slug]/`** — clean article template for Section = News items. Gradient hero + large emoji + headline, meta bar (date/category/read time), body paragraphs split on `\n`, documents block, share footer. No sidebar.
- **`/services/[slug]/`** — fixed to fetch both `'Services'` and `'Services & Amenities'` sections (was only fetching `'Services'`, causing 404s).
- **Notion DB:** `News` added as valid Section select option. Use `Status on Web = Published` + `Section = News` to publish an article.
- **`notionLastEditedTime`** (`page.last_edited_time`) mapped in `notion-unified.js` — always available, no custom field needed. Used as publication proxy for news feed ordering.
- **`getSectionColour()`** exported from `notion-detail-pages.js`. `News` added to all three section mappings (SECTION_TO_PATH, SECTION_COLOURS, SECTION_DISPLAY_NAMES).
- **Nav label:** "Services" → "News & Services" in `Header.astro`.
- **Branch rule:** NEVER use `@netlify/mcp` deploy — it deploys to production. Feature branch previews are triggered by git push only.

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
| `src/lib/notion-projects.js` (v2.4) | Fetches projects from Notion, reads hero image manifest, serves local image paths |
| `src/scripts/download-hero-images.js` | Build-time script: downloads hero images from Notion, writes `/public/images/projects/manifest.json` |
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

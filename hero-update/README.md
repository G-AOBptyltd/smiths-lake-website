# Hero Update — File Placement Guide

## Branch: feature/hero-update

All files in this ZIP mirror the exact repo structure.
Just extract into your repo root and they'll land in the right places.

## Files Included

### NEW FILES (add these)
- `.gitignore` → repo root
- `src/components/SectionHero.astro` → new shared hero component
- `src/lib/notion-section-settings.js` → new Notion fetcher

### MODIFIED FILES (replace existing)
- `src/scripts/download-hero-images.js` → rewritten v2.0
- `src/pages/about/index.astro`
- `src/pages/services/index.astro`
- `src/pages/emergency/index.astro`
- `src/pages/groups/index.astro`
- `src/pages/history/index.astro`
- `src/pages/environment/index.astro`

### NOT INCLUDED (do manually)
- `.env` — Add this line: `NOTION_SECTION_SETTINGS_DB=07aaa89718ce4ec2973d2061ef35f9f2`
- **Netlify env var** — Add `NOTION_SECTION_SETTINGS_DB` = `07aaa89718ce4ec2973d2061ef35f9f2` in Netlify dashboard

## Git Commands

```bash
# 1. Create and switch to feature branch
git checkout -b feature/hero-update

# 2. Extract the ZIP into your repo root (or copy files manually)

# 3. Stage all changes
git add .

# 4. Commit
git commit -m "feat: shared SectionHero component with Notion-managed hero images

- New SectionHero.astro component for all section landing pages
- New Section Settings Notion database for hero images/titles/colours
- Extended download-hero-images.js to handle all sections + cards
- Updated 6 section pages to use shared component
- Added .gitignore"

# 5. Push
git push origin feature/hero-update
```

/**
 * _pages.js — shared helpers for the "Village pages" console (About / Contact
 * / story rows in a village's content DB).
 *
 * Files prefixed with "_" are NOT deployed as standalone endpoints by Netlify,
 * but can be imported by the other functions (esbuild inlines them).
 *
 * ⚠ SOURCE OF TRUTH: the row-selection logic below (visibility, slug rules,
 * About/Contact detection, ordering) is a deliberate duplicate of
 * src/lib/notion-about.js, which is what the BUILD uses to render /about/ and
 * /contact/. notion-about.js does not export its internal filter helpers and
 * binds its own Notion client to the build-time env DB, so the functions keep
 * this thin mirror instead of importing it. If you change the selection rules
 * there, change them here too (and vice versa).
 */

/** Join every rich-text/title segment (mirrors notion-about.js plain()). */
export function plain(property) {
  if (!property) return '';
  if (property.type === 'title') return property.title?.map((t) => t.plain_text).join('') || '';
  if (property.type === 'rich_text') return property.rich_text?.map((t) => t.plain_text).join('') || '';
  if (property.type === 'select') return property.select?.name || '';
  if (property.type === 'email') return property.email || '';
  return '';
}

/** Visibility gate — matches notion-about.js isVisible(). */
export function isVisible(props) {
  const statusOnWeb = plain(props['Status on Web']);
  const showOnWebsite = plain(props['Show on Website']);
  return statusOnWeb === 'Published' || showOnWebsite === 'TRUE';
}

/** Numeric sort key from the rich_text "Priority Order" (missing → 999). */
export function priorityOrder(props) {
  const n = parseInt(plain(props['Priority Order']), 10);
  return Number.isFinite(n) ? n : 999;
}

/** Slug fallback identical to notion-about.js rowSlug() (title-derived). */
export function rowSlug(props) {
  const explicit = plain(props['Slug']);
  if (explicit) return explicit.toLowerCase();
  return plain(props['Title'])
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** About-ish detector — matches notion-about.js isAboutRow(). */
export function isAboutRow(props) {
  if (plain(props['Section']) !== 'History & Culture') return false;
  const slug = rowSlug(props);
  // "our-story", "the-story-of-<village>", explicit "about" slugs…
  if (/(^|-)story(-|$)|(^|-)about(-|$)/.test(slug)) return true;
  // …plus the Indigenous-heritage country row ("Worimi Country").
  if (plain(props['Category']) === 'Indigenous Heritage') return true;
  return false;
}

/** Contact detector — matches the filter in notion-about.js fetchContactContent(). */
export function isContactRow(props) {
  if (plain(props['Section']) !== 'Administration & Reference') return false;
  const slug = rowSlug(props);
  return /(^|-)contact(-|$)/.test(slug) && !slug.includes('emergency');
}

/** Classify a content-DB page for the console: 'about' | 'contact' | null. */
export function pageKind(props) {
  if (!props) return null;
  if (isAboutRow(props)) return 'about';
  if (isContactRow(props)) return 'contact';
  return null;
}

/** Normalize a Notion id/database id for comparison ("abc-def…" → hex32). */
export function normalizeId(id) {
  return String(id || '').toLowerCase().replace(/[^a-f0-9]/g, '');
}

/** Console list item for a matching content-DB page. */
export function parsePageItem(page) {
  const props = page.properties || {};
  const kind = pageKind(props);
  return {
    id: page.id,
    kind, // 'about' | 'contact' (null rows are filtered out by the caller)
    title: plain(props['Title']) || '(untitled)',
    description: plain(props['Description']),
    section: plain(props['Section']),
    category: plain(props['Category']),
    slug: rowSlug(props),
    priority: priorityOrder(props),
    visible: isVisible(props),
    contactEmail: kind === 'contact' ? plain(props['Contact Email']) : '',
    showContactPublicly: kind === 'contact' ? plain(props['Show Contact Publicly']) === 'TRUE' : undefined,
    lastEdited: page.last_edited_time,
  };
}

/**
 * Property-only Notion payload for a Village-pages save. Never touches
 * Section / Slug / visibility flags, so a save can't knock a page off the
 * site or change which page renders where.
 *
 * Audit stamp: when the page already carries a "Logged By"/"Logged by"
 * rich_text property (same convention as grant-admin / contrib-save), the
 * saving admin's verified email is stamped into it. `existingProps` is the
 * retrieved page's properties — the stamp is only written when the property
 * exists, because PATCHing an unknown property 400s the whole update.
 */
export function buildSaveProperties({ title, description, editorEmail, existingProps }) {
  const properties = {
    'Title': { title: [{ text: { content: String(title).slice(0, 200) } }] },
    'Description': {
      rich_text: description
        ? [{ text: { content: String(description).slice(0, 2000) } }]
        : [],
    },
  };
  for (const key of ['Logged By', 'Logged by']) {
    if (existingProps && existingProps[key] && existingProps[key].type === 'rich_text') {
      properties[key] = { rich_text: [{ text: { content: String(editorEmail || 'admin').slice(0, 200) } }] };
      break;
    }
  }
  return properties;
}

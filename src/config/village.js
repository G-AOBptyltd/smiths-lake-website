/**
 * Village config — single source of truth for per-village branding.
 *
 * Every value resolves as: env override ?? exact current Smiths Lake string.
 * CRITICAL INVARIANT: with NO env vars set, the built site must be identical
 * to the historical hardcoded Smiths Lake site. Do not change a default here
 * without understanding that it changes villagefirst.org.au.
 *
 * Works in BOTH Astro frontmatter (build time) and client-side <script>
 * blocks: all vars use the PUBLIC_ prefix so Vite statically replaces
 * `import.meta.env.PUBLIC_*` in client bundles too. Netlify Functions cannot
 * import this module — they use `process.env.VILLAGE_NAME || 'Smiths Lake'`
 * fallbacks instead (non-public env var, same value as PUBLIC_VILLAGE_NAME).
 */

// Water widget: PUBLIC_WATER_WIDGET is either "off" (widget hidden entirely)
// or an MHL gauge site number (default: 209465 = Tarbuck Bay, Smiths Lake).
const rawWaterWidget = import.meta.env.PUBLIC_WATER_WIDGET || '209465';

export const village = {
  /** Notion "Village" value — keys every API call and DB row. */
  name: import.meta.env.PUBLIC_VILLAGE_NAME || 'Smiths Lake',

  /** Human display name used in headers/titles. */
  displayName: import.meta.env.PUBLIC_VILLAGE_DISPLAY_NAME || 'Smiths Lake Village',

  /** Browser/OG title (defaults to the display name). */
  siteTitle:
    import.meta.env.PUBLIC_SITE_TITLE ||
    import.meta.env.PUBLIC_VILLAGE_DISPLAY_NAME ||
    'Smiths Lake Village',

  /** Header tagline under the site title. */
  tagline: import.meta.env.PUBLIC_VILLAGE_TAGLINE || 'A Pacific Palms Community',

  /** Default <meta name="description"> for pages that don't set their own. */
  siteDescription:
    import.meta.env.PUBLIC_SITE_DESCRIPTION ||
    'Official community website for Smiths Lake Village, Pacific Palms NSW. Your gateway to coastal living in the Great Lakes region.',

  /** Legal entity behind the site (full name). */
  entityName: import.meta.env.PUBLIC_ENTITY_NAME || 'Pacific Palms Community Association',

  /** Short form of the entity name. */
  entityShort: import.meta.env.PUBLIC_ENTITY_SHORT || 'PPCA',

  /** Entity string used in the footer copyright line ("© YEAR <this>. All rights reserved."). */
  copyrightEntity:
    import.meta.env.PUBLIC_COPYRIGHT_ENTITY ||
    'Pacific Palms Community Association (PPCA)',

  /**
   * Public contact email. Empty default: the current site has no hardcoded
   * contact email in templates (contact flows are Netlify-form / Notion
   * driven) — this exists so future villages/templates have one place to set it.
   */
  contactEmail: import.meta.env.PUBLIC_CONTACT_EMAIL || '',

  /** Footer Acknowledgement of Country. */
  acknowledgement:
    import.meta.env.PUBLIC_ACKNOWLEDGEMENT_TEXT ||
    'We acknowledge the Worimi people as the traditional custodians of the land on which Smiths Lake Village is located. We pay our respects to Elders past, present and emerging.',

  /** Homepage hero (fallbacks when the Notion Section Settings row is absent). */
  heroTitle: import.meta.env.PUBLIC_HERO_TITLE || 'Welcome to Smiths Lake Village',
  heroSubtitle:
    import.meta.env.PUBLIC_HERO_SUBTITLE ||
    'A vibrant coastal community in the heart of Pacific Palms, NSW. Discover our pristine lake, native bushland, and welcoming neighbourhood.',
  heroImage: import.meta.env.PUBLIC_HERO_IMAGE || '/images/hero-smiths-lake.jpg',

  /** Water-level widget: enabled unless PUBLIC_WATER_WIDGET === 'off'. */
  waterWidgetEnabled: rawWaterWidget !== 'off',
  /** MHL gauge site number ('' when the widget is off). */
  waterGaugeId: rawWaterWidget === 'off' ? '' : rawWaterWidget,
  /** Gauge station label shown in widget attributions. */
  waterStation: import.meta.env.PUBLIC_WATER_STATION || 'Tarbuck Bay',

  /**
   * GA4 measurement id. Set to the string "off" to not load GA at all —
   * previews/other villages must NOT pollute Smiths Lake analytics.
   */
  gaId: import.meta.env.PUBLIC_GA_MEASUREMENT_ID || 'G-YRM5EQC0JM',

  /** Preview mode: noindex + "concept preview" banner on every page. */
  preview: (import.meta.env.PUBLIC_VILLAGE_PREVIEW || 'false') === 'true',

  /**
   * Theme colour overrides (CSS custom properties in src/styles/global.css).
   * Empty default = no override emitted, so default builds ship byte-identical
   * CSS. When set, BaseLayout emits an inline `:root { … }` override AFTER
   * global.css. Only the header/hero/footer/button accent tokens are themed
   * this way; the long tail of section accent hexes (Notion "Accent Colour"
   * options, per-section defaults in notion-section-settings.js) and one-off
   * literal hexes inside component styles stay Smiths Lake and are documented
   * as out of scope for env theming.
   */
  theme: {
    primary: import.meta.env.PUBLIC_THEME_PRIMARY || '',            // --color-navy  (#1B365D)
    primaryDark: import.meta.env.PUBLIC_THEME_PRIMARY_DARK || '',   // --color-navy-dark
    primaryLight: import.meta.env.PUBLIC_THEME_PRIMARY_LIGHT || '', // --color-navy-light
    accent: import.meta.env.PUBLIC_THEME_ACCENT || '',              // --color-golden (#F5A623)
    accentDark: import.meta.env.PUBLIC_THEME_ACCENT_DARK || '',     // --color-golden-dark
    accentLight: import.meta.env.PUBLIC_THEME_ACCENT_LIGHT || '',   // --color-golden-light
  },
};

/** CSS override block for BaseLayout — empty string when no theme vars are set. */
export function themeOverrideCss() {
  const map = {
    '--color-navy': village.theme.primary,
    '--color-navy-dark': village.theme.primaryDark,
    '--color-navy-light': village.theme.primaryLight,
    '--color-golden': village.theme.accent,
    '--color-golden-dark': village.theme.accentDark,
    '--color-golden-light': village.theme.accentLight,
  };
  const lines = Object.entries(map)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v};`);
  return lines.length ? `:root { ${lines.join(' ')} }` : '';
}

export default village;

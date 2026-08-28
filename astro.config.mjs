import { defineConfig } from 'astro/config';
// import sitemap from '@astrojs/sitemap';

export default defineConfig({
  // Per-village canonical origin (drives canonical URLs / og:url). Defaults to
  // the Smiths Lake flagship so builds with no env vars are unchanged.
  site: process.env.PUBLIC_SITE_URL || 'https://villagefirst.org.au',
  integrations: [],
  output: 'static',
  build: {
    format: 'directory'
  },
  vite: {
    build: {
      cssMinify: true
    }
  }
});

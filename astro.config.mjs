import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://villagefirst.org.au',
  integrations: [
    sitemap({
      filter: (page) => {
        // Exclude the manual sitemap page from XML sitemap
        return !page.includes('/sitemap/');
      }
    })
  ],
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

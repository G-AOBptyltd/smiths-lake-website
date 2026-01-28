import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  site: 'https://villagefirst.org.au',
  integrations: [
    sitemap({
      filter: (page) => {
        // Exclude debug pages and any undefined routes
        return page && !page.includes('/services-debug');
      },
      serialize(item) {
        // Additional safety check
        if (!item || !item.url) return null;
        return item;
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

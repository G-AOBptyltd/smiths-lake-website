// Generate Search Index Script
// Runs at build time to create searchable JSON index

import { fetchNotionContent } from '../lib/notion-unified.js';
import { getSmartIcon } from '../lib/icon-matcher.js';
import fs from 'fs';
import path from 'path';

// Normalise a Notion status (string or array) to a clean array of strings.
function statusArray(status) {
  if (Array.isArray(status)) return status.filter(Boolean);
  return status ? [status] : [];
}

async function generateSearchIndex() {
  try {
    console.log('📊 Generating search index...');

    // Fetch all published content
    const items = await fetchNotionContent();

    console.log(`Found ${items.length} published items`);

    // Only index items the site actually shows — mirror the sitemap's filter
    // (Published / Active), so search results match the public directory.
    const publishedItems = items.filter(item => {
      const accepted = ['Published', 'Active'];
      return statusArray(item.status).some(s => accepted.includes(s));
    });

    // Transform to a card-ready search index. The site-wide SearchBar renders
    // these fields directly into result cards under the bar (reusing the
    // sitemap card look), so include everything a card shows. The clickable
    // "Learn More" link mirrors the sitemap: website URL first, then document.
    const searchIndex = publishedItems.map(item => ({
      id: item.id,
      title: item.title,
      description: item.description || '',
      section: item.section || '',
      category: item.category || '',
      status: statusArray(item.status),
      recordType: item.recordType || '',
      yearEra: item.yearEra || '',
      address: item.address || '',
      operatingHours: item.operatingHours || '',
      contactPhone: (item.showContactPublicly === 'TRUE' && item.contactPhone) ? item.contactPhone : '',
      url: item.websiteUrl || item.documentUrl || '',
      linkIsExternal: !!item.documentUrl && !item.websiteUrl,
      icon: getSmartIcon(item),
      // Lowercased haystack for fast client-side matching.
      searchText: [
        item.title,
        item.description,
        item.category,
        item.section,
        item.address,
        item.operatingHours
      ].filter(Boolean).join(' ').toLowerCase()
    }));
    
    // Write to public directory
    const publicDir = path.join(process.cwd(), 'public');
    if (!fs.existsSync(publicDir)) {
      fs.mkdirSync(publicDir, { recursive: true });
    }
    
    const searchFile = path.join(publicDir, 'search.json');
    fs.writeFileSync(searchFile, JSON.stringify(searchIndex, null, 2));
    
    console.log(`✅ Search index generated: ${searchIndex.length} items`);
    console.log(`📝 Saved to: ${searchFile}`);
    
  } catch (error) {
    console.error('❌ Error generating search index:', error);
    
    // Create empty index as fallback
    const publicDir = path.join(process.cwd(), 'public');
    if (!fs.existsSync(publicDir)) {
      fs.mkdirSync(publicDir, { recursive: true });
    }
    
    const searchFile = path.join(publicDir, 'search.json');
    fs.writeFileSync(searchFile, JSON.stringify([], null, 2));
    
    console.log('⚠️  Created empty search index as fallback');
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  generateSearchIndex();
}

export default generateSearchIndex;

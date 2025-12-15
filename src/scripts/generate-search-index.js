// Generate Search Index Script
// Runs at build time to create searchable JSON index

import { fetchNotionContent } from '../lib/notion-unified.js';
import fs from 'fs';
import path from 'path';

const sectionSlugMap = {
  'Emergency & Safety': 'emergency',
  'Services': 'services',
  'Groups & Activities': 'groups',
  'Environment': 'environment',
  'History & Culture': 'history',
  'About Our Area': 'about'
};

async function generateSearchIndex() {
  try {
    console.log('📊 Generating search index...');
    
    // Fetch all published content
    const items = await fetchNotionContent();
    
    console.log(`Found ${items.length} published items`);
    
    // Transform to search index format
    const searchIndex = items.map(item => {
      const sectionSlug = sectionSlugMap[item.section] || 'home';
      const categorySlug = item.category?.toLowerCase().replace(/[^a-z0-9]+/g, '-') || '';
      
      return {
        id: item.id,
        title: item.title,
        description: item.description || '',
        section: item.section,
        category: item.category || '',
        slug: item.slug,
        url: `/${sectionSlug}/${categorySlug}/${item.slug}`,
        // Include searchable fields
        searchText: [
          item.title,
          item.description,
          item.category,
          item.contactPerson,
          item.meetingLocation
        ].filter(Boolean).join(' ').toLowerCase()
      };
    });
    
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

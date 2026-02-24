/**
 * Detail Pages - Notion Integration Layer
 * 
 * Enriches unified database items for use as standalone detail pages.
 * Auto-generates slugs from titles, maps section names to URL paths,
 * and structures data for the universal DetailPage component.
 * 
 * Works alongside existing systems:
 * - notion-unified.js: Raw data fetching
 * - notion-projects.js: Project Hub specialist handling (unchanged)
 * - notion-section-settings.js: Section hero images & colours
 * 
 * @version 1.0
 * @created February 2026
 */

import { fetchItemsBySection, fetchNotionContent } from './notion-unified.js';

/**
 * Section name → URL path mapping
 * Maps Notion section values to the folder structure in src/pages/
 */
const SECTION_TO_PATH = {
  'Groups & Activities': 'groups',
  'Services': 'services',
  'Services & Amenities': 'services',
  'Environment & Sustainability': 'environment',
  'Emergency & Safety': 'emergency',
  'History & Culture': 'history',
};

/**
 * Section name → parent page title mapping (for breadcrumbs)
 */
const SECTION_DISPLAY_NAMES = {
  'Groups & Activities': 'Groups & Activities',
  'Services': 'Services & Amenities',
  'Services & Amenities': 'Services & Amenities',
  'Environment & Sustainability': 'Environment & Sustainability',
  'Emergency & Safety': 'Emergency & Safety',
  'History & Culture': 'History & Culture',
};

/**
 * Section name → accent colour mapping (fallback if section settings unavailable)
 */
const SECTION_COLOURS = {
  'Groups & Activities': { hex: '#5B9BD5', name: 'Sky Blue' },
  'Services': { hex: '#1B365D', name: 'Navy Blue' },
  'Services & Amenities': { hex: '#1B365D', name: 'Navy Blue' },
  'Environment & Sustainability': { hex: '#16A34A', name: 'Green' },
  'Emergency & Safety': { hex: '#DC2626', name: 'Red' },
  'History & Culture': { hex: '#92400E', name: 'Brown' },
};

/**
 * Generate URL-safe slug from title
 * Ensures uniqueness by appending suffix if needed
 * 
 * @param {string} title - Item title
 * @returns {string} URL slug
 */
export function generateSlug(title) {
  if (!title) return 'untitled';
  
  return title
    .toLowerCase()
    .replace(/&/g, 'and')                    // & → and
    .replace(/['']/g, '')                     // Remove smart quotes
    .replace(/[^a-z0-9\s-]/g, '')            // Strip non-alphanumeric
    .replace(/\s+/g, '-')                     // Spaces to hyphens
    .replace(/-+/g, '-')                      // Collapse multiple hyphens
    .replace(/^-+|-+$/g, '')                  // Trim leading/trailing hyphens
    .substring(0, 80);                        // Reasonable max length
}

/**
 * Ensure slug uniqueness within a set of items
 * Appends -2, -3 etc. if duplicate slugs exist
 * 
 * @param {Array} items - Array of items with .slug property
 * @returns {Array} Items with unique slugs
 */
function ensureUniqueSlugs(items) {
  const slugCounts = {};
  
  return items.map(item => {
    let slug = item.slug;
    
    if (slugCounts[slug]) {
      slugCounts[slug]++;
      slug = `${slug}-${slugCounts[slug]}`;
    } else {
      slugCounts[slug] = 1;
    }
    
    return { ...item, slug };
  });
}

/**
 * Enrich a single item with detail page metadata
 * 
 * @param {Object} item - Raw item from notion-unified
 * @returns {Object} Enriched item ready for detail page rendering
 */
function enrichItemForDetailPage(item) {
  const section = item.section || '';
  const sectionPath = SECTION_TO_PATH[section] || 'content';
  const sectionDisplay = SECTION_DISPLAY_NAMES[section] || section;
  const sectionColour = SECTION_COLOURS[section] || { hex: '#1B365D', name: 'Navy Blue' };
  
  // Generate slug from title if not set
  const slug = item.slug || generateSlug(item.title);
  
  // Build the canonical URL path
  const detailUrl = `/${sectionPath}/${slug}/`;
  
  // Determine which sidebar sections to show based on available data
  const hasContact = !!(
    (item.contactPerson || item.contactEmail || item.contactPhone) && 
    item.showContactPublicly !== 'FALSE'
  );
  const hasDocuments = !!(item.documentUrl || item.groupInfoDocumentUrl);
  const hasLinks = !!(item.websiteUrl || item.facebookUrl);
  const hasLocation = !!(item.address || item.meetingLocation);
  const hasSchedule = !!(item.meetingDay || item.operatingHours || item.eventFrequency);
  
  // Build structured metadata based on section type
  const metadata = buildSectionMetadata(item, section);
  
  return {
    // Core
    ...item,
    slug,
    detailUrl,
    
    // Section context
    sectionPath,
    sectionDisplay,
    sectionColour,
    
    // Sidebar visibility flags
    hasContact,
    hasDocuments,
    hasLinks,
    hasLocation,
    hasSchedule,
    hasSidebar: hasContact || hasDocuments || hasLinks || hasLocation || hasSchedule,
    
    // Structured metadata for sidebar display
    metadata,
  };
}

/**
 * Build section-specific metadata for the sidebar
 * Different sections show different fields
 * 
 * @param {Object} item - Raw item
 * @param {string} section - Section name
 * @returns {Array} Array of { label, value, icon, type } objects
 */
function buildSectionMetadata(item, section) {
  const meta = [];
  
  // === Universal fields (shown for all sections) ===
  if (item.category) {
    meta.push({ label: 'Category', value: item.category, icon: '📂', type: 'text' });
  }
  
  if (Array.isArray(item.status) && item.status.length > 0) {
    meta.push({ label: 'Status', value: item.status.join(', '), icon: '🏷️', type: 'badges' });
  }
  
  // === Section-specific fields ===
  switch (section) {
    case 'Groups & Activities':
      if (item.meetingDay) meta.push({ label: 'Meeting Day', value: item.meetingDay, icon: '📅', type: 'text' });
      if (item.meetingLocation) meta.push({ label: 'Location', value: item.meetingLocation, icon: '📍', type: 'text' });
      if (item.eventFrequency) {
        const freq = Array.isArray(item.eventFrequency) ? item.eventFrequency.join(', ') : item.eventFrequency;
        meta.push({ label: 'Frequency', value: freq, icon: '🔄', type: 'text' });
      }
      if (item.relatedPeople) meta.push({ label: 'Contact Person', value: item.relatedPeople, icon: '👤', type: 'text' });
      break;
      
    case 'Services':
    case 'Services & Amenities':
      if (item.serviceType) meta.push({ label: 'Service Type', value: item.serviceType, icon: '🏢', type: 'text' });
      if (item.operatingHours) meta.push({ label: 'Hours', value: item.operatingHours, icon: '🕐', type: 'text' });
      if (item.address) meta.push({ label: 'Address', value: item.address, icon: '📍', type: 'text' });
      if (item.accessibilityInfo) meta.push({ label: 'Accessibility', value: item.accessibilityInfo, icon: '♿', type: 'text' });
      break;
      
    case 'Environment & Sustainability':
      if (item.conservationStatus) meta.push({ label: 'Conservation Status', value: item.conservationStatus, icon: '🌿', type: 'text' });
      if (item.locationArea) meta.push({ label: 'Location', value: item.locationArea, icon: '📍', type: 'text' });
      if (item.season) meta.push({ label: 'Season', value: item.season, icon: '🗓️', type: 'text' });
      if (item.partnerOrganisations) meta.push({ label: 'Partners', value: item.partnerOrganisations, icon: '🤝', type: 'text' });
      break;
      
    case 'Emergency & Safety':
      if (item.emergencyPhone) meta.push({ label: 'Emergency Phone', value: item.emergencyPhone, icon: '📞', type: 'phone' });
      if (item.alertLevel && item.alertLevel !== 'Normal') meta.push({ label: 'Alert Level', value: item.alertLevel, icon: '⚠️', type: 'alert' });
      if (item.address) meta.push({ label: 'Address', value: item.address, icon: '📍', type: 'text' });
      break;
      
    case 'History & Culture':
      if (item.yearEra) meta.push({ label: 'Period', value: item.yearEra, icon: '📜', type: 'text' });
      if (item.historicalCategory) meta.push({ label: 'Category', value: item.historicalCategory, icon: '🏛️', type: 'text' });
      if (item.sourceAttribution) meta.push({ label: 'Source', value: item.sourceAttribution, icon: '📖', type: 'text' });
      if (item.relatedPeople) meta.push({ label: 'Related People', value: item.relatedPeople, icon: '👥', type: 'text' });
      break;
  }
  
  return meta;
}

/**
 * Fetch all items for a section, enriched for detail pages
 * Returns items with slugs, URLs, and structured metadata
 * 
 * @param {string} sectionName - Notion section name (e.g. 'Groups & Activities')
 * @returns {Promise<Array>} Enriched items
 */
export async function fetchDetailPageItems(sectionName) {
  try {
    const items = await fetchItemsBySection(sectionName, true);
    
    // Enrich each item
    const enriched = items.map(enrichItemForDetailPage);
    
    // Ensure unique slugs within this section
    return ensureUniqueSlugs(enriched);
  } catch (error) {
    console.error(`Error fetching detail page items for ${sectionName}:`, error.message);
    return [];
  }
}

/**
 * Fetch a single item by its slug within a section
 * 
 * @param {string} sectionName - Notion section name
 * @param {string} slug - URL slug to match
 * @returns {Promise<Object|null>} Enriched item or null
 */
export async function fetchDetailPageBySlug(sectionName, slug) {
  const items = await fetchDetailPageItems(sectionName);
  return items.find(item => item.slug === slug) || null;
}

/**
 * Fetch ALL items across all sections (for sitemap generation, etc.)
 * 
 * @returns {Promise<Array>} All enriched items from all sections
 */
export async function fetchAllDetailPageItems() {
  const sections = Object.keys(SECTION_TO_PATH);
  const uniqueSections = [...new Set(sections)];
  
  const allItems = [];
  for (const section of uniqueSections) {
    const items = await fetchDetailPageItems(section);
    allItems.push(...items);
  }
  
  return allItems;
}

/**
 * Get section path from Notion section name
 */
export function getSectionPath(sectionName) {
  return SECTION_TO_PATH[sectionName] || 'content';
}

/**
 * Get section display name
 */
export function getSectionDisplayName(sectionName) {
  return SECTION_DISPLAY_NAMES[sectionName] || sectionName;
}

export default {
  fetchDetailPageItems,
  fetchDetailPageBySlug,
  fetchAllDetailPageItems,
  generateSlug,
  getSectionPath,
  getSectionDisplayName,
};

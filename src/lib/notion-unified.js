// Unified Notion Library for PPCA Website
// Fetches content from single unified database with proper field handling

import { Client } from '@notionhq/client';
import fs from 'fs';
import path from 'path';

const notion = new Client({
  auth: process.env.NOTION_API_KEY,
});

const DATABASE_ID = process.env.NOTION_DATABASE_ID;
const CACHE_DIR = path.join(process.cwd(), '.cache');
const CACHE_FILE = path.join(CACHE_DIR, 'notion-data.json');

// Ensure cache directory exists
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

/**
 * Parse Notion property to usable value
 */
function parseProperty(property) {
  if (!property) return null;
  
  switch (property.type) {
    case 'title':
      return property.title[0]?.plain_text || '';
    case 'rich_text':
      return property.rich_text[0]?.plain_text || '';
    case 'select':
      return property.select?.name || null;
    case 'multi_select':
      return property.multi_select?.map(s => s.name) || [];
    case 'status':
      return property.status?.name || null;
    case 'checkbox':
      return property.checkbox || false;
    case 'number':
      return property.number || null;
    case 'url':
      return property.url || null;
    case 'email':
      return property.email || null;
    case 'phone_number':
      return property.phone_number || null;
    case 'date':
      return property.date?.start || null;
    case 'formula':
      // Handle formula result based on type
      if (property.formula?.type === 'string') {
        return property.formula.string || '';
      }
      return null;
    case 'created_time':
      return property.created_time || null;
    case 'last_edited_time':
      return property.last_edited_time || null;
    default:
      return null;
  }
}

/**
 * Parse Notion page to content item
 */
function parseNotionPage(page) {
  const props = page.properties;
  
  return {
    id: page.id,
    
    // Core fields
    title: parseProperty(props.Title),
    section: parseProperty(props.Section),
    category: parseProperty(props.Category),
    description: parseProperty(props.Description),
    status: parseProperty(props.Status),
    showOnWebsite: parseProperty(props['Show on Website']),
    slug: parseProperty(props.Slug),
    priorityOrder: parseProperty(props['Priority Order']) || 999,
    notes: parseProperty(props.Notes),
    
    // Meeting fields
    meetingDay: parseProperty(props['Meeting Day']),
    meetingTime: parseProperty(props['Meeting Time']),
    meetingLocation: parseProperty(props['Meeting Location']),
    
    // Contact fields
    contactPerson: parseProperty(props['Contact Person']),
    contactEmail: parseProperty(props['Contact Email']),
    contactPhone: parseProperty(props['Contact Phone']),
    showContactPublicly: parseProperty(props['Show Contact Publicly']),
    
    // Link fields
    websiteUrl: parseProperty(props['Website URL']),
    facebookUrl: parseProperty(props['Facebook URL']),
    
    // Document fields
    driveFolderId: parseProperty(props['Google Drive Folder ID']),
    logoFilename: parseProperty(props['Logo Filename']),
    
    // Emergency fields
    emergencyPhone: parseProperty(props['Emergency Phone']),
    alertLevel: parseProperty(props['Alert Level']),
    
    // Service fields
    serviceType: parseProperty(props['Service Type']),
    operatingHours: parseProperty(props['Operating Hours']),
    address: parseProperty(props['Address']),
    accessibilityInfo: parseProperty(props['Accessibility Info']),
    
    // Environment fields
    conservationStatus: parseProperty(props['Conservation Status']),
    locationArea: parseProperty(props['Location Area']),
    season: parseProperty(props['Season']),
    partnerOrganisations: parseProperty(props['Partner Organisations']),
    
    // History fields
    yearEra: parseProperty(props['Year Era']),
    historicalCategory: parseProperty(props['Historical Category']),
    sourceAttribution: parseProperty(props['Source Attribution']),
    relatedPeople: parseProperty(props['Related People']),
    
    // Timestamps
    createdTime: parseProperty(props['Created Time']),
    lastEditedTime: parseProperty(props['Last Edited Time']),
  };
}

/**
 * Fetch all items from unified database with optional filters
 */
export async function fetchNotionContent(filters = {}) {
  try {
    // Build Notion filter
    const notionFilter = {
      and: [
        {
          property: 'Show on Website',
          select: {
            equals: 'TRUE'
          }
        }
      ]
    };
    
    // Add section filter if provided
    if (filters.section) {
      notionFilter.and.push({
        property: 'Section',
        select: {
          equals: filters.section
        }
      });
    }
    
    // Add category filter if provided
    if (filters.category) {
      notionFilter.and.push({
        property: 'Category',
        select: {
          equals: filters.category
        }
      });
    }
    
    // Query database
    const response = await notion.databases.query({
      database_id: DATABASE_ID,
      filter: notionFilter,
      sorts: [
        {
          property: 'Priority Order',
          direction: 'ascending'
        }
      ]
    });
    
    // Parse pages
    const items = response.results.map(parseNotionPage);
    
    // Cache successful fetch
    try {
      fs.writeFileSync(CACHE_FILE, JSON.stringify({
        timestamp: new Date().toISOString(),
        data: items,
        filters: filters
      }, null, 2));
    } catch (cacheError) {
      console.warn('Failed to write cache:', cacheError.message);
    }
    
    return items;
    
  } catch (error) {
    console.error('Error fetching from Notion:', error.message);
    
    // Try to use cached data
    if (fs.existsSync(CACHE_FILE)) {
      console.log('Using cached Notion data');
      const cached = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
      
      // Filter cached data if filters provided
      let data = cached.data;
      if (filters.section) {
        data = data.filter(item => item.section === filters.section);
      }
      if (filters.category) {
        data = data.filter(item => item.category === filters.category);
      }
      
      return data;
    }
    
    throw error;
  }
}

/**
 * Fetch items by section
 */
export async function fetchItemsBySection(sectionName) {
  return fetchNotionContent({ section: sectionName });
}

/**
 * Fetch items by section and category
 */
export async function fetchItemsBySectionAndCategory(sectionName, categoryName) {
  return fetchNotionContent({ section: sectionName, category: categoryName });
}

/**
 * Fetch single item by slug
 */
export async function fetchItemBySlug(slug) {
  const allItems = await fetchNotionContent();
  return allItems.find(item => item.slug === slug);
}

/**
 * Get all unique slugs for static path generation
 */
export async function getAllSlugs() {
  const items = await fetchNotionContent();
  return items.map(item => ({
    slug: item.slug,
    section: item.section,
    category: item.category
  }));
}

/**
 * Check if there are any emergency alerts
 */
export async function checkEmergencyAlerts() {
  const emergencyItems = await fetchItemsBySection('Emergency & Safety');
  
  // Find highest priority alert
  const alerts = emergencyItems
    .filter(item => item.alertLevel && item.alertLevel !== 'Normal')
    .sort((a, b) => {
      const priority = {
        'Emergency': 3,
        'Warning': 2,
        'Watch': 1
      };
      return (priority[b.alertLevel] || 0) - (priority[a.alertLevel] || 0);
    });
  
  if (alerts.length === 0) return null;
  
  return {
    level: alerts[0].alertLevel,
    items: alerts
  };
}

export default {
  fetchNotionContent,
  fetchItemsBySection,
  fetchItemsBySectionAndCategory,
  fetchItemBySlug,
  getAllSlugs,
  checkEmergencyAlerts
};

// Unified Notion Library for PPCA Website
// Fetches content from single unified database with proper field handling
// UPDATED 2026-01-21: Field name changes (Status on Web, Status/Stage/Phase)

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
 * Helper: safely get the first existing property from a list of candidate names
 */
function getFirstExistingProp(props, candidates = []) {
  for (const key of candidates) {
    if (props?.[key]) return props[key];
  }
  return null;
}

/**
 * Parse Notion property to usable value
 */
function parseProperty(property) {
  if (!property) return null;

  switch (property.type) {
    case 'title':
      return property.title?.[0]?.plain_text || '';
    case 'rich_text':
      return property.rich_text?.[0]?.plain_text || '';
    case 'select':
      return property.select?.name || null;
    case 'multi_select':
      return property.multi_select?.map((s) => s.name) || [];
    case 'status':
      return property.status?.name || null;
    case 'checkbox':
      return property.checkbox || false;
    case 'number':
      return property.number ?? null;
    case 'url':
      return property.url || null;
    case 'email':
      return property.email || null;
    case 'phone_number':
      return property.phone_number || null;
    case 'date':
      return property.date?.start || null;
    case 'formula':
      if (property.formula?.type === 'string') return property.formula.string || '';
      if (property.formula?.type === 'number') return property.formula.number ?? null;
      if (property.formula?.type === 'boolean') return property.formula.boolean || false;
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
  const props = page.properties || {};

  // ✅ NEW: Parse Status on Web (replaces Show on Website)
  const statusOnWeb = parseProperty(props['Status on Web']);
  
  // ✅ NEW: Parse Status / Stage / Phase (replaces Status)
  // Keep as array (multi-select) for displaying multiple badges publicly
  const statusStagePhase = parseProperty(props['Status / Stage / Phase']) || [];

  // ✅ Robust Groups Info/Docs link mapping
  const groupInfoDocProp = getFirstExistingProp(props, [
    'Group Info Document',
    'Group Info Document URL',
    'Group Info Doc',
    'Info / Docs',
    'Info Docs Link',
  ]);

  return {
    id: page.id,

    // Core fields
    title: parseProperty(props.Title),
    section: parseProperty(props.Section),
    category: parseProperty(props.Category),
    description: parseProperty(props.Description),
    
    // ✅ NEW: Updated status fields
    statusOnWeb: statusOnWeb, // "Published", "Approved", "Pending", "UnPublished"
    status: statusStagePhase, // Array: ["Active", "Open to New Participants", etc.]
    
    slug: parseProperty(props.Slug),
    priorityOrder: parseProperty(props['Priority Order']) || 999,
    priority: parseProperty(props.Priority), // ✅ NEW field
    notes: parseProperty(props.Notes),

    // Meeting fields
    meetingDay: parseProperty(props['Meeting Day']),
    meetingTime: parseProperty(props['Meeting Time']),
    meetingLocation: parseProperty(props['Meeting Location']),
    
    // ✅ NEW: Event scheduling fields (now extracted)
    eventFrequency: parseProperty(props['Event Frequency']),
    eventCycle: parseProperty(props['Event Cycle']),

    // Contact fields
    contactPerson: parseProperty(props['Contact Person']),
    contactEmail: parseProperty(props['Contact Email']),
    contactPhone: parseProperty(props['Contact Phone']),
    showContactPublicly: parseProperty(props['Show Contact Publicly']),

    // Link fields
    websiteUrl: parseProperty(props['Website URL']),
    facebookUrl: parseProperty(props['Facebook URL']),
    documentUrl: parseProperty(props['Document URL']),

    // Groups - per-card info/docs link
    groupInfoDocumentUrl: parseProperty(groupInfoDocProp),

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
    accessibilityFeatures: parseProperty(props['Accessibility Info']),

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
    recordType: parseProperty(props['Record Type']),
    
    // Card display control fields (universal - can be used by any section)
    cardTemplate: parseProperty(props['Card Template']),
    cardOptions: parseProperty(props['Card Options']),

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
    // Build filter conditions dynamically
    const filterConditions = [];
    
    // ✅ UPDATED: Filter by "Status on Web" (default: only show "Published" items)
    if (filters.requireShowOnWebsite !== false) {
      filterConditions.push({
        property: 'Status on Web',
        select: {
          equals: 'Published',
        },
      });
    }

    // Add section filter
    if (filters.section) {
      filterConditions.push({
        property: 'Section',
        select: {
          equals: filters.section,
        },
      });
    }

    // Add category filter
    if (filters.category) {
      filterConditions.push({
        property: 'Category',
        select: {
          equals: filters.category,
        },
      });
    }

    // NOTE: We don't filter by Status / Stage / Phase in the Notion API query
    // because it's a multi-select field used for PUBLIC DISPLAY of all statuses
    // All status values should be shown as badges to website visitors

    const notionFilter = filterConditions.length > 0 
      ? { and: filterConditions }
      : undefined;

    const response = await notion.databases.query({
      database_id: DATABASE_ID,
      filter: notionFilter,
      sorts: [
        {
          property: 'Priority Order',
          direction: 'ascending',
        },
      ],
    });

    let items = response.results.map(parseNotionPage);

    // ✅ REMOVED: Status filtering after parsing
    // Status / Stage / Phase is for public display, not filtering
    // All items with Status on Web = "Published" should appear

    // Cache the results
    try {
      fs.writeFileSync(
        CACHE_FILE,
        JSON.stringify(
          {
            timestamp: new Date().toISOString(),
            data: items,
            filters: filters,
          },
          null,
          2
        )
      );
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

      let data = cached.data || [];
      
      // Apply filters to cached data
      if (filters.section) {
        data = data.filter((item) => item.section === filters.section);
      }
      if (filters.category) {
        data = data.filter((item) => item.category === filters.category);
      }
      // ✅ UPDATED: Filter by Status on Web
      if (filters.requireShowOnWebsite !== false) {
        data = data.filter((item) => item.statusOnWeb === 'Published');
      }

      return data;
    }

    throw error;
  }
}

/**
 * Fetch items by section (default: requires Status on Web = "Published")
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
 * ✅ DEPRECATED: This function is no longer needed
 * Status / Stage / Phase is for public display, not filtering
 * Keeping for backward compatibility but now just calls fetchItemsBySection
 */
export async function fetchItemsBySectionWithStatuses(sectionName, acceptedStatuses) {
  console.warn('fetchItemsBySectionWithStatuses is deprecated - Status/Stage/Phase is for display only');
  return fetchNotionContent({ section: sectionName });
}

/**
 * Fetch item by slug
 */
export async function fetchItemBySlug(slug) {
  const allItems = await fetchNotionContent({ requireShowOnWebsite: false });
  return allItems.find((item) => item.slug === slug);
}

/**
 * Get all slugs for static page generation
 */
export async function getAllSlugs() {
  const items = await fetchNotionContent();
  return items.map((item) => ({
    slug: item.slug,
    section: item.section,
    category: item.category,
  }));
}

/**
 * Check for emergency alerts
 */
export async function checkEmergencyAlerts() {
  const emergencyItems = await fetchItemsBySection('Emergency & Safety');

  const alerts = emergencyItems
    .filter((item) => item.alertLevel && item.alertLevel !== 'Normal')
    .sort((a, b) => {
      const priority = { Emergency: 3, Warning: 2, Watch: 1 };
      return (priority[b.alertLevel] || 0) - (priority[a.alertLevel] || 0);
    });

  if (alerts.length === 0) return null;

  return {
    level: alerts[0].alertLevel,
    items: alerts,
  };
}

export default {
  fetchNotionContent,
  fetchItemsBySection,
  fetchItemsBySectionAndCategory,
  fetchItemsBySectionWithStatuses,
  fetchItemBySlug,
  getAllSlugs,
  checkEmergencyAlerts,
};

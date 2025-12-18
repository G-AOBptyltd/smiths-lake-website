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

  // ✅ Robust Groups Info/Docs link mapping (handles a few possible column name variants)
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

    // ✅ Groups - per-card info/docs link (Notion URL property)
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
    accessibilityFeatures: parseProperty(props['Accessibility Info']), // optional alias

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
    const notionFilter = {
      and: [
        {
          property: 'Show on Website',
          select: {
            equals: 'TRUE',
          },
        },
      ],
    };

    if (filters.section) {
      notionFilter.and.push({
        property: 'Section',
        select: {
          equals: filters.section,
        },
      });
    }

    if (filters.category) {
      notionFilter.and.push({
        property: 'Category',
        select: {
          equals: filters.category,
        },
      });
    }

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

    const items = response.results.map(parseNotionPage);

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

    if (fs.existsSync(CACHE_FILE)) {
      console.log('Using cached Notion data');
      const cached = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));

      let data = cached.data || [];
      if (filters.section) data = data.filter((item) => item.section === filters.section);
      if (filters.category) data = data.filter((item) => item.category === filters.category);

      return data;
    }

    throw error;
  }
}

export async function fetchItemsBySection(sectionName) {
  return fetchNotionContent({ section: sectionName });
}

export async function fetchItemsBySectionAndCategory(sectionName, categoryName) {
  return fetchNotionContent({ section: sectionName, category: categoryName });
}

export async function fetchItemBySlug(slug) {
  const allItems = await fetchNotionContent();
  return allItems.find((item) => item.slug === slug);
}

export async function getAllSlugs() {
  const items = await fetchNotionContent();
  return items.map((item) => ({
    slug: item.slug,
    section: item.section,
    category: item.category,
  }));
}

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
  fetchItemBySlug,
  getAllSlugs,
  checkEmergencyAlerts,
};

// Unified Notion Library for PPCA Website
// Fetches content from single unified database with proper field handling
// UPDATED 2026-01-28: COMPLETE FIX - Checks BOTH Show on Website AND Status on Web
// - Fixed inverted requireShowOnWebsite logic (line 213)
// - Added OR condition to check both legacy and new status fields
// - Fixed fetchItemsBySection to pass requireShowOnWebsite parameter

import { Client } from '@notionhq/client';
import fs from 'fs';
import path from 'path';
import { resilientFetch } from './notion-fetch.js';
import { queryAllPages } from './notion-query-all.js';

const notion = new Client({
  auth: process.env.NOTION_API_KEY,
  fetch: resilientFetch,
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
      // Join ALL segments, exactly like rich_text below. Notion splits a title
      // into a new segment at every formatting boundary, so reading only [0]
      // truncated any title containing bold/italic/link/code at the first such
      // boundary. Live example: the Notion title
      //   "**Lilly Pilly Glade:** New seating and rest area ... foreshore"
      // rendered as the dangling headline "Lilly Pilly Glade:" and produced the
      // slug /news/lilly-pilly-glade/ instead of the full-title slug.
      return property.title?.map(t => t.plain_text).join('') || '';
    case 'rich_text':
      return property.rich_text?.map(t => t.plain_text).join('') || '';
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
    case 'files':
      // Handle file attachments - return array of file objects
      return property.files?.map(f => ({
        name: f.name,
        url: f.file?.url || f.external?.url || null
      })) || [];
    default:
      return null;
  }
}

/**
 * Parse Notion page to content item
 */
function parseNotionPage(page) {
  const props = page.properties || {};

  // Parse Status on Web (replaces Show on Website)
  const statusOnWeb = parseProperty(props['Status on Web']);
  
  // Parse Status / Stage / Phase (multi-select for public display)
  const statusStagePhase = parseProperty(props['Status / Stage / Phase']) || [];

  // Robust Groups Info/Docs link mapping
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
    
    // Status fields
    statusOnWeb: statusOnWeb,
    showOnWebsite: parseProperty(props['Show on Website']), // Keep legacy field for compatibility
    status: statusStagePhase,
    
    slug: parseProperty(props.Slug),
    priorityOrder: parseProperty(props['Priority Order']) || 999,
    priority: parseProperty(props.Priority),
    notes: parseProperty(props.Notes),

    // Meeting fields
    meetingDay: parseProperty(props['Meeting Day']),
    meetingTime: parseProperty(props['Meeting Time']),
    meetingLocation: parseProperty(props['Meeting Location']),
    
    // Event scheduling fields
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
    
    // Card display control fields
    cardTemplate: parseProperty(props['Card Template']),
    cardOptions: parseProperty(props['Card Options']),

    // ========== PROJECT HUB SPECIFIC FIELDS ==========
    projhubAboutContent: parseProperty(props['ProjHub About Content']),
    projhubChangesContent: parseProperty(props['ProjHub Changes Content']),
    projhubFAQsContent: parseProperty(props['ProjHub FAQs Content']),
    submissionDeadline: parseProperty(props['Submission Deadline']),
    feature: parseProperty(props['Feature']),
    documentTitle: parseProperty(props['Document Title']),
    documentSize: parseProperty(props['Document Size']),
    heroImageFile: parseProperty(props['Hero Image File']),
    mailchimpTag: parseProperty(props['MailChimp Tag']),
    submissionOpens: parseProperty(props['Submission Opens']),
    engagementViews: parseProperty(props['Engagement Views']),
    surveyToolUrl: parseProperty(props['Survey URL']),
    resultsSnapshotUrl: parseProperty(props['Results URL']),
    // ========== END PROJECT HUB FIELDS ==========

    // News feed control (added Jun 2026 — deliberate publishing, replaces last-edited-time proxy)
    publishDate: parseProperty(props['Publish Date']),
    showInNewsFeed: parseProperty(props['Show in News Feed']) || false,
    // Stable image URL from the News Desk Blobs uploader (news-image.js).
    // Preferred over the build-time Hero Image File manifest; never expires.
    imageUrl: parseProperty(props['Image URL']),

    // Timestamps (custom Notion properties, may be null if not in database)
    createdTime: parseProperty(props['Created Time']),
    lastEditedTime: parseProperty(props['Last Edited Time']),

    // Top-level Notion timestamps — always available on every page
    notionCreatedTime: page.created_time,
    notionLastEditedTime: page.last_edited_time,
  };
}

/**
 * In-process memo of the whole database for one build.
 *
 * WHY: 18 call sites across the site (every section index, every [slug] route,
 * the homepage, news, sitemap, search index) each used to issue their own Notion
 * query. Adding pagination doubled that to ~36 requests per build, and with
 * several Netlify builds running concurrently that tipped the workspace over
 * Notion's public API rate limit — HTTP 429, which fails the whole deploy.
 *
 * Every one of those call sites wants a subset of the SAME table, so fetch it
 * once per process and filter in memory. Net effect: ~36 requests → 1 query
 * (2 pages), well below even the original un-paginated behaviour.
 *
 * Content is read at build time and the process is short-lived, so there is no
 * staleness risk — a new build always starts with an empty memo.
 */
let _allRowsPromise = null;

async function fetchAllRowsOnce() {
  if (_allRowsPromise) return _allRowsPromise;

  // Store the promise, not the result, so concurrent callers share one request
  // instead of racing and each firing their own.
  _allRowsPromise = (async () => {
    const results = await queryAllPages(notion, {
      database_id: DATABASE_ID,
      sorts: [
        {
          property: 'Priority Order',
          direction: 'ascending',
        },
      ],
    });
    return results.map(parseNotionPage);
  })();

  try {
    return await _allRowsPromise;
  } catch (err) {
    // Never memoise a failure — a transient 429 must not poison the whole build.
    _allRowsPromise = null;
    throw err;
  }
}

/** Apply the same filters in memory that we used to push down to Notion. */
function applyFilters(items, filters = {}) {
  let data = items;
  if (filters.requireShowOnWebsite === true) {
    data = data.filter(
      (item) => item.statusOnWeb === 'Published' || item.showOnWebsite === 'TRUE'
    );
  }
  if (filters.section) data = data.filter((item) => item.section === filters.section);
  if (filters.category) data = data.filter((item) => item.category === filters.category);
  return data;
}

/**
 * Fetch all items from unified database with optional filters
 */
export async function fetchNotionContent(filters = {}) {
  try {
    const allItems = await fetchAllRowsOnce();
    const items = applyFilters(allItems, filters);

    // Cache the FULL row set, not the filtered view — the fallback path below
    // re-applies filters itself, and caching a narrow slice would starve every
    // other call site that later falls back to it.
    try {
      fs.writeFileSync(
        CACHE_FILE,
        JSON.stringify(
          {
            timestamp: new Date().toISOString(),
            data: allItems,
            filters: {},
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
      
      // Apply filters to cached data (FIXED: check both fields)
      if (filters.section) {
        data = data.filter((item) => item.section === filters.section);
      }
      if (filters.category) {
        data = data.filter((item) => item.category === filters.category);
      }
      if (filters.requireShowOnWebsite === true) {
        data = data.filter((item) => 
          item.statusOnWeb === 'Published' || item.showOnWebsite === 'TRUE'
        );
      }

      return data;
    }

    throw error;
  }
}

/**
 * Fetch items by section
 * UPDATED: Now filters for Published items by default
 * Checks BOTH "Status on Web" AND "Show on Website" for compatibility
 * 
 * @param {string} sectionName - The section to filter by
 * @param {boolean} requireShowOnWebsite - Whether to filter by Published status (default: true)
 * @returns {Promise<Array>} Array of items from the section
 */
export async function fetchItemsBySection(sectionName, requireShowOnWebsite = true) {
  return fetchNotionContent({ 
    section: sectionName,
    requireShowOnWebsite: requireShowOnWebsite 
  });
}

/**
 * Fetch items by section and category
 * UPDATED: Now filters for Published items by default
 * Checks BOTH "Status on Web" AND "Show on Website" for compatibility
 * 
 * @param {string} sectionName - The section to filter by
 * @param {string} categoryName - The category to filter by
 * @param {boolean} requireShowOnWebsite - Whether to filter by Published status (default: true)
 * @returns {Promise<Array>} Array of items matching section and category
 */
export async function fetchItemsBySectionAndCategory(sectionName, categoryName, requireShowOnWebsite = true) {
  return fetchNotionContent({ 
    section: sectionName, 
    category: categoryName,
    requireShowOnWebsite: requireShowOnWebsite 
  });
}

/**
 * Fetch items by section with statuses (deprecated - kept for compatibility)
 */
export async function fetchItemsBySectionWithStatuses(sectionName, acceptedStatuses) {
  console.warn('fetchItemsBySectionWithStatuses is deprecated - Status/Stage/Phase is for display only');
  return fetchNotionContent({ section: sectionName, requireShowOnWebsite: true });
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
  const items = await fetchNotionContent({ requireShowOnWebsite: true });
  return items.map((item) => ({
    slug: item.slug,
    section: item.section,
    category: item.category,
  }));
}

/**
 * Check for emergency alerts
 * Only shows Published emergency items
 */
export async function checkEmergencyAlerts() {
  const emergencyItems = await fetchItemsBySection('Emergency & Safety', true);

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

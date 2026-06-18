/**
 * Section Settings - Notion Integration
 * Fetches section-level configuration from the Section Settings database
 * Used for hero images, accent colours, titles, and subtitles per section
 * 
 * @version 1.0
 * @created February 2026
 */

import { Client } from '@notionhq/client';
import fs from 'fs';
import path from 'path';
import { resilientFetch } from './notion-fetch.js';

const notion = new Client({
  auth: process.env.NOTION_API_KEY,
  fetch: resilientFetch,
});

// Section Settings database ID
const SECTION_SETTINGS_DB = process.env.NOTION_SECTION_SETTINGS_DB;

const CACHE_DIR = path.join(process.cwd(), '.cache');
const CACHE_FILE = path.join(CACHE_DIR, 'section-settings.json');

// Ensure cache directory exists
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

/**
 * Default section settings (used as fallback when Notion is unavailable)
 */
const DEFAULT_SECTIONS = {
  home: {
    sectionName: 'Home',
    slug: 'home',
    heroTitle: 'Welcome to Smiths Lake Village',
    heroSubtitle: 'A vibrant coastal community in the heart of Pacific Palms, NSW. Discover our pristine lake, native bushland, and welcoming neighbourhood.',
    accentColour: 'Navy Blue',
    accentHex: '#1B365D',
    overlayOpacity: 50,
    heroImage: null,
  },
  about: {
    sectionName: 'About',
    slug: 'about',
    heroTitle: 'About Us',
    heroSubtitle: 'Discover what makes Smiths Lake Village a special place to live, work and visit.',
    accentColour: 'Golden Orange',
    accentHex: '#F5A623',
    overlayOpacity: 50,
    heroImage: null,
  },
  projects: {
    sectionName: 'Project Hub',
    slug: 'projects',
    heroTitle: 'Have Your Say',
    heroSubtitle: 'Your feedback helps shape decisions that affect our community.',
    accentColour: 'Navy Blue',
    accentHex: '#1B365D',
    overlayOpacity: 50,
    heroImage: null,
  },
  environment: {
    sectionName: 'Environment & Sustainability',
    slug: 'environment',
    heroTitle: 'Environment & Sustainability',
    heroSubtitle: 'Lake health monitoring, foreshore management, wildlife conservation, and environmental programs protecting our natural assets.',
    accentColour: 'Green',
    accentHex: '#16A34A',
    overlayOpacity: 50,
    heroImage: null,
  },
  services: {
    sectionName: 'Services',
    slug: 'services',
    heroTitle: 'Services & Amenities',
    heroSubtitle: 'Facilities, amenities, and community projects in Smiths Lake Village.',
    accentColour: 'Navy Blue',
    accentHex: '#1B365D',
    overlayOpacity: 50,
    heroImage: null,
  },
  groups: {
    sectionName: 'Groups & Activities',
    slug: 'groups',
    heroTitle: 'Groups & Activities',
    heroSubtitle: 'Join our vibrant community through clubs, groups, and volunteering.',
    accentColour: 'Sky Blue',
    accentHex: '#5B9BD5',
    overlayOpacity: 50,
    heroImage: null,
  },
  history: {
    sectionName: 'History & Culture',
    slug: 'history',
    heroTitle: 'History & Culture',
    heroSubtitle: 'Discover the stories that shaped our community.',
    accentColour: 'Brown',
    accentHex: '#92400E',
    overlayOpacity: 50,
    heroImage: null,
  },
  emergency: {
    sectionName: 'Emergency & Safety',
    slug: 'emergency',
    heroTitle: 'Emergency & Safety',
    heroSubtitle: 'Emergency services, evacuation plans, and safety information for the Smiths Lake community.',
    accentColour: 'Red',
    accentHex: '#DC2626',
    overlayOpacity: 50,
    heroImage: null,
  },
};

/**
 * Accent colour name to hex mapping
 */
const COLOUR_MAP = {
  'Navy Blue': '#1B365D',
  'Sky Blue': '#5B9BD5',
  'Golden Orange': '#F5A623',
  'Red': '#DC2626',
  'Green': '#16A34A',
  'Brown': '#92400E',
  'Purple': '#9333EA',
};

/**
 * Parse a Notion property to a usable value
 */
function parseProperty(property) {
  if (!property) return null;
  switch (property.type) {
    case 'title':
      return property.title?.[0]?.plain_text || '';
    case 'rich_text':
      return property.rich_text?.map(t => t.plain_text).join('') || '';
    case 'select':
      return property.select?.name || null;
    case 'number':
      return property.number ?? null;
    case 'files':
      return property.files?.map(f => ({
        name: f.name,
        url: f.file?.url || f.external?.url || null,
      })) || [];
    case 'last_edited_time':
      return property.last_edited_time || null;
    default:
      return null;
  }
}

/**
 * Extract first image URL from a files field
 */
function extractImageUrl(filesField) {
  if (!filesField) return null;
  if (Array.isArray(filesField) && filesField.length > 0) {
    return filesField[0].url || null;
  }
  return null;
}

/**
 * Parse a Notion page from the Section Settings database
 */
function parseSectionSettingsPage(page) {
  const props = page.properties || {};

  const accentColour = parseProperty(props['Accent Colour']);
  const accentHex = parseProperty(props['Accent Hex']);
  const heroImageFiles = parseProperty(props['Hero Image']);
  const slug = parseProperty(props['Slug']);

  return {
    id: page.id,
    sectionName: parseProperty(props['Section Name']),
    slug: slug,
    heroTitle: parseProperty(props['Hero Title']),
    heroSubtitle: parseProperty(props['Hero Subtitle']),
    accentColour: accentColour,
    accentHex: accentHex || COLOUR_MAP[accentColour] || '#1B365D',
    overlayOpacity: parseProperty(props['Overlay Opacity']) ?? 50, // 0-100 scale, default 50
    heroImageFiles: heroImageFiles, // Raw file objects for download script
    heroImage: extractImageUrl(heroImageFiles), // Direct URL (temporary, Notion-signed)
    status: parseProperty(props['Status']),
    priorityOrder: parseProperty(props['Priority Order']) || 999,
  };
}

/**
 * Fetch all active section settings from Notion
 * @returns {Promise<Object>} Settings keyed by slug
 */
export async function fetchSectionSettings() {
  if (!SECTION_SETTINGS_DB) {
    console.warn('⚠️ NOTION_SECTION_SETTINGS_DB not set — using default section settings');
    return DEFAULT_SECTIONS;
  }

  try {
    const response = await notion.databases.query({
      database_id: SECTION_SETTINGS_DB,
      filter: {
        property: 'Status',
        select: { equals: 'Active' },
      },
      sorts: [
        { property: 'Priority Order', direction: 'ascending' },
      ],
    });

    const sections = {};
    for (const page of response.results) {
      const parsed = parseSectionSettingsPage(page);
      if (parsed.slug) {
        sections[parsed.slug] = parsed;
      }
    }

    // Merge with defaults (so missing sections still work)
    const merged = { ...DEFAULT_SECTIONS };
    for (const [slug, settings] of Object.entries(sections)) {
      merged[slug] = { ...DEFAULT_SECTIONS[slug], ...settings };
    }

    // Cache results
    try {
      fs.writeFileSync(CACHE_FILE, JSON.stringify({
        timestamp: new Date().toISOString(),
        data: merged,
      }, null, 2));
    } catch (cacheError) {
      console.warn('Failed to write section settings cache:', cacheError.message);
    }

    return merged;

  } catch (error) {
    console.error('Error fetching section settings:', error.message);

    // Try cached data
    if (fs.existsSync(CACHE_FILE)) {
      console.log('Using cached section settings');
      const cached = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
      return cached.data || DEFAULT_SECTIONS;
    }

    return DEFAULT_SECTIONS;
  }
}

/**
 * Fetch settings for a single section by slug
 * @param {string} slug - Section slug (e.g., 'about', 'services')
 * @returns {Promise<Object>} Section settings
 */
export async function fetchSectionSettingsBySlug(slug) {
  const allSettings = await fetchSectionSettings();
  return allSettings[slug] || DEFAULT_SECTIONS[slug] || null;
}

export default {
  fetchSectionSettings,
  fetchSectionSettingsBySlug,
};

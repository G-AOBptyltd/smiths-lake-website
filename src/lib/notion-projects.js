/**
 * Project Hub - Notion Integration
 * Fetches project data with all new fields for Project Hub system
 * 
 * FIELD NAME FIX: Notion uses "Title Case With Spaces" for field names
 * This file handles both camelCase and space-separated field names
 * 
 * @version 2.0 - Field name reconciliation applied
 * @updated 26 January 2026
 */

import { fetchNotionContent } from './notion-unified.js';

/**
 * Helper function to safely get field value regardless of naming convention
 * Tries camelCase first, then space-separated variations
 * @param {Object} obj - The object to get the field from
 * @param {string} camelCase - The camelCase version of the field name
 * @param {string} spaceSeparated - The space-separated version (Title Case)
 * @param {*} defaultValue - Default value if field not found
 * @returns {*} The field value or default
 */
function getField(obj, camelCase, spaceSeparated, defaultValue = '') {
  // Try camelCase first (from notion-unified.js normalization)
  if (obj[camelCase] !== undefined && obj[camelCase] !== null) {
    return obj[camelCase];
  }
  // Try space-separated (raw Notion field name)
  if (obj[spaceSeparated] !== undefined && obj[spaceSeparated] !== null) {
    return obj[spaceSeparated];
  }
  // Try lowercase with underscores (another possible format)
  const underscored = spaceSeparated.toLowerCase().replace(/\s+/g, '_');
  if (obj[underscored] !== undefined && obj[underscored] !== null) {
    return obj[underscored];
  }
  return defaultValue;
}

/**
 * Extract URL from Notion file attachment
 * Handles various formats: direct URL, object with url property, array of files
 * @param {*} fileField - The file field from Notion
 * @returns {string|null} The extracted URL or null
 */
function extractFileUrl(fileField) {
  if (!fileField) return null;
  
  // Direct string URL
  if (typeof fileField === 'string') {
    return fileField;
  }
  
  // Array of file objects (most common Notion format)
  if (Array.isArray(fileField) && fileField.length > 0) {
    const firstFile = fileField[0];
    // External URL format
    if (firstFile.external?.url) {
      return firstFile.external.url;
    }
    // File hosted by Notion
    if (firstFile.file?.url) {
      return firstFile.file.url;
    }
    // Direct URL in object
    if (firstFile.url) {
      return firstFile.url;
    }
  }
  
  // Single object with url property
  if (fileField.url) {
    return fileField.url;
  }
  
  // Object with external.url
  if (fileField.external?.url) {
    return fileField.external.url;
  }
  
  // Object with file.url
  if (fileField.file?.url) {
    return fileField.file.url;
  }
  
  return null;
}

/**
 * Fetch all projects from Notion
 * @param {Object} options - Filter options
 * @param {string} options.status - Filter by Status/Stage/Phase
 * @param {boolean} options.requireShowOnWebsite - Only show published items
 * @returns {Promise<Array>} Array of project objects
 */
export async function fetchProjects({ status = null, requireShowOnWebsite = true } = {}) {
  try {
    // Fetch items where Section = "Project Hub"
    let projects = await fetchNotionContent({
      section: 'Project Hub',
      requireShowOnWebsite
    });

    // Filter by status if specified
    if (status) {
      projects = projects.filter(project => {
        const projectStatus = getField(project, 'statusStagePhase', 'Status/Stage/Phase', '');
        return projectStatus === status;
      });
    }

    // Sort by Priority field (lower number = higher priority)
    projects.sort((a, b) => {
      const priorityA = getField(a, 'priority', 'Priority', 999);
      const priorityB = getField(b, 'priority', 'Priority', 999);
      return priorityA - priorityB;
    });

    // Process and enrich project data
    return projects.map(project => enrichProjectData(project));
  } catch (error) {
    console.error('Error fetching projects:', error);
    return [];
  }
}

/**
 * Fetch single project by slug
 * @param {string} slug - URL slug
 * @returns {Promise<Object|null>} Project object or null
 */
export async function fetchProjectBySlug(slug) {
  const projects = await fetchProjects({ requireShowOnWebsite: true });
  
  // Find project with matching slug
  const project = projects.find(p => p.slug === slug);
  
  return project || null;
}

/**
 * Fetch all projects for dynamic checkbox generation
 * Groups projects by section for subscription forms
 * @returns {Promise<Object>} Projects grouped by section
 */
export async function fetchProjectsForSubscription() {
  try {
    // Fetch all published items across ALL sections (except Admin)
    const allItems = await fetchNotionContent({
      requireShowOnWebsite: true
    });

    // Group by section
    const grouped = {
      projects: [],
      services: [],
      groups: [],
      environment: [],
      history: [],
      emergency: []
    };

    allItems.forEach(item => {
      const section = getField(item, 'section', 'Section', '');
      const title = getField(item, 'title', 'Title', '');
      const mailchimpTag = getField(item, 'mailchimpTag', 'MailChimp Tag', title);
      
      // Skip items without titles
      if (!title) return;
      
      const itemData = { title, mailchimpTag: mailchimpTag || title };
      
      if (section === 'Project Hub') {
        grouped.projects.push(itemData);
      } else if (section === 'Services' || section === 'Services & Amenities') {
        grouped.services.push(itemData);
      } else if (section === 'Groups & Activities') {
        grouped.groups.push(itemData);
      } else if (section === 'Environment & Sustainability') {
        grouped.environment.push(itemData);
      } else if (section === 'History & Culture') {
        grouped.history.push(itemData);
      } else if (section === 'Emergency & Safety') {
        grouped.emergency.push(itemData);
      }
    });

    return grouped;
  } catch (error) {
    console.error('Error fetching subscription items:', error);
    return {
      projects: [],
      services: [],
      groups: [],
      environment: [],
      history: [],
      emergency: []
    };
  }
}

/**
 * Get total engagement count from Community Inbox
 * @returns {Promise<number>} Total count of submissions
 */
export async function getTotalEngagementCount() {
  try {
    // TODO: Connect to Community Inbox database when ready
    // For now, return 0 - the UI handles this gracefully
    // To implement: Query Notion "Community Inbox" database and count rows
    return 0;
  } catch (error) {
    console.error('Error fetching engagement count:', error);
    return 0;
  }
}

/**
 * Get submission count for specific project
 * @param {string} projectTitle - Project title to filter by
 * @returns {Promise<number>} Count of submissions
 */
export async function getProjectSubmissionCount(projectTitle) {
  try {
    // TODO: Connect to Community Inbox database and filter by project
    // For now, return 0 - the UI handles this gracefully
    // To implement: Query Notion "Community Inbox" database with filter
    return 0;
  } catch (error) {
    console.error('Error fetching submission count:', error);
    return 0;
  }
}

/**
 * Enrich project data with processed fields
 * @param {Object} project - Raw project data from Notion
 * @returns {Object} Enriched project data
 */
function enrichProjectData(project) {
  // Get title first (needed for slug generation)
  const title = getField(project, 'title', 'Title', 'Untitled Project');
  
  // Generate slug from title (first time only, then locked)
  const existingSlug = getField(project, 'slug', 'Slug', '');
  const slug = existingSlug || generateSlug(title);

  // Get status for badge generation
  // notion-unified.js returns this as 'status' (array from multi-select)
  const statusStagePhase = project.status || [];
  const statusBadge = getStatusBadge(statusStagePhase);

  // Get deadline and check if passed
  const submissionDeadline = getField(project, 'submissionDeadline', 'Submission Deadline', null);
  const deadlinePassed = submissionDeadline 
    ? new Date(submissionDeadline) < new Date()
    : false;

  // Extract hero image URL (handles various Notion formats)
  const heroImageRaw = getField(project, 'heroImageFile', 'Hero Image File', null);
  const heroImageFile = extractFileUrl(heroImageRaw);

  // Get content fields with fallbacks
  const aboutContent = getField(project, 'projhubAboutContent', 'ProjHub About Content', '') ||
                       getField(project, 'aboutContent', 'About Content', '');
  const changesContent = getField(project, 'projhubChangesContent', 'ProjHub Changes Content', '') ||
                         getField(project, 'changesContent', 'Changes Content', '');
  const faqsContent = getField(project, 'projhubFAQsContent', 'ProjHub FAQs Content', '') ||
                      getField(project, 'faqsContent', 'FAQs Content', '');

  // Parse line-separated fields
  const documentTitle = getField(project, 'documentTitle', 'Document Title', '');
  const documentURL = getField(project, 'documentURL', 'Document URL', '');
  const documentSize = getField(project, 'documentSize', 'Document Size', '');
  const documents = parseDocuments(documentTitle, documentURL, documentSize);

  const featureField = getField(project, 'feature', 'Feature', '');
  const features = parseFeatures(featureField);

  // Get other fields
  const description = getField(project, 'description', 'Description', '');
  const category = getField(project, 'category', 'Category', '');
  const priority = getField(project, 'priority', 'Priority', 999);
  const mailchimpTag = getField(project, 'mailchimpTag', 'MailChimp Tag', title);

  return {
    // Core identification
    id: project.id,
    title,
    slug,
    description,
    category,
    priority,
    
    // Status and timing
    statusStagePhase,
    statusBadge,
    submissionDeadline,
    deadlinePassed,
    
    // Content
    aboutContent,
    changesContent,
    faqsContent,
    
    // Parsed arrays
    documents,
    features,
    
    // Media
    heroImageFile,
    
    // Email integration
    mailchimpTag: mailchimpTag || title,
    
    // Preserve original data for debugging
    _raw: project
  };
}

/**
 * Parse line-separated documents into array
 * @param {string} titles - Line-separated document titles
 * @param {string} urls - Line-separated document URLs
 * @param {string} sizes - Line-separated file sizes
 * @returns {Array} Array of document objects
 */
function parseDocuments(titles, urls, sizes) {
  const titleLines = (titles || '').split('\n').filter(Boolean);
  const urlLines = (urls || '').split('\n').filter(Boolean);
  const sizeLines = (sizes || '').split('\n').filter(Boolean);

  const documents = [];
  const maxLength = Math.max(titleLines.length, urlLines.length);

  for (let i = 0; i < maxLength; i++) {
    const title = titleLines[i] ? titleLines[i].trim() : '';
    const url = urlLines[i] ? urlLines[i].trim() : '';
    
    // Only add document if we have both title and URL
    if (title && url) {
      documents.push({
        title,
        url,
        size: sizeLines[i] ? sizeLines[i].trim() : 'Size not specified'
      });
    }
  }

  return documents;
}

/**
 * Parse line-separated features into array
 * @param {string} featureText - Line-separated features
 * @returns {Array} Array of feature strings (max 5)
 */
function parseFeatures(featureText) {
  if (!featureText) return [];
  
  return featureText
    .split('\n')
    .filter(Boolean)
    .map(f => f.trim())
    .filter(f => f.length > 0)
    .slice(0, 5); // Max 5 features
}

/**
 * Get status badge configuration based on Status/Stage/Phase value
 * @param {string} status - Status value from Notion
 * @returns {Object} Badge config with type and label
 */
/**
 * Get status badge configuration based on Status/Stage/Phase value
 * @param {string|Array} status - Status value from Notion (can be array from multi-select)
 * @returns {Object} Badge config with type and label
 */
function getStatusBadge(status) {
  if (!status) return { type: 'default', label: 'Status Unknown' };

  // Handle array (multi-select) - join into single string for checking
  const statusStr = Array.isArray(status) ? status.join(' ').toLowerCase() : status.toLowerCase();

  // OPEN badges (green) - check these first as they take priority
  if (statusStr.includes('open for comment') || 
      statusStr.includes('open to new participants') ||
      statusStr.includes('active')) {
    return { type: 'open', label: 'Open' };
  }

  // CLOSED badges (gray)
  if (statusStr.includes('not active') || 
      statusStr.includes('full') ||
      statusStr.includes('closed') ||
      statusStr.includes('completed')) {
    return { type: 'closed', label: 'Closed' };
  }

  // UNDER REVIEW badges (orange)
  if (statusStr.includes('proposed') ||
      statusStr.includes('concept plan') ||
      statusStr.includes('project planning') ||
      statusStr.includes('plan approved') ||
      statusStr.includes('under review') ||
      statusStr.includes('in progress')) {
    return { type: 'review', label: 'Under Review' };
  }

  // Default - show the first status if array, or the status itself
  const label = Array.isArray(status) ? status[0] : status;
  return { type: 'default', label: label || 'Status Unknown' };
}

/**
 * Generate URL slug from title
 * @param {string} title - Project title
 * @returns {string} URL-friendly slug
 */
function generateSlug(title) {
  if (!title) return 'untitled';
  
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 100); // Limit slug length
}

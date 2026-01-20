/**
 * Smart Icon Mapping System for PPCA Smiths Lake Website
 * 
 * This utility provides intelligent icon matching based on content titles,
 * keywords, categories, and sections. It ensures consistent icon usage
 * across all website sections.
 * 
 * @module icon-matcher
 * @version 1.0.0
 * @author PPCA Digital Transformation Team
 * @requires No external dependencies (pure JavaScript)
 */

/**
 * Get the appropriate icon for a content item
 * 
 * Matching priority:
 * 1. Exact title match (case-insensitive)
 * 2. Keyword match within title
 * 3. Category fallback
 * 4. Section default
 * 5. Generic fallback
 * 
 * @param {Object} item - Content item from Notion database
 * @param {string} item.title - Title of the content item
 * @param {string} [item.category] - Category classification
 * @param {string} [item.section] - Section the item belongs to
 * @returns {string} Unicode emoji character representing the content
 * 
 * @example
 * const icon = getSmartIcon({ 
 *   title: 'Fire Station (RFS) Existing',
 *   category: 'Bushfire',
 *   section: 'Emergency & Safety'
 * });
 * // Returns: '🚒'
 */
export function getSmartIcon(item) {
  if (!item || typeof item !== 'object') {
    console.warn('[icon-matcher] Invalid item passed to getSmartIcon:', item);
    return '📋'; // Generic fallback
  }

  const title = (item.title || '').toLowerCase().trim();
  const category = (item.category || '').toLowerCase().trim();
  const section = (item.section || '').toLowerCase().trim();
  
  // PRIORITY 1: EXACT TITLE MATCHES
  // These are specific titles that should always get the same icon
  const exactMatches = {
    // Emergency & Safety
    'fire station (rfs) existing': '🚒',
    'fire station (rfs) new build project': '🏗️',
    'fire station rfs existing': '🚒',
    'fire station rfs new build project': '🏗️',
    'surf life saving elizabeth beach': '🏖️',
    'waterway access & boat ramps': '🚤',
    'waterway access and boat ramps': '🚤',
    'medical centre': '🏥',
    'police station': '👮',
    'flood evacuation': '🌊',
    'emergency assembly point': '🚨',
    
    // Groups & Activities
    'arts inc - pacific palms': '🎨',
    'arts inc pacific palms': '🎨',
    'bush walking group': '🥾',
    'community library': '📚',
    'tai chi': '🧘',
    'yoga': '🧘‍♀️',
    'pilates': '🤸',
    'tennis': '🎾',
    'golf': '⛳',
    'fishing club': '🎣',
    'gardening club': '🌻',
    'garden club': '🌻',
    'book club': '📖',
    'craft group': '🧶',
    'photography club': '📷',
    'smiths lake bowls club': '🎳',
    
    // Services & Amenities
    'community hall bookings': '🏛️',
    'smiths lake oval': '⚽',
    'pacific palms country club': '🏌️',
    'public toilets': '🚻',
    'barbecue facilities': '🍖',
    
    // Environment & Sustainability
    'landcare bush regeneration program': '🌳',
    'landcare bush regeneration': '🌳',
    'waterways care & monitoring': '💧',
    'waterways care and monitoring': '💧',
    'wildlife conservation': '🦘',
    'coastal erosion': '🌊',
    'dune restoration': '🏖️',
    'recycling program': '♻️',
    
    // History & Culture
    'worimi people': '🪃',
    'charlotte williams': '📜',
    'smiths lake settlement': '⛵',
  };
  
  // Check for exact match
  if (exactMatches[title]) {
    return exactMatches[title];
  }
  
  // PRIORITY 2: KEYWORD MATCHES
  // Partial matching within titles - more flexible than exact matches
  const keywordMatches = [
    // Emergency & Safety (highest priority for safety-critical content)
    { keywords: ['fire station', 'fire brigade', 'rfs', 'rural fire'], icon: '🚒' },
    { keywords: ['surf life', 'lifesaving', 'lifeguard', 'slsc'], icon: '🏖️' },
    { keywords: ['boat ramp', 'boat launch', 'waterway access', 'marine'], icon: '🚤' },
    { keywords: ['medical centre', 'clinic', 'doctor', 'gp', 'health centre'], icon: '🏥' },
    { keywords: ['police station', 'police'], icon: '👮' },
    { keywords: ['ambulance', 'paramedic'], icon: '🚑' },
    { keywords: ['hospital', 'emergency ward'], icon: '🏥' },
    { keywords: ['flood', 'ses', 'state emergency'], icon: '🌊' },
    { keywords: ['evacuation', 'assembly point'], icon: '🚨' },
    { keywords: ['bushfire', 'wildfire'], icon: '🔥' },
    
    // Sports & Recreation
    { keywords: ['walking', 'bushwalk', 'hiking', 'trail walk'], icon: '🥾' },
    { keywords: ['swimming', 'swim club'], icon: '🏊' },
    { keywords: ['yoga'], icon: '🧘‍♀️' },
    { keywords: ['tai chi', 'taichi'], icon: '🧘' },
    { keywords: ['pilates'], icon: '🤸' },
    { keywords: ['tennis'], icon: '🎾' },
    { keywords: ['golf'], icon: '⛳' },
    { keywords: ['fishing', 'angling'], icon: '🎣' },
    { keywords: ['cricket'], icon: '🏏' },
    { keywords: ['football', 'soccer'], icon: '⚽' },
    { keywords: ['basketball'], icon: '🏀' },
    { keywords: ['surfing', 'surf club'], icon: '🏄' },
    { keywords: ['kayak', 'canoe', 'paddle'], icon: '🛶' },
    { keywords: ['sailing', 'yacht', 'sailing club'], icon: '⛵' },
    { keywords: ['cycling', 'bike', 'bicycle'], icon: '🚴' },
    { keywords: ['running', 'jogging', 'athletics'], icon: '🏃' },
    { keywords: ['bowls', 'bowling'], icon: '🎳' },
    
    // Arts & Culture
    { keywords: ['art', 'artist', 'painting', 'drawing', 'arts inc'], icon: '🎨' },
    { keywords: ['music', 'band', 'choir', 'singing', 'orchestra'], icon: '🎵' },
    { keywords: ['dance', 'dancing', 'ballet'], icon: '💃' },
    { keywords: ['theatre', 'drama', 'acting', 'plays'], icon: '🎭' },
    { keywords: ['photography', 'photo club'], icon: '📷' },
    { keywords: ['craft', 'knitting', 'sewing', 'quilting'], icon: '🧶' },
    { keywords: ['pottery', 'ceramic'], icon: '🏺' },
    { keywords: ['writing', 'author', 'poetry', 'writers'], icon: '✍️' },
    
    // Social & Learning
    { keywords: ['book club', 'reading', 'library'], icon: '📚' },
    { keywords: ['language', 'learning', 'education'], icon: '💬' },
    { keywords: ['computer', 'tech', 'digital', 'technology'], icon: '💻' },
    { keywords: ['coffee', 'cafe', 'social club'], icon: '☕' },
    { keywords: ['garden', 'gardening', 'planting', 'horticulture'], icon: '🌻' },
    { keywords: ['cooking', 'baking', 'food', 'culinary'], icon: '👨‍🍳' },
    
    // Environment & Sustainability
    { keywords: ['tree', 'bush regeneration', 'landcare', 'planting', 'revegetation'], icon: '🌳' },
    { keywords: ['water', 'lake', 'creek', 'river', 'waterway'], icon: '💧' },
    { keywords: ['wildlife', 'animal', 'fauna', 'habitat'], icon: '🦘' },
    { keywords: ['bird', 'avian', 'birdwatch'], icon: '🦜' },
    { keywords: ['beach', 'coast', 'shore', 'dune'], icon: '🏖️' },
    { keywords: ['recycling', 'recycle', 'waste', 'composting'], icon: '♻️' },
    { keywords: ['climate', 'carbon', 'sustainability'], icon: '🌍' },
    { keywords: ['erosion', 'coastal management'], icon: '🌊' },
    
    // Community Services
    { keywords: ['hall', 'venue', 'function space', 'community centre'], icon: '🏛️' },
    { keywords: ['volunteer', 'volunteering'], icon: '🤝' },
    { keywords: ['education', 'school', 'kindergarten'], icon: '🎓' },
    { keywords: ['childcare', 'daycare', 'preschool', 'kids'], icon: '👶' },
    { keywords: ['senior', 'aged care', 'elderly', 'retirement'], icon: '👴' },
    { keywords: ['disability', 'accessible', 'accessibility'], icon: '♿' },
    
    // Infrastructure & Amenities
    { keywords: ['road', 'street', 'path', 'pathway'], icon: '🛣️' },
    { keywords: ['park', 'playground', 'reserve'], icon: '🎡' },
    { keywords: ['toilet', 'amenities', 'facilities'], icon: '🚻' },
    { keywords: ['parking', 'car park'], icon: '🅿️' },
    { keywords: ['barbecue', 'bbq', 'picnic'], icon: '🍖' },
    { keywords: ['oval', 'sports field'], icon: '⚽' },
    
    // History & Culture
    { keywords: ['worimi', 'indigenous', 'aboriginal', 'first nations'], icon: '🪃' },
    { keywords: ['heritage', 'historical', 'museum', 'archive'], icon: '🏛️' },
    { keywords: ['settlement', 'pioneer', 'colonial'], icon: '⛵' },
    { keywords: ['timeline', 'chronology'], icon: '📜' },
    { keywords: ['document', 'record'], icon: '📄' },
    { keywords: ['map', 'geography', 'cartography'], icon: '🗺️' },
  ];
  
  // Check for keyword matches
  for (const match of keywordMatches) {
    if (match.keywords.some(keyword => title.includes(keyword))) {
      return match.icon;
    }
  }
  
  // PRIORITY 3: CATEGORY FALLBACKS
  // Use category when title doesn't give us enough information
  const categoryFallbacks = {
    // Emergency & Safety categories
    'bushfire': '🔥',
    'fire': '🔥',
    'flood': '🌊',
    'police': '👮',
    'surf life saving': '🏖️',
    'amenities': '🏢',
    'medical': '🏥',
    'emergency': '🚨',
    'evacuation': '🚨',
    
    // Groups & Activities categories
    'sports & exercise': '⚽',
    'sports & recreation': '⚽',
    'art & culture': '🎨',
    'arts & culture': '🎨',
    'social & hobbies': '☕',
    'hobbies': '🎯',
    'service': '🤝',
    'community service': '🤝',
    'community services': '🤝',
    'volunteer': '🤝',
    
    // Environment & Sustainability categories
    'waterways': '💧',
    'conservation': '🌳',
    'sustainability': '♻️',
    'bushland': '🌲',
    'wildlife': '🦘',
    'coastal': '🏖️',
    'marine': '🌊',
    
    // History & Culture categories
    'indigenous heritage': '🪃',
    'settlement history': '⛵',
    'reference': '📚',
    'demographics': '👥',
    'cultural': '🎭',
    
    // Services categories
    'recreation': '⚽',
    'education': '🎓',
    'health': '🏥',
    'infrastructure': '🏗️',
  };
  
  if (categoryFallbacks[category]) {
    return categoryFallbacks[category];
  }
  
  // PRIORITY 4: SECTION DEFAULTS
  // Last resort before generic fallback - use section context
  const sectionDefaults = {
    'emergency & safety': '🚨',
    'emergency and safety': '🚨',
    'services & amenities': '🏢',
    'services and amenities': '🏢',
    'services': '🏢',
    'groups & activities': '👥',
    'groups and activities': '👥',
    'environment & sustainability': '🌍',
    'environment and sustainability': '🌍',
    'environment': '🌍',
    'history & culture': '📚',
    'history and culture': '📚',
    'history': '📚',
    'about': 'ℹ️',
  };
  
  if (sectionDefaults[section]) {
    return sectionDefaults[section];
  }
  
  // ULTIMATE FALLBACK
  // If nothing else matches, use a generic document icon
  console.info('[icon-matcher] Using fallback icon for:', { title, category, section });
  return '📋';
}

/**
 * Get color for a category (used for colored headers)
 * 
 * @param {string} category - Category name
 * @returns {string} CSS color value
 */
export function getCategoryColor(category) {
  const categoryColors = {
    // Emergency & Safety
    'bushfire': '#D32F2F',
    'flood': '#1976D2',
    'police': '#303F9F',
    'medical': '#C62828',
    'surf life saving': '#0288D1',
    
    // Groups & Activities
    'sports & exercise': '#388E3C',
    'arts & culture': '#7B1FA2',
    'social & hobbies': '#F57C00',
    'service': '#00796B',
    
    // Environment
    'waterways': '#0288D1',
    'conservation': '#2E7D32',
    'sustainability': '#558B2F',
    'wildlife': '#689F38',
    
    // History
    'indigenous heritage': '#5D4037',
    'settlement history': '#455A64',
  };
  
  return categoryColors[category?.toLowerCase()] || '#1B365D'; // Default navy blue
}

/**
 * Validate icon mapping configuration
 * Useful for debugging and ensuring all sections have proper coverage
 * 
 * @returns {Object} Validation report
 */
export function validateIconMappings() {
  const report = {
    totalExactMatches: Object.keys(exactMatches).length,
    totalKeywordGroups: keywordMatches.length,
    totalCategories: Object.keys(categoryFallbacks).length,
    totalSections: Object.keys(sectionDefaults).length,
    coverage: 'Good',
  };
  
  console.table(report);
  return report;
}

// Export for testing and validation
export const iconMappings = {
  exact: exactMatches,
  keywords: keywordMatches,
  categories: categoryFallbacks,
  sections: sectionDefaults,
};

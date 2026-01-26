/**
 * Smart Icon Mapping System for PPCA Smiths Lake Website
 * 
 * This utility provides intelligent icon matching based on content titles,
 * keywords, categories, and sections. It ensures consistent icon usage
 * across all website sections.
 * 
 * @module icon-matcher
 * @version 1.1.0 - Added Project Hub feature icons
 * @author PPCA Digital Transformation Team
 * @updated 26 January 2026
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
    
    // Project Hub - Common Feature Titles
    'crown reserves': '👑',
    'community developed': '👥',
    'lease & license': '📝',
    'lease and license': '📝',
  };
  
  // Check for exact match
  if (exactMatches[title]) {
    return exactMatches[title];
  }
  
  // PRIORITY 2: KEYWORD MATCHES
  // Partial matching within titles - more flexible than exact matches
  const keywordMatches = [
    // ============================================
    // PROJECT HUB FEATURE KEYWORDS (Check first!)
    // ============================================
    // Governance & Legal
    { keywords: ['crown reserve', 'crown land'], icon: '👑' },
    { keywords: ['lease', 'license', 'licence', 'permit'], icon: '📝' },
    { keywords: ['zoning', 'zone', 'land use'], icon: '🗺️' },
    { keywords: ['regulation', 'compliance', 'bylaw'], icon: '⚖️' },
    { keywords: ['policy', 'policies'], icon: '📋' },
    { keywords: ['legislation', 'act', 'law'], icon: '⚖️' },
    
    // Community & Consultation
    { keywords: ['community developed', 'community-developed', 'community driven'], icon: '👥' },
    { keywords: ['consultation', 'consulted', 'engage', 'engagement'], icon: '💬' },
    { keywords: ['feedback', 'input', 'submission'], icon: '📨' },
    { keywords: ['stakeholder', 'participant'], icon: '🤝' },
    { keywords: ['public meeting', 'town hall', 'forum'], icon: '🏛️' },
    { keywords: ['survey', 'poll', 'questionnaire'], icon: '📊' },
    { keywords: ['vote', 'voting', 'ballot'], icon: '🗳️' },
    
    // Planning & Development
    { keywords: ['master plan', 'masterplan', 'strategic plan'], icon: '📐' },
    { keywords: ['draft plan', 'draft strategy'], icon: '📄' },
    { keywords: ['development', 'redevelopment'], icon: '🏗️' },
    { keywords: ['infrastructure', 'construction'], icon: '🔧' },
    { keywords: ['upgrade', 'improvement', 'enhancement'], icon: '⬆️' },
    { keywords: ['maintenance', 'upkeep'], icon: '🔨' },
    { keywords: ['design', 'blueprint'], icon: '✏️' },
    { keywords: ['timeline', 'schedule', 'milestone'], icon: '📅' },
    { keywords: ['budget', 'funding', 'cost', 'financial'], icon: '💰' },
    { keywords: ['grant', 'subsidy'], icon: '💵' },
    
    // Rights & Interests
    { keywords: ['aboriginal', 'indigenous', 'first nations', 'worimi'], icon: '🪃' },
    { keywords: ['native title', 'traditional owner'], icon: '🪃' },
    { keywords: ['heritage', 'historical', 'historic'], icon: '🏛️' },
    { keywords: ['cultural', 'culture'], icon: '🎭' },
    { keywords: ['rights', 'interest', 'interests'], icon: '✊' },
    { keywords: ['protection', 'protected', 'preserve'], icon: '🛡️' },
    
    // Environment & Nature
    { keywords: ['environmental', 'environment'], icon: '🌿' },
    { keywords: ['sustainable', 'sustainability', 'green'], icon: '♻️' },
    { keywords: ['conservation', 'conserve'], icon: '🌳' },
    { keywords: ['biodiversity', 'ecosystem'], icon: '🦋' },
    { keywords: ['flora', 'vegetation', 'plants'], icon: '🌱' },
    { keywords: ['fauna', 'wildlife', 'animal'], icon: '🦘' },
    { keywords: ['water quality', 'waterway'], icon: '💧' },
    { keywords: ['coastal', 'foreshore', 'beach'], icon: '🏖️' },
    
    // Recreation & Facilities
    { keywords: ['recreation', 'recreational'], icon: '🎯' },
    { keywords: ['sports', 'sporting', 'athletics'], icon: '⚽' },
    { keywords: ['park', 'parkland', 'open space'], icon: '🌳' },
    { keywords: ['playground', 'play area', 'play space'], icon: '🎠' },
    { keywords: ['trail', 'track', 'pathway', 'walkway'], icon: '🚶' },
    { keywords: ['cycling', 'bike', 'bicycle'], icon: '🚴' },
    { keywords: ['pump track', 'skate park', 'bmx'], icon: '🛹' },
    { keywords: ['fitness', 'exercise', 'gym'], icon: '💪' },
    { keywords: ['amenities', 'facilities', 'amenity'], icon: '🏢' },
    { keywords: ['toilet', 'bathroom', 'restroom'], icon: '🚻' },
    { keywords: ['parking', 'car park'], icon: '🅿️' },
    { keywords: ['picnic', 'bbq', 'barbecue'], icon: '🍖' },
    
    // Access & Inclusion
    { keywords: ['accessible', 'accessibility', 'disability'], icon: '♿' },
    { keywords: ['inclusive', 'inclusion', 'all ages'], icon: '👨‍👩‍👧‍👦' },
    { keywords: ['flexible', 'adaptable', 'multi-use'], icon: '🔄' },
    { keywords: ['public access', 'open access'], icon: '🚪' },
    
    // Safety & Management
    { keywords: ['safety', 'safe', 'secure'], icon: '🛡️' },
    { keywords: ['risk', 'hazard'], icon: '⚠️' },
    { keywords: ['emergency', 'evacuation'], icon: '🚨' },
    { keywords: ['management', 'managed', 'govern'], icon: '📊' },
    { keywords: ['oversight', 'monitor', 'review'], icon: '👁️' },
    
    // ============================================
    // EXISTING KEYWORD MATCHES (Website Sections)
    // ============================================
    // Emergency & Safety (highest priority for safety-critical content)
    { keywords: ['fire station', 'fire brigade', 'rfs', 'rural fire'], icon: '🚒' },
    { keywords: ['surf life', 'lifesaving', 'lifeguard', 'slsc'], icon: '🏖️' },
    { keywords: ['boat ramp', 'boat launch', 'waterway access', 'marine'], icon: '🚤' },
    { keywords: ['medical centre', 'clinic', 'doctor', 'gp', 'health centre'], icon: '🏥' },
    { keywords: ['police station', 'police'], icon: '👮' },
    { keywords: ['ambulance', 'paramedic'], icon: '🚑' },
    { keywords: ['hospital', 'emergency ward'], icon: '🏥' },
    { keywords: ['flood', 'ses', 'state emergency'], icon: '🌊' },
    { keywords: ['bushfire', 'wildfire'], icon: '🔥' },
    
    // Sports & Recreation
    { keywords: ['walking', 'bushwalk', 'hiking', 'trail walk'], icon: '🥾' },
    { keywords: ['swimming', 'swim club', 'pool'], icon: '🏊' },
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
    { keywords: ['tree', 'bush regeneration', 'landcare', 'revegetation'], icon: '🌳' },
    { keywords: ['water', 'lake', 'creek', 'river'], icon: '💧' },
    { keywords: ['bird', 'avian', 'birdwatch'], icon: '🦜' },
    { keywords: ['recycling', 'recycle', 'waste', 'composting'], icon: '♻️' },
    { keywords: ['climate', 'carbon'], icon: '🌍' },
    { keywords: ['erosion', 'coastal management'], icon: '🌊' },
    
    // Community Services
    { keywords: ['hall', 'venue', 'function space', 'community centre'], icon: '🏛️' },
    { keywords: ['volunteer', 'volunteering'], icon: '🤝' },
    { keywords: ['school', 'kindergarten'], icon: '🎓' },
    { keywords: ['childcare', 'daycare', 'preschool', 'kids'], icon: '👶' },
    { keywords: ['senior', 'aged care', 'elderly', 'retirement'], icon: '👴' },
    
    // Infrastructure & Amenities
    { keywords: ['road', 'street', 'path'], icon: '🛣️' },
    { keywords: ['oval', 'sports field'], icon: '⚽' },
    
    // History & Culture
    { keywords: ['settlement', 'pioneer', 'colonial'], icon: '⛵' },
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
    
    // Project Hub categories
    'sports & recreation': '🏃',
    'environment': '🌿',
    'planning': '📐',
    'governance': '⚖️',
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
    'project hub': '📋',
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
 * Get icon specifically for Project Hub features
 * This function is optimized for feature text parsing
 * 
 * @param {string} featureText - The feature text (may include title:description format)
 * @param {number} index - Index for fallback cycling
 * @returns {string} Unicode emoji character
 */
export function getFeatureIcon(featureText, index = 0) {
  if (!featureText) {
    const fallbackIcons = ['📋', '💬', '📍', '✓', '🎯'];
    return fallbackIcons[index % fallbackIcons.length];
  }
  
  // Use getSmartIcon with Project Hub section context
  const icon = getSmartIcon({
    title: featureText,
    section: 'Project Hub'
  });
  
  // If we got the generic fallback, use cycling icons instead
  if (icon === '📋') {
    const fallbackIcons = ['📋', '💬', '📍', '✓', '🎯'];
    return fallbackIcons[index % fallbackIcons.length];
  }
  
  return icon;
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
    'sports & recreation': '#388E3C',
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
    
    // Project Hub
    'planning': '#1565C0',
    'governance': '#37474F',
    'recreation': '#2E7D32',
  };
  
  return categoryColors[category?.toLowerCase()] || '#1B365D'; // Default navy blue
}

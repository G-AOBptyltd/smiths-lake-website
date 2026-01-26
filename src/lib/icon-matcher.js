/**
 * Smart Icon Mapping System for PPCA Smiths Lake Website
 * 
 * This utility provides intelligent icon matching based on content titles,
 * keywords, categories, and sections. It ensures consistent icon usage
 * across all website sections.
 * 
 * @module icon-matcher
 * @version 2.0.0 - Comprehensive expansion with 50+ new icons
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
    'tennis club': '🎾',
    'golf': '⛳',
    'golf club': '⛳',
    'fishing club': '🎣',
    'gardening club': '🌻',
    'garden club': '🌻',
    'book club': '📖',
    'craft group': '🧶',
    'photography club': '📷',
    'smiths lake bowls club': '🎳',
    'coffee club': '☕',
    'mens shed': '🔨',
    "men's shed": '🔨',
    'chess club': '♟️',
    'mahjong': '🀄',
    'mahjong club': '🀄',
    'bridge club': '🃏',
    'poker club': '🃏',
    'card club': '🃏',
    'sip and paint': '🍷',
    'wine club': '🍷',
    
    // Services & Amenities
    'community hall bookings': '🏛️',
    'smiths lake oval': '⚽',
    'pacific palms country club': '🏌️',
    'public toilets': '🚻',
    'barbecue facilities': '🍖',
    'farmers market': '🥬',
    'community market': '🏪',
    'dog park': '🐕',
    'off leash area': '🐕',
    
    // Environment & Sustainability
    'landcare bush regeneration program': '🌳',
    'landcare bush regeneration': '🌳',
    'waterways care & monitoring': '💧',
    'waterways care and monitoring': '💧',
    'wildlife conservation': '🦘',
    'coastal erosion': '🌊',
    'dune restoration': '🏖️',
    'recycling program': '♻️',
    'bird watching group': '🦅',
    'birdwatching club': '🦅',
    
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
    { keywords: ['trail', 'pathway', 'walkway'], icon: '🚶' },
    { keywords: ['fitness', 'exercise', 'gym', 'workout'], icon: '💪' },
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
    // SPORTS & RECREATION - EXPANDED
    // ============================================
    // Cycling & Wheeled Sports
    { keywords: ['cycling', 'bike', 'bicycle', 'cyclist'], icon: '🚴' },
    { keywords: ['mountain bike', 'mtb'], icon: '🚵' },
    { keywords: ['bmx'], icon: '🚴' },
    { keywords: ['pump track'], icon: '🛹' },
    { keywords: ['skateboard', 'skating', 'skate park'], icon: '🛹' },
    { keywords: ['roller skate', 'rollerskate', 'roller skating'], icon: '🛼' },
    { keywords: ['inline skate', 'inline skating', 'rollerblad'], icon: '🛼' },
    { keywords: ['scooter'], icon: '🛴' },
    
    // Racquet Sports
    { keywords: ['tennis'], icon: '🎾' },
    { keywords: ['pickleball', 'pickle ball'], icon: '🎾' },
    { keywords: ['paddle tennis', 'padel'], icon: '🎾' },
    { keywords: ['squash'], icon: '🎾' },
    { keywords: ['badminton', 'badmington', 'shuttlecock'], icon: '🏸' },
    { keywords: ['table tennis', 'ping pong', 'pingpong'], icon: '🏓' },
    
    // Water Sports
    { keywords: ['swimming', 'swim club', 'pool', 'aquatic'], icon: '🏊' },
    { keywords: ['surfing', 'surf club', 'surfer'], icon: '🏄' },
    { keywords: ['kayak', 'kayaking'], icon: '🛶' },
    { keywords: ['canoe', 'canoeing'], icon: '🛶' },
    { keywords: ['paddle board', 'paddleboard', 'sup', 'stand up paddle'], icon: '🏄' },
    { keywords: ['sailing', 'yacht', 'sailing club', 'sail boat'], icon: '⛵' },
    { keywords: ['rowing', 'row boat'], icon: '🚣' },
    { keywords: ['diving', 'scuba', 'snorkel'], icon: '🤿' },
    { keywords: ['water ski', 'wakeboard'], icon: '🎿' },
    { keywords: ['jet ski', 'jetski'], icon: '🚤' },
    
    // Ball Sports
    { keywords: ['football', 'soccer', 'afl', 'nrl', 'rugby'], icon: '⚽' },
    { keywords: ['cricket'], icon: '🏏' },
    { keywords: ['basketball'], icon: '🏀' },
    { keywords: ['netball'], icon: '🏀' },
    { keywords: ['volleyball', 'beach volleyball'], icon: '🏐' },
    { keywords: ['handball'], icon: '🤾' },
    { keywords: ['hockey', 'field hockey'], icon: '🏑' },
    { keywords: ['ice hockey'], icon: '🏒' },
    { keywords: ['lacrosse'], icon: '🥍' },
    { keywords: ['softball', 'baseball'], icon: '⚾' },
    
    // Individual Sports & Activities
    { keywords: ['running', 'jogging', 'athletics', 'track'], icon: '🏃' },
    { keywords: ['walking', 'bushwalk', 'hiking', 'trail walk', 'trekking'], icon: '🥾' },
    { keywords: ['golf', 'golfing'], icon: '⛳' },
    { keywords: ['bowls', 'bowling', 'lawn bowls'], icon: '🎳' },
    { keywords: ['archery', 'bow and arrow'], icon: '🏹' },
    { keywords: ['shooting', 'target shooting', 'rifle'], icon: '🎯' },
    { keywords: ['martial arts', 'karate', 'judo', 'taekwondo', 'kung fu'], icon: '🥋' },
    { keywords: ['boxing', 'kickboxing'], icon: '🥊' },
    { keywords: ['wrestling'], icon: '🤼' },
    { keywords: ['fencing'], icon: '🤺' },
    { keywords: ['climbing', 'rock climbing', 'bouldering'], icon: '🧗' },
    { keywords: ['weightlifting', 'weights', 'powerlifting'], icon: '🏋️' },
    { keywords: ['triathlon', 'ironman'], icon: '🏊' },
    { keywords: ['marathon'], icon: '🏃' },
    { keywords: ['cross country'], icon: '🏃' },
    { keywords: ['orienteering'], icon: '🧭' },
    
    // Mind & Body
    { keywords: ['yoga'], icon: '🧘‍♀️' },
    { keywords: ['tai chi', 'taichi'], icon: '🧘' },
    { keywords: ['pilates'], icon: '🤸' },
    { keywords: ['meditation', 'mindfulness'], icon: '🧘' },
    { keywords: ['stretching', 'flexibility'], icon: '🤸' },
    { keywords: ['aerobics', 'zumba'], icon: '💃' },
    
    // Outdoor & Adventure
    { keywords: ['kite flying', 'kite', 'kites'], icon: '🪁' },
    { keywords: ['frisbee', 'disc golf', 'ultimate'], icon: '🥏' },
    { keywords: ['horse riding', 'equestrian', 'pony'], icon: '🏇' },
    { keywords: ['camping', 'campsite', 'caravan'], icon: '🏕️' },
    { keywords: ['fishing', 'angling', 'fish'], icon: '🎣' },
    { keywords: ['hunting'], icon: '🦌' },
    { keywords: ['bird watching', 'birdwatching', 'birding', 'ornithology'], icon: '🦅' },
    { keywords: ['nature walk', 'nature trail'], icon: '🌲' },
    { keywords: ['geocaching'], icon: '📍' },
    { keywords: ['metal detecting'], icon: '🔍' },
    { keywords: ['stargazing', 'astronomy', 'telescope'], icon: '🔭' },
    
    // ============================================
    // GAMES & SOCIAL ACTIVITIES - EXPANDED
    // ============================================
    // Board & Card Games
    { keywords: ['chess'], icon: '♟️' },
    { keywords: ['checkers', 'draughts'], icon: '🎲' },
    { keywords: ['poker', 'texas hold'], icon: '🃏' },
    { keywords: ['bridge'], icon: '🃏' },
    { keywords: ['mahjong', 'mah-jong', 'mah jong'], icon: '🀄' },
    { keywords: ['card game', 'cards', 'card club'], icon: '🃏' },
    { keywords: ['board game', 'tabletop'], icon: '🎲' },
    { keywords: ['bingo'], icon: '🔢' },
    { keywords: ['trivia', 'quiz night', 'pub quiz'], icon: '❓' },
    { keywords: ['scrabble', 'word game'], icon: '🔤' },
    { keywords: ['puzzle', 'jigsaw'], icon: '🧩' },
    { keywords: ['sudoku', 'crossword'], icon: '📝' },
    { keywords: ['dominoes', 'dominos'], icon: '🁡' },
    { keywords: ['backgammon'], icon: '🎲' },
    
    // Video & Electronic Games
    { keywords: ['video game', 'gaming', 'esports', 'e-sports'], icon: '🎮' },
    { keywords: ['arcade'], icon: '🕹️' },
    
    // Social & Dining
    { keywords: ['coffee', 'cafe', 'coffee club', 'coffee morning'], icon: '☕' },
    { keywords: ['tea', 'afternoon tea', 'high tea', 'tea party'], icon: '🫖' },
    { keywords: ['wine', 'wine club', 'wine tasting'], icon: '🍷' },
    { keywords: ['beer', 'brewery', 'craft beer'], icon: '🍺' },
    { keywords: ['cocktail', 'happy hour'], icon: '🍸' },
    { keywords: ['sip and paint', 'paint and sip', 'wine and paint'], icon: '🍷' },
    { keywords: ['dinner club', 'supper club', 'dining'], icon: '🍽️' },
    { keywords: ['brunch'], icon: '🥞' },
    { keywords: ['potluck', 'pot luck', 'shared meal'], icon: '🍲' },
    { keywords: ['cooking class', 'cooking club'], icon: '👨‍🍳' },
    { keywords: ['baking', 'bake club'], icon: '🧁' },
    
    // Markets & Events
    { keywords: ['market', 'markets', 'farmers market'], icon: '🏪' },
    { keywords: ['fete', 'fair', 'carnival', 'festival'], icon: '🎪' },
    { keywords: ['garage sale', 'car boot', 'swap meet'], icon: '🏷️' },
    { keywords: ['auction'], icon: '🔨' },
    { keywords: ['raffle', 'lottery', 'draw'], icon: '🎟️' },
    { keywords: ['fundraiser', 'charity'], icon: '💝' },
    { keywords: ['gala', 'ball', 'formal'], icon: '🎩' },
    { keywords: ['concert', 'live music', 'gig'], icon: '🎤' },
    { keywords: ['movie night', 'cinema', 'film'], icon: '🎬' },
    { keywords: ['karaoke'], icon: '🎤' },
    { keywords: ['open mic'], icon: '🎙️' },
    
    // ============================================
    // ARTS, CRAFTS & CREATIVE - EXPANDED
    // ============================================
    { keywords: ['art', 'artist', 'painting', 'drawing', 'arts inc'], icon: '🎨' },
    { keywords: ['watercolor', 'watercolour', 'acrylic', 'oil painting'], icon: '🖼️' },
    { keywords: ['sketch', 'sketching', 'illustration'], icon: '✏️' },
    { keywords: ['sculpture', 'sculpting', 'carving'], icon: '🗿' },
    { keywords: ['pottery', 'ceramic', 'clay'], icon: '🏺' },
    { keywords: ['woodwork', 'woodworking', 'carpentry'], icon: '🪵' },
    { keywords: ['metalwork', 'blacksmith', 'welding'], icon: '⚒️' },
    { keywords: ['jewellery', 'jewelry', 'beading'], icon: '💍' },
    { keywords: ['glass', 'stained glass', 'glasswork'], icon: '🪟' },
    { keywords: ['mosaic'], icon: '🧩' },
    { keywords: ['craft', 'knitting', 'sewing', 'quilting', 'crochet'], icon: '🧶' },
    { keywords: ['embroidery', 'needlework', 'cross stitch'], icon: '🪡' },
    { keywords: ['weaving', 'macrame', 'textile'], icon: '🧵' },
    { keywords: ['scrapbook', 'scrapbooking', 'paper craft'], icon: '📔' },
    { keywords: ['origami', 'paper folding'], icon: '🦢' },
    { keywords: ['calligraphy', 'lettering'], icon: '✒️' },
    { keywords: ['printmaking', 'screen printing', 'lino'], icon: '🖨️' },
    { keywords: ['candle making', 'soap making'], icon: '🕯️' },
    { keywords: ['floral', 'flower arranging', 'floristry', 'ikebana'], icon: '💐' },
    
    // Music & Performance
    { keywords: ['music', 'band', 'choir', 'singing', 'orchestra', 'ensemble'], icon: '🎵' },
    { keywords: ['guitar', 'ukulele', 'bass'], icon: '🎸' },
    { keywords: ['piano', 'keyboard'], icon: '🎹' },
    { keywords: ['drums', 'percussion'], icon: '🥁' },
    { keywords: ['violin', 'viola', 'cello', 'strings'], icon: '🎻' },
    { keywords: ['flute', 'clarinet', 'saxophone', 'woodwind'], icon: '🎷' },
    { keywords: ['trumpet', 'trombone', 'brass'], icon: '🎺' },
    { keywords: ['harmonica'], icon: '🪗' },
    { keywords: ['dance', 'dancing', 'ballet', 'ballroom', 'salsa', 'tango'], icon: '💃' },
    { keywords: ['line dancing', 'square dancing'], icon: '🕺' },
    { keywords: ['theatre', 'drama', 'acting', 'plays', 'improv'], icon: '🎭' },
    { keywords: ['comedy', 'stand up', 'standup'], icon: '😂' },
    { keywords: ['magic', 'magician', 'illusion'], icon: '🎩' },
    { keywords: ['circus', 'acrobat', 'juggling'], icon: '🎪' },
    
    // Photography & Film
    { keywords: ['photography', 'photo club', 'camera'], icon: '📷' },
    { keywords: ['video', 'videography', 'filmmaking'], icon: '🎥' },
    { keywords: ['drone', 'aerial photography'], icon: '🚁' },
    
    // Writing & Literature
    { keywords: ['writing', 'author', 'poetry', 'writers', 'creative writing'], icon: '✍️' },
    { keywords: ['book club', 'reading', 'library', 'literature'], icon: '📚' },
    { keywords: ['journaling', 'diary'], icon: '📓' },
    { keywords: ['storytelling', 'oral history'], icon: '📖' },
    { keywords: ['podcast', 'podcasting'], icon: '🎙️' },
    { keywords: ['blog', 'blogging'], icon: '💻' },
    
    // ============================================
    // ANIMALS & PETS - EXPANDED
    // ============================================
    { keywords: ['dog', 'dogs', 'canine', 'puppy', 'pooch'], icon: '🐕' },
    { keywords: ['dog walking', 'dog park', 'off leash', 'off-leash'], icon: '🐕' },
    { keywords: ['dog training', 'obedience'], icon: '🦮' },
    { keywords: ['cat', 'cats', 'feline', 'kitten'], icon: '🐈' },
    { keywords: ['pet', 'pets', 'pet friendly'], icon: '🐾' },
    { keywords: ['horse', 'horses', 'equestrian', 'pony', 'riding'], icon: '🐴' },
    { keywords: ['bird', 'birds', 'aviary', 'parrot', 'budgie'], icon: '🦜' },
    { keywords: ['chicken', 'poultry', 'hen', 'rooster'], icon: '🐔' },
    { keywords: ['rabbit', 'bunny'], icon: '🐰' },
    { keywords: ['guinea pig', 'hamster', 'small animal'], icon: '🐹' },
    { keywords: ['reptile', 'lizard', 'snake'], icon: '🦎' },
    { keywords: ['fish', 'aquarium', 'tropical fish'], icon: '🐠' },
    { keywords: ['bee', 'bees', 'beekeeping', 'apiary', 'honey'], icon: '🐝' },
    { keywords: ['butterfly', 'butterflies', 'moth'], icon: '🦋' },
    { keywords: ['wildlife', 'native animal', 'fauna'], icon: '🦘' },
    { keywords: ['koala'], icon: '🐨' },
    { keywords: ['wombat'], icon: '🦡' },
    { keywords: ['possum', 'glider'], icon: '🐿️' },
    { keywords: ['whale', 'whale watching', 'dolphin'], icon: '🐋' },
    { keywords: ['seal', 'sea lion'], icon: '🦭' },
    { keywords: ['turtle', 'sea turtle', 'tortoise'], icon: '🐢' },
    { keywords: ['frog', 'amphibian'], icon: '🐸' },
    
    // ============================================
    // GARDENING & HORTICULTURE - EXPANDED
    // ============================================
    { keywords: ['garden', 'gardening', 'horticulture'], icon: '🌻' },
    { keywords: ['vegetable', 'veggie', 'veg garden'], icon: '🥬' },
    { keywords: ['herb', 'herbs', 'herb garden'], icon: '🌿' },
    { keywords: ['fruit', 'orchard', 'fruit tree'], icon: '🍎' },
    { keywords: ['flower', 'flowers', 'floral'], icon: '🌸' },
    { keywords: ['rose', 'roses'], icon: '🌹' },
    { keywords: ['native plant', 'native garden', 'australian native'], icon: '🌾' },
    { keywords: ['succulent', 'cactus', 'cacti'], icon: '🌵' },
    { keywords: ['bonsai'], icon: '🌳' },
    { keywords: ['orchid'], icon: '🌺' },
    { keywords: ['community garden', 'allotment'], icon: '🏡' },
    { keywords: ['permaculture'], icon: '🌱' },
    { keywords: ['composting', 'compost', 'worm farm'], icon: '♻️' },
    { keywords: ['lawn', 'turf', 'grass'], icon: '🌱' },
    { keywords: ['landscaping', 'landscape'], icon: '🏞️' },
    { keywords: ['irrigation', 'watering'], icon: '💧' },
    { keywords: ['greenhouse', 'glasshouse', 'nursery'], icon: '🌱' },
    { keywords: ['seed', 'seeds', 'seedling'], icon: '🌱' },
    { keywords: ['pruning', 'hedge', 'topiary'], icon: '✂️' },
    
    // ============================================
    // TECHNOLOGY & DIGITAL - EXPANDED
    // ============================================
    { keywords: ['computer', 'computing', 'pc', 'laptop'], icon: '💻' },
    { keywords: ['phone', 'smartphone', 'mobile', 'iphone', 'android'], icon: '📱' },
    { keywords: ['tablet', 'ipad'], icon: '📱' },
    { keywords: ['internet', 'online', 'web', 'website'], icon: '🌐' },
    { keywords: ['social media', 'facebook', 'instagram'], icon: '📲' },
    { keywords: ['email', 'e-mail'], icon: '📧' },
    { keywords: ['coding', 'programming', 'software'], icon: '👨‍💻' },
    { keywords: ['robotics', 'robot'], icon: '🤖' },
    { keywords: ['3d printing', '3d print'], icon: '🖨️' },
    { keywords: ['virtual reality', 'vr', 'augmented reality', 'ar'], icon: '🥽' },
    { keywords: ['cyber', 'digital safety', 'online safety'], icon: '🔒' },
    
    // ============================================
    // EDUCATION & LEARNING - EXPANDED
    // ============================================
    { keywords: ['school', 'kindergarten', 'preschool'], icon: '🎓' },
    { keywords: ['university', 'college', 'tafe'], icon: '🏫' },
    { keywords: ['tutoring', 'tutor', 'homework'], icon: '📝' },
    { keywords: ['language', 'esl', 'english class'], icon: '💬' },
    { keywords: ['french', 'spanish', 'italian', 'german', 'mandarin', 'japanese'], icon: '🗣️' },
    { keywords: ['sign language', 'auslan'], icon: '🤟' },
    { keywords: ['history', 'historical'], icon: '📜' },
    { keywords: ['science', 'stem', 'experiment'], icon: '🔬' },
    { keywords: ['maths', 'math', 'mathematics'], icon: '🔢' },
    { keywords: ['geography'], icon: '🌍' },
    { keywords: ['first aid', 'cpr'], icon: '🩹' },
    { keywords: ['workshop', 'class', 'course', 'lesson'], icon: '📚' },
    { keywords: ['seminar', 'webinar', 'lecture'], icon: '🎓' },
    { keywords: ['mentoring', 'mentor'], icon: '👥' },
    
    // ============================================
    // HEALTH & WELLBEING - EXPANDED  
    // ============================================
    { keywords: ['health', 'healthy', 'wellness'], icon: '❤️' },
    { keywords: ['mental health', 'anxiety', 'depression', 'counselling'], icon: '🧠' },
    { keywords: ['support group', 'peer support'], icon: '🤝' },
    { keywords: ['grief', 'bereavement', 'loss'], icon: '💙' },
    { keywords: ['addiction', 'recovery', 'aa', 'na'], icon: '💪' },
    { keywords: ['nutrition', 'diet', 'healthy eating'], icon: '🥗' },
    { keywords: ['weight loss', 'weight management'], icon: '⚖️' },
    { keywords: ['diabetes'], icon: '💉' },
    { keywords: ['heart', 'cardiac', 'blood pressure'], icon: '❤️' },
    { keywords: ['cancer'], icon: '🎗️' },
    { keywords: ['disability', 'ndis'], icon: '♿' },
    { keywords: ['hearing', 'deaf', 'audiology'], icon: '👂' },
    { keywords: ['vision', 'blind', 'sight'], icon: '👁️' },
    { keywords: ['physio', 'physiotherapy', 'physical therapy'], icon: '🏃' },
    { keywords: ['massage', 'remedial'], icon: '💆' },
    { keywords: ['chiropractic', 'chiropractor', 'osteopath'], icon: '🦴' },
    { keywords: ['acupuncture', 'chinese medicine'], icon: '📍' },
    { keywords: ['naturopath', 'natural therapy', 'homeopath'], icon: '🌿' },
    { keywords: ['dental', 'dentist', 'teeth'], icon: '🦷' },
    { keywords: ['pharmacy', 'chemist', 'medication'], icon: '💊' },
    { keywords: ['pregnancy', 'prenatal', 'maternity', 'antenatal'], icon: '🤰' },
    { keywords: ['baby', 'newborn', 'infant', 'mothers group'], icon: '👶' },
    { keywords: ['parenting', 'parent'], icon: '👨‍👩‍👧' },
    
    // ============================================
    // COMMUNITY SERVICES - EXPANDED
    // ============================================
    { keywords: ['hall', 'venue', 'function space', 'community centre'], icon: '🏛️' },
    { keywords: ['volunteer', 'volunteering', 'volunteers'], icon: '🤝' },
    { keywords: ['childcare', 'daycare', 'child care'], icon: '👶' },
    { keywords: ['youth', 'teen', 'teenager', 'young people'], icon: '🧑' },
    { keywords: ['senior', 'aged care', 'elderly', 'retirement', 'over 55'], icon: '👴' },
    { keywords: ['pension', 'centrelink'], icon: '💳' },
    { keywords: ['migrant', 'refugee', 'multicultural', 'cald'], icon: '🌍' },
    { keywords: ['lgbtiq', 'lgbtq', 'pride', 'rainbow'], icon: '🏳️‍🌈' },
    { keywords: ['women', 'womens', "women's"], icon: '👩' },
    { keywords: ['men', 'mens', "men's", 'mens shed'], icon: '👨' },
    { keywords: ['family', 'families'], icon: '👨‍👩‍👧‍👦' },
    { keywords: ['single parent', 'solo parent'], icon: '👨‍👧' },
    { keywords: ['carer', 'caregiver', 'caring'], icon: '🤲' },
    { keywords: ['homeless', 'housing', 'shelter'], icon: '🏠' },
    { keywords: ['food bank', 'food pantry', 'food relief'], icon: '🍲' },
    { keywords: ['op shop', 'thrift', 'second hand', 'charity shop'], icon: '👕' },
    { keywords: ['legal aid', 'legal advice'], icon: '⚖️' },
    { keywords: ['financial counselling', 'money advice'], icon: '💰' },
    { keywords: ['job', 'employment', 'career', 'resume'], icon: '💼' },
    { keywords: ['neighbourhood watch', 'crime prevention'], icon: '👁️' },
    { keywords: ['rotary', 'lions club', 'service club'], icon: '🏅' },
    { keywords: ['rsl', 'veteran', 'anzac', 'military'], icon: '🎖️' },
    { keywords: ['church', 'chapel', 'religious', 'faith', 'spiritual'], icon: '⛪' },
    { keywords: ['mosque', 'islamic', 'muslim'], icon: '🕌' },
    { keywords: ['synagogue', 'jewish'], icon: '🕍' },
    { keywords: ['temple', 'buddhist', 'hindu'], icon: '🛕' },
    
    // ============================================
    // EMERGENCY & SAFETY (existing)
    // ============================================
    { keywords: ['fire station', 'fire brigade', 'rfs', 'rural fire'], icon: '🚒' },
    { keywords: ['surf life', 'lifesaving', 'lifeguard', 'slsc'], icon: '🏖️' },
    { keywords: ['boat ramp', 'boat launch', 'waterway access', 'marine'], icon: '🚤' },
    { keywords: ['medical centre', 'clinic', 'doctor', 'gp', 'health centre'], icon: '🏥' },
    { keywords: ['police station', 'police'], icon: '👮' },
    { keywords: ['ambulance', 'paramedic'], icon: '🚑' },
    { keywords: ['hospital', 'emergency ward'], icon: '🏥' },
    { keywords: ['flood', 'ses', 'state emergency'], icon: '🌊' },
    { keywords: ['bushfire', 'wildfire', 'fire danger'], icon: '🔥' },
    { keywords: ['storm', 'severe weather', 'cyclone'], icon: '🌪️' },
    { keywords: ['earthquake'], icon: '🌍' },
    { keywords: ['tsunami'], icon: '🌊' },
    { keywords: ['snake', 'snake bite'], icon: '🐍' },
    { keywords: ['spider', 'spider bite'], icon: '🕷️' },
    { keywords: ['jellyfish', 'bluebottle', 'sting'], icon: '🪼' },
    { keywords: ['shark', 'shark sighting'], icon: '🦈' },
    { keywords: ['crocodile', 'croc'], icon: '🐊' },
    { keywords: ['lifeline', 'crisis', 'suicide prevention'], icon: '📞' },
    { keywords: ['domestic violence', 'dv', 'family violence'], icon: '🏠' },
    
    // ============================================
    // INFRASTRUCTURE & TRANSPORT
    // ============================================
    { keywords: ['road', 'street', 'highway'], icon: '🛣️' },
    { keywords: ['bridge'], icon: '🌉' },
    { keywords: ['footpath', 'sidewalk', 'pavement'], icon: '🚶' },
    { keywords: ['bus', 'bus stop', 'public transport'], icon: '🚌' },
    { keywords: ['train', 'railway', 'station'], icon: '🚆' },
    { keywords: ['ferry', 'boat'], icon: '⛴️' },
    { keywords: ['airport', 'plane', 'flight'], icon: '✈️' },
    { keywords: ['taxi', 'uber', 'rideshare'], icon: '🚕' },
    { keywords: ['electric vehicle', 'ev', 'charging'], icon: '🔌' },
    { keywords: ['petrol', 'fuel', 'servo', 'service station'], icon: '⛽' },
    { keywords: ['post office', 'mail', 'postal'], icon: '📮' },
    { keywords: ['bank', 'atm', 'banking'], icon: '🏦' },
    { keywords: ['shop', 'shopping', 'retail', 'store'], icon: '🏪' },
    { keywords: ['supermarket', 'grocery', 'woolworths', 'coles', 'iga'], icon: '🛒' },
    { keywords: ['restaurant', 'dining', 'eatery'], icon: '🍽️' },
    { keywords: ['takeaway', 'takeout', 'fast food'], icon: '🍔' },
    { keywords: ['bakery', 'bread'], icon: '🥖' },
    { keywords: ['butcher', 'meat'], icon: '🥩' },
    { keywords: ['seafood', 'fish shop', 'fishmonger'], icon: '🐟' },
    { keywords: ['bottle shop', 'liquor', 'bws', 'dan murphy'], icon: '🍾' },
    { keywords: ['hardware', 'bunnings', 'mitre 10'], icon: '🔧' },
    { keywords: ['real estate', 'property'], icon: '🏠' },
    { keywords: ['accommodation', 'hotel', 'motel', 'airbnb'], icon: '🏨' },
    { keywords: ['camping ground', 'holiday park', 'caravan park'], icon: '🏕️' },
    
    // ============================================
    // ENVIRONMENT & NATURE (existing + expanded)
    // ============================================
    { keywords: ['tree', 'bush regeneration', 'landcare', 'revegetation'], icon: '🌳' },
    { keywords: ['water', 'lake', 'creek', 'river', 'stream'], icon: '💧' },
    { keywords: ['ocean', 'sea', 'marine'], icon: '🌊' },
    { keywords: ['wetland', 'swamp', 'marsh'], icon: '🌿' },
    { keywords: ['rainforest', 'forest'], icon: '🌲' },
    { keywords: ['bushland', 'native bush'], icon: '🌿' },
    { keywords: ['national park', 'nature reserve'], icon: '🏞️' },
    { keywords: ['bird', 'avian', 'birdwatch'], icon: '🦜' },
    { keywords: ['recycling', 'recycle', 'waste', 'composting'], icon: '♻️' },
    { keywords: ['climate', 'carbon', 'emissions'], icon: '🌍' },
    { keywords: ['solar', 'renewable', 'clean energy'], icon: '☀️' },
    { keywords: ['wind power', 'wind farm'], icon: '💨' },
    { keywords: ['erosion', 'coastal management'], icon: '🌊' },
    { keywords: ['pollution', 'contamination'], icon: '🏭' },
    { keywords: ['clean up', 'cleanup', 'litter'], icon: '🧹' },
    { keywords: ['weed', 'weeds', 'weed control'], icon: '🌾' },
    { keywords: ['feral', 'pest', 'pest control'], icon: '🐀' },
    
    // ============================================
    // HISTORY & CULTURE (existing)
    // ============================================
    { keywords: ['settlement', 'pioneer', 'colonial', 'settler'], icon: '⛵' },
    { keywords: ['document', 'record', 'archive'], icon: '📄' },
    { keywords: ['map', 'geography', 'cartography'], icon: '🗺️' },
    { keywords: ['museum', 'exhibit', 'exhibition'], icon: '🏛️' },
    { keywords: ['memorial', 'monument', 'statue'], icon: '🗽' },
    { keywords: ['cemetery', 'grave', 'burial'], icon: '🪦' },
    { keywords: ['war', 'wwi', 'wwii', 'vietnam', 'korea'], icon: '⚔️' },
    { keywords: ['gold rush', 'mining'], icon: '⛏️' },
    { keywords: ['convict'], icon: '⛓️' },
    { keywords: ['lighthouse'], icon: '🗼' },
    { keywords: ['shipwreck', 'maritime'], icon: '🚢' },
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
    'sports & recreation': '🏃',
    'art & culture': '🎨',
    'arts & culture': '🎨',
    'social & hobbies': '☕',
    'hobbies': '🎯',
    'service': '🤝',
    'community service': '🤝',
    'community services': '🤝',
    'volunteer': '🤝',
    'games': '🎲',
    'cards': '🃏',
    'pets': '🐾',
    'animals': '🐾',
    
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
    'recreation': '🎯',
    'education': '🎓',
    'health': '🏥',
    'infrastructure': '🏗️',
    'transport': '🚌',
    'shopping': '🛒',
    
    // Project Hub categories
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
    'games': '#6A1B9A',
    'pets': '#795548',
    
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

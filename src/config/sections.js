// Sections Configuration for PPCA Website
// Defines all 6 content sections with categories, colors, icons, and status options

export const sections = {
  'groups-activities': {
    name: 'Groups & Activities',
    slug: 'groups',
    description: 'Community groups, clubs, and social activities',
    color: '#5B9BD5', // Sky Blue
    icon: 'users',
    categories: [
      { value: 'Sports', label: 'Sports', icon: '⚽' },
      { value: 'Arts & Culture', label: 'Arts & Culture', icon: '🎨' },
      { value: 'Hobbies', label: 'Hobbies', icon: '🌱' },
      { value: 'Environment', label: 'Environment', icon: '🌿' },
      { value: 'Social', label: 'Social', icon: '🤝' },
      { value: 'Service', label: 'Service', icon: '🛠️' }
    ],
    statusOptions: ['Active', 'Looking for Members', 'Full', 'On Break', 'Inactive'],
    fields: ['meeting', 'contact', 'links']
  },
  
  'emergency-safety': {
    name: 'Emergency & Safety',
    slug: 'emergency',
    description: 'Emergency services, evacuation plans, and safety information',
    color: '#DC2626', // Red
    icon: 'alert-circle',
    categories: [
      { value: 'Evacuation', label: 'Evacuation', icon: '🚨' },
      { value: 'Bushfire', label: 'Bushfire', icon: '🔥' },
      { value: 'Flood', label: 'Flood', icon: '🌊' },
      { value: 'Police', label: 'Police', icon: '👮' },
      { value: 'Surf Life Saving', label: 'Surf Life Saving', icon: '🏖️' }
    ],
    statusOptions: ['Normal', 'Watch', 'Warning', 'Emergency'],
    alertLevels: {
      'Normal': { color: '#10B981', priority: 0 },
      'Watch': { color: '#F59E0B', priority: 1 },
      'Warning': { color: '#F97316', priority: 2 },
      'Emergency': { color: '#DC2626', priority: 3 }
    },
    fields: ['emergency', 'contact', 'links']
  },
  
  'services': {
    name: 'Services',
    slug: 'services',
    description: 'Community services, amenities, and development projects',
    color: '#1B365D', // Navy Blue
    icon: 'briefcase',
    categories: [
      { value: 'Amenities', label: 'Amenities', icon: '🏢' },
      { value: 'Projects', label: 'Projects', icon: '🏗️' }
    ],
    statusOptions: ['In Progress', 'Planning', 'Proposed', 'Advocating', 'Not Started', 'Completed', 'On Hold'],
    serviceTypes: ['Amenity', 'Developing Project', 'Proposed Project'],
    fields: ['service', 'contact', 'links', 'documents']
  },
  
  'environment': {
    name: 'Environment',
    slug: 'environment',
    description: 'Conservation, sustainability, and environmental programs',
    color: '#10B981', // Green
    icon: 'leaf',
    categories: [
      { value: 'Conservation', label: 'Conservation', icon: '🦘' },
      { value: 'Wildlife', label: 'Wildlife', icon: '🦜' },
      { value: 'Waterways', label: 'Waterways', icon: '💧' },
      { value: 'Bushland', label: 'Bushland', icon: '🌳' },
      { value: 'Sustainability', label: 'Sustainability', icon: '♻️' }
    ],
    statusOptions: ['Active Project', 'Monitoring', 'Completed'],
    fields: ['environment', 'contact', 'links', 'documents']
  },
  
  'history-culture': {
    name: 'History & Culture',
    slug: 'history',
    description: 'Indigenous heritage, local history, and cultural landmarks',
    color: '#92400E', // Brown
    icon: 'book-open',
    categories: [
      { value: 'Indigenous Heritage', label: 'Indigenous Heritage', icon: '🪃' },
      { value: 'Early Settlement', label: 'Early Settlement', icon: '🏘️' },
      { value: 'Industry & Work', label: 'Industry & Work', icon: '⚙️' },
      { value: 'Community Stories', label: 'Community Stories', icon: '📖' },
      { value: 'Places & Landmarks', label: 'Places & Landmarks', icon: '🗺️' }
    ],
    statusOptions: ['Published', 'Draft', 'Needs Research'],
    fields: ['history', 'links', 'documents']
  },
  
  'about': {
    name: 'About Our Area',
    slug: 'about',
    description: 'Information about Smiths Lake village and local area',
    color: '#F5A623', // Golden Orange
    icon: 'info',
    categories: [
      { value: 'General Info', label: 'General Info', icon: 'ℹ️' },
      { value: 'Demographics', label: 'Demographics', icon: '📊' },
      { value: 'Location & Access', label: 'Location & Access', icon: '📍' },
      { value: 'Facilities', label: 'Facilities', icon: '🏛️' }
    ],
    statusOptions: ['Published', 'Draft'],
    fields: ['contact', 'links', 'documents']
  }
};

// Helper function to get section by slug
export function getSectionBySlug(slug) {
  return Object.values(sections).find(section => section.slug === slug);
}

// Helper function to get section by name
export function getSectionByName(name) {
  return Object.values(sections).find(section => section.name === name);
}

// Helper function to get all section slugs
export function getAllSectionSlugs() {
  return Object.values(sections).map(section => section.slug);
}

// Helper function to get category display info
export function getCategoryInfo(sectionSlug, categoryValue) {
  const section = getSectionBySlug(sectionSlug);
  if (!section) return null;
  
  return section.categories.find(cat => cat.value === categoryValue);
}

// Status color mapping for badges
export const statusColors = {
  // Groups & Activities
  'Active': 'green',
  'Looking for Members': 'yellow',
  'Full': 'blue',
  'On Break': 'gray',
  'Inactive': 'red',
  
  // Services/Projects
  'In Progress': 'yellow',
  'Planning': 'blue',
  'Proposed': 'gray',
  'Advocating': 'green',
  'Not Started': 'gray',
  'Completed': 'green',
  'On Hold': 'red',
  
  // Environment
  'Active Project': 'green',
  'Monitoring': 'blue',
  
  // History
  'Published': 'green',
  'Draft': 'yellow',
  'Needs Research': 'orange'
};

export default sections;

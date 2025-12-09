# Smiths Lake Village Community Website

Official community website for Smiths Lake Village, Pacific Palms NSW, Australia.

**Live site:** [villagefirst.org.au](https://villagefirst.org.au)

## About

This website serves the Pacific Palms Community Association (PPCA) and the residents of Smiths Lake Village. It provides community information, emergency resources, and local services information.

## Technology Stack

- **Framework:** [Astro](https://astro.build/) 4.x
- **Hosting:** [Netlify](https://netlify.com)
- **Forms:** Netlify Forms with integrations to Notion and Mailchimp
- **Analytics:** Google Analytics 4

## Getting Started

### Prerequisites

- Node.js 18+ 
- npm or yarn

### Installation

```bash
# Clone the repository
git clone https://github.com/your-org/smiths-lake-website.git
cd smiths-lake-website

# Install dependencies
npm install

# Start development server
npm run dev
```

### Build

```bash
# Build for production
npm run build

# Preview production build locally
npm run preview
```

## Project Structure

```
/
├── public/              # Static assets (images, favicon, etc.)
├── src/
│   ├── components/      # Reusable Astro components
│   ├── layouts/         # Page layouts
│   ├── pages/           # File-based routing
│   │   ├── about/
│   │   ├── emergency/
│   │   ├── services/
│   │   ├── groups/
│   │   ├── environment/
│   │   └── history/
│   └── styles/          # Global CSS
├── astro.config.mjs     # Astro configuration
├── netlify.toml         # Netlify configuration
└── package.json
```

## Content Management

Content is edited through the Netlify Visual Editor by authorised section owners. Each section has designated content managers who can update their areas without technical knowledge.

### Section Structure

1. **About Us** - PPCA, Community Plan, Maps, Demographics
2. **Emergency & Safety** - Emergency contacts, evacuation, safety resources
3. **Services & Amenities** - Local services, developing projects
4. **Groups & Activities** - Community groups, clubs, volunteering
5. **Environment & Conservation** - Lake health, conservation programs
6. **History & Culture** - Local history, Indigenous heritage

## Forms

The website includes three main forms:

- **Contact Form** - General enquiries (→ Email + Notion)
- **Feedback Form** - Community suggestions (→ Notion)
- **Newsletter Signup** - Email subscriptions (→ Notion + Mailchimp)

## Deployment

The site automatically deploys to Netlify when changes are pushed to the main branch.

### Environment Variables

Set in Netlify dashboard:
- `GA_MEASUREMENT_ID` - Google Analytics 4 ID

## Accessibility

This site is built to WCAG 2.1 Level AA standards with:
- Semantic HTML
- ARIA labels where appropriate
- High contrast colours
- Keyboard navigation support
- Large touch targets (44px minimum)
- 18px base font size for readability

## Browser Support

- Chrome/Edge (last 2 versions)
- Firefox (last 2 versions)
- Safari (last 2 versions)
- Mobile browsers (iOS Safari, Chrome for Android)

## License

Content © Pacific Palms Community Association (PPCA). All rights reserved.

## Contact

For website issues, contact the PPCA via the [Contact Form](https://villagefirst.org.au/contact/).

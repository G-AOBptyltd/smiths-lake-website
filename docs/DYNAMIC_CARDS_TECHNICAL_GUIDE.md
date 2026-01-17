# Dynamic Card Display System - Technical Implementation Guide

**Version:** 1.0  
**Last Updated:** January 2026  
**Status:** Production - History Section  
**Future Rollout:** Groups, Services, Environment, Emergency sections

---

## 📋 **OVERVIEW**

The Dynamic Card Display System allows content editors to control how information appears on the website directly from Notion, without touching code. Each item can have different display templates and optional enhancements.

### **Current Implementation:**
- ✅ History & Culture section (fully implemented)
- ⏸️ Other sections (ready for rollout when needed)

---

## 🏗️ **ARCHITECTURE**

### **System Components:**

1. **Notion Database Fields:**
   - `Card Template` (Select) - Base display preset
   - `Card Options` (Multi-select) - Optional enhancements

2. **Backend Parsing:** (`notion-unified.js`)
   - Fields parsed universally for all sections
   - Returns null if fields don't exist (safe fallback)

3. **Frontend Rendering:** (e.g., `history/index.astro`)
   - Reads template and options
   - Builds configuration object
   - Renders cards dynamically

---

## 🔧 **NOTION DATABASE SETUP**

### **Field 1: Card Template**

**Configuration:**
- **Name:** `Card Template`
- **Type:** Select (single choice)
- **Required:** No (defaults to "Standard" if empty)

**Options:**
```
Minimal       → Title + Description + Button
Standard      → + Category + Year badges
Rich          → + Source + Last Updated date
Detailed      → + Source + People + Updated + All Statuses
Featured      → + All above + Large format + Highlight
```

**Technical Notes:**
- Field is optional - items without it default to "Standard"
- Can be added to any section in unified database
- Only affects sections that implement the rendering logic

### **Field 2: Card Options**

**Configuration:**
- **Name:** `Card Options`
- **Type:** Multi-select (multiple choices allowed)
- **Required:** No (defaults to empty array)

**Options:**
```
Show Source          → Display Source Attribution field
Show People          → Display Related People field
Show Updated Date    → Display Last Edited Time
Show All Statuses    → Display all status badges (not just primary)
Highlight Card       → Golden border + highlight background
Large Format         → Larger card with more spacing
Hide Description     → Only show title + metadata
Compact View         → Smaller, condensed card
```

**Technical Notes:**
- Options override template defaults
- Multiple options can be combined
- Empty array is safe default

---

## 💻 **CODE IMPLEMENTATION**

### **Step 1: Parse Fields in notion-unified.js**

Location: `/src/lib/notion-unified.js`

Add to `parseNotionPage()` function around line 168:

```javascript
// Card display control fields (universal - can be used by any section)
cardTemplate: parseProperty(props['Card Template']),
cardOptions: parseProperty(props['Card Options']),
```

**Why here?**
- Parsed once at data fetch time
- Available to all sections
- No duplicate parsing logic

### **Step 2: Create Configuration Function**

Location: Any page file (e.g., `/src/pages/history/index.astro`)

```javascript
function getCardDisplayConfig(item) {
  const template = item.cardTemplate || 'Standard';
  const options = item.cardOptions || [];
  
  // Base configuration per template
  const templateConfig = {
    'Minimal': {
      showCategory: false,
      showYear: false,
      showSource: false,
      showPeople: false,
      showUpdated: false,
      showAllStatuses: false,
      largeFormat: false,
      highlight: false,
    },
    'Standard': {
      showCategory: true,
      showYear: true,
      showSource: false,
      showPeople: false,
      showUpdated: false,
      showAllStatuses: false,
      largeFormat: false,
      highlight: false,
    },
    'Rich': {
      showCategory: true,
      showYear: true,
      showSource: true,
      showPeople: false,
      showUpdated: true,
      showAllStatuses: false,
      largeFormat: false,
      highlight: false,
    },
    'Detailed': {
      showCategory: true,
      showYear: true,
      showSource: true,
      showPeople: true,
      showUpdated: true,
      showAllStatuses: true,
      largeFormat: false,
      highlight: false,
    },
    'Featured': {
      showCategory: true,
      showYear: true,
      showSource: true,
      showPeople: true,
      showUpdated: true,
      showAllStatuses: true,
      largeFormat: true,
      highlight: true,
    },
  };
  
  // Get base config from template
  const config = templateConfig[template] || templateConfig['Standard'];
  
  // Apply option overrides
  if (options.includes('Show Source')) config.showSource = true;
  if (options.includes('Show People')) config.showPeople = true;
  if (options.includes('Show Updated Date')) config.showUpdated = true;
  if (options.includes('Show All Statuses')) config.showAllStatuses = true;
  if (options.includes('Large Format')) config.largeFormat = true;
  if (options.includes('Highlight Card')) config.highlight = true;
  if (options.includes('Hide Description')) config.hideDescription = true;
  if (options.includes('Compact View')) config.compactView = true;
  
  return config;
}
```

**Customization:**
- Modify `templateConfig` object to change template behavior
- Add new options by adding new `if` statements
- Add new templates by adding new keys to `templateConfig`

### **Step 3: Conditional Rendering**

```javascript
// Get display configuration
const config = getCardDisplayConfig(item);

// Build card classes
const cardClasses = [
  'timeline-card',
  config.largeFormat ? 'large-format' : '',
  config.compactView ? 'compact-view' : '',
  config.highlight ? 'highlight' : '',
].filter(Boolean).join(' ');

// Conditional metadata rendering
{(config.showSource || config.showPeople || config.showUpdated) && (
  <div class="card-metadata">
    {config.showSource && item.sourceAttribution && (
      <div class="metadata-row">
        <span class="metadata-icon">👤</span>
        <div>
          <span class="metadata-label">Source:</span>
          {item.sourceAttribution}
        </div>
      </div>
    )}
    
    {config.showPeople && item.relatedPeople && (
      <div class="metadata-row">
        <span class="metadata-icon">👥</span>
        <div>
          <span class="metadata-label">Related People:</span>
          {item.relatedPeople}
        </div>
      </div>
    )}
    
    {config.showUpdated && item.lastEditedTime && (
      <div class="metadata-row">
        <span class="metadata-icon">📅</span>
        <div>
          <span class="metadata-label">Updated:</span>
          {formatDate(item.lastEditedTime)}
        </div>
      </div>
    )}
  </div>
)}
```

---

## 🎨 **CSS STYLING**

### **Required CSS Classes:**

```css
/* Base card */
.timeline-card {
  /* Standard card styling */
}

/* Template modifiers */
.timeline-card.large-format {
  max-width: 500px;
  padding: 2.5rem;
}

.timeline-card.compact-view {
  padding: 1.5rem;
  max-width: 400px;
}

/* Highlight styling */
.timeline-card.highlight {
  border: 3px solid #F5A623;
  box-shadow: 0 6px 20px rgba(245, 166, 35, 0.3);
  background: linear-gradient(to bottom, white 0%, #FFFDF5 100%);
}

/* Featured banner */
.featured-banner {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  background: linear-gradient(135deg, #F5A623, #D4900F);
  color: white;
  border-radius: 20px;
  font-weight: 700;
  font-size: 0.875rem;
  margin-bottom: 1rem;
  text-transform: uppercase;
}

/* Metadata section */
.card-metadata {
  border-top: 1px solid #E5E7EB;
  padding-top: 1rem;
  margin-top: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.metadata-row {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  font-size: 0.9375rem;
  color: #6B7280;
}
```

---

## 🔄 **ROLLOUT TO OTHER SECTIONS**

### **Steps to Implement in New Section:**

1. **No Notion Changes Needed** - Fields already exist and parsed

2. **Copy Configuration Function**
   - Copy `getCardDisplayConfig()` to new page
   - Customize `templateConfig` if needed (section-specific needs)

3. **Add Conditional Rendering**
   - Use config object to show/hide elements
   - Apply CSS classes based on config

4. **Test**
   - Set test items to different templates
   - Verify all options work
   - Check mobile responsiveness

### **Example: Groups & Activities**

```javascript
// In /src/pages/groups/index.astro

// Use same getCardDisplayConfig() function
const config = getCardDisplayConfig(group);

// Apply to card rendering
<div class={`group-card ${config.largeFormat ? 'large-format' : ''} ${config.highlight ? 'highlight' : ''}`}>
  
  {config.highlight && (
    <div class="featured-banner">⭐ Featured Group</div>
  )}
  
  <h3>{group.title}</h3>
  
  {config.showCategory && (
    <span class="category-badge">{group.category}</span>
  )}
  
  {/* ... rest of card ... */}
  
  {(config.showSource || config.showUpdated) && (
    <div class="card-metadata">
      {config.showSource && group.contactPerson && (
        <div>👤 Contact: {group.contactPerson}</div>
      )}
      {config.showUpdated && (
        <div>📅 Updated: {formatDate(group.lastEditedTime)}</div>
      )}
    </div>
  )}
</div>
```

---

## 🛡️ **SAFETY & COMPATIBILITY**

### **Backward Compatibility:**
- ✅ Items without `Card Template` → Default to "Standard"
- ✅ Items without `Card Options` → Default to empty array `[]`
- ✅ Sections not using fields → Fields ignored, no impact

### **Multi-Section Safety:**
- ✅ Fields exist in unified database (all sections share them)
- ✅ Only sections with rendering logic use them
- ✅ Other sections ignore them completely
- ✅ No cross-section conflicts

### **Error Handling:**
```javascript
// Safe defaults prevent errors
const template = item.cardTemplate || 'Standard';
const options = item.cardOptions || [];

// Fallback for unknown templates
const config = templateConfig[template] || templateConfig['Standard'];

// Safe null checks
{config.showSource && item.sourceAttribution && (
  // Only renders if BOTH conditions true
)}
```

---

## 📊 **PERFORMANCE CONSIDERATIONS**

### **Build Time:**
- **Impact:** Negligible (~0.1% increase)
- **Reason:** Simple object lookups and conditional rendering
- **Optimization:** Configuration cached per item during map()

### **Runtime:**
- **Impact:** Zero (static HTML generated)
- **Client-side JS:** None (except "Read More" toggle)

### **Database Queries:**
- **Impact:** None (fields fetched in existing query)
- **Additional API calls:** Zero

---

## 🐛 **TROUBLESHOOTING**

### **Cards Not Showing Changes:**

**Problem:** Changed template in Notion, but website unchanged

**Solutions:**
1. Clear Netlify cache: Deploys → Clear cache and deploy
2. Check Notion field name exactly: `Card Template` (case-sensitive)
3. Verify item has `Show on Website = TRUE`
4. Wait for deploy to complete (~2-3 minutes)

### **Template Not Working:**

**Problem:** Template selected but shows as "Standard"

**Solutions:**
1. Check spelling in Notion matches exactly: `Featured` not `featured`
2. Verify `notion-unified.js` has parsing code
3. Check browser console for errors
4. Verify template name in `templateConfig` object

### **Options Not Applying:**

**Problem:** Card Options selected but not showing

**Solutions:**
1. Check option spelling: `Show Source` not `Show source`
2. Verify conditional rendering has matching option check
3. Check if CSS class exists for styling
4. Ensure field has data (e.g., `Show Source` needs `sourceAttribution`)

---

## 📈 **FUTURE ENHANCEMENTS**

### **Potential Additions:**

1. **Image Support**
   - Add Notion image field
   - Display in Featured/Large Format cards
   - Responsive image sizing

2. **Custom Colors**
   - Add Color field to Notion
   - Override default category colors
   - Per-item theming

3. **Animations**
   - Add Animation field
   - Scroll-triggered animations
   - Entry transitions

4. **Interactive Elements**
   - Add Interactive field
   - Expandable sections
   - Tabbed content

---

## 🔐 **MAINTENANCE**

### **Regular Tasks:**

**Monthly:**
- Review template usage analytics
- Identify unused options
- Gather editor feedback

**Quarterly:**
- Update template configurations based on usage
- Add new templates if needed
- Refine CSS styling

**Annually:**
- Audit all sections for consistency
- Update documentation
- Train new admins

---

## 📚 **RELATED DOCUMENTATION**

- [Notion API Documentation](https://developers.notion.com/)
- [Astro Framework Docs](https://docs.astro.build/)
- [Content Editor Guide](./HISTORY_CONTENT_GUIDE.md) ← For non-technical users

---

## ✅ **IMPLEMENTATION CHECKLIST**

### **For New Section Rollout:**

- [ ] Copy `getCardDisplayConfig()` function
- [ ] Customize template configurations if needed
- [ ] Add conditional rendering for each config option
- [ ] Add CSS classes (large-format, highlight, etc.)
- [ ] Test all 5 templates
- [ ] Test all 8 options
- [ ] Test combinations of templates + options
- [ ] Verify mobile responsiveness
- [ ] Update content editor guide
- [ ] Train editors on new section

---

## 🆘 **SUPPORT**

**Technical Issues:**
- Check build logs in Netlify
- Review browser console for JavaScript errors
- Verify Notion field names and types

**Questions:**
- Review this documentation first
- Check existing History section implementation as reference
- Consult with development team

---

**Document maintained by:** PPCA Technical Team  
**Last reviewed:** January 2026  
**Next review:** July 2026

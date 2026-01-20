# 🔧 Icon System Implementation Guide

**For: Rob Bain (Technical Reviewer)**  
**Date: January 2026**  
**Estimated Time: 30-45 minutes**

---

## 📋 Overview

This guide walks you through implementing the smart icon matching system across all website sections. The system automatically assigns appropriate icons to content based on titles, keywords, categories, and sections.

---

## 🎯 What You're Installing

- **1 new utility file** (`icon-matcher.js`)
- **Updates to 6 page files** (emergency, services, groups, environment, history, sitemap)
- **2 documentation files** (for committee members)
- **Zero npm dependencies** (pure JavaScript)

---

## 📦 Step 1: Add the Icon Matcher Utility

### **1.1 Create the utility file**

**File Location:** `/src/lib/icon-matcher.js`

**Action:** Copy the entire content from `icon-matcher.js` (provided in this package) into your GitHub repository at the path above.

**How to do this in GitHub:**
1. Navigate to your repository
2. Click `Add file` → `Create new file`
3. Name it: `src/lib/icon-matcher.js`
4. Paste the entire content
5. Commit with message: "Add smart icon matching utility"

**Verification:**
- File should be ~400 lines
- Contains `export function getSmartIcon(item)`
- Contains ~100+ icon mappings

---

## 📝 Step 2: Update Page Files

You need to update **6 Astro page files** to use the icon system. I'll show you the exact changes needed for each.

### **2.1 Emergency & Safety Page**

**File:** `/src/pages/emergency/index.astro`

**Line 1-10** - Add import at the top with other imports:
```javascript
import { getSmartIcon, getCategoryColor } from '../../lib/icon-matcher.js';
```

**Find this line** (around line 470):
```astro
<span class="icon-display">🚨</span>
```

**Replace with:**
```astro
<span class="icon-display">{getSmartIcon(item)}</span>
```

**Commit message:** "Integrate smart icons in emergency section"

---

### **2.2 Services & Amenities Page**

**File:** `/src/pages/services/index.astro`

**Line 1-10** - Add import:
```javascript
import { getSmartIcon, getCategoryColor } from '../../lib/icon-matcher.js';
```

**Find these lines** (around lines 390 and 550):
```astro
<span class="icon-display">🏢</span>
```

**Replace with:**
```astro
<span class="icon-display">{getSmartIcon(item)}</span>
```

**Commit message:** "Integrate smart icons in services section"

---

### **2.3 Groups & Activities Page**

**File:** `/src/pages/groups/index.astro`

**Line 1-10** - Add import:
```javascript
import { getSmartIcon, getCategoryColor } from '../../lib/icon-matcher.js';
```

**Find this line** (around line 450):
```astro
<span class="icon-display">👥</span>
```

**Replace with:**
```astro
<span class="icon-display">{getSmartIcon(item)}</span>
```

**Commit message:** "Integrate smart icons in groups section"

---

### **2.4 Environment & Sustainability Page**

**File:** `/src/pages/environment/index.astro`

**Line 1-10** - Add import:
```javascript
import { getSmartIcon, getCategoryColor } from '../../lib/icon-matcher.js';
```

**Find this line** (around line 320):
```astro
<span class="icon-display">🌍</span>
```

**Replace with:**
```astro
<span class="icon-display">{getSmartIcon(item)}</span>
```

**Commit message:** "Integrate smart icons in environment section"

---

### **2.5 History & Culture Page**

**File:** `/src/pages/history/index.astro`

**Line 1-10** - Add import:
```javascript
import { getSmartIcon, getCategoryColor } from '../../lib/icon-matcher.js';
```

**Find this line** (around line 670):
```astro
<span class="icon-display">📚</span>
```

**Replace with:**
```astro
<span class="icon-display">{getSmartIcon(item)}</span>
```

**Commit message:** "Integrate smart icons in history section"

---

### **2.6 Sitemap Page**

**File:** `/src/pages/sitemap.astro`

**Line 1-10** - Add import:
```javascript
import { getSmartIcon } from '../lib/icon-matcher.js';
```

**Find the icon display line** (varies by template):
```astro
<span class="icon-display">{/* current hardcoded emoji */}</span>
```

**Replace with:**
```astro
<span class="icon-display">{getSmartIcon(item)}</span>
```

**Commit message:** "Integrate smart icons in sitemap"

---

## 📚 Step 3: Add Documentation

### **3.1 Admin Guide**

**File:** `/docs/ADMIN_ICON_GUIDE.md`

**Action:** Copy the entire `ADMIN_ICON_GUIDE.md` file into your repository at `/docs/ADMIN_ICON_GUIDE.md`

**This is for:** Committee members who manage content

**Commit message:** "Add admin guide for icon system"

---

### **3.2 Icon Reference**

**File:** `/docs/ICON_MAPPING_REFERENCE.md`

**Action:** Create a quick reference file listing all available icons

**Content:** (Create a simple markdown file listing all 100+ icons by category)

**Commit message:** "Add icon mapping reference documentation"

---

## 🧪 Step 4: Testing

After implementing, test each section:

### **Testing Checklist:**

**Local Testing (if possible):**
```bash
npm run dev
```
Then visit each page and verify icons display correctly.

**Post-Deployment Testing:**

Visit these URLs after the 6am deployment:
- ✅ villagefirst.org.au/emergency/
- ✅ villagefirst.org.au/services/
- ✅ villagefirst.org.au/groups/
- ✅ villagefirst.org.au/environment/
- ✅ villagefirst.org.au/history/
- ✅ villagefirst.org.au/sitemap/

**What to Check:**
1. Icons display for all cards
2. Icons match the content (e.g., Fire Station shows 🚒)
3. No broken emoji or missing icons
4. Icon headers display correctly (if enabled)
5. Categories show appropriate colors

---

## 🐛 Troubleshooting

### **Problem: Icons not displaying**

**Possible Causes:**
1. Import path is wrong - check the `../../lib/` path matches your folder structure
2. Function name typo - must be exactly `getSmartIcon`
3. Item object is undefined - check data fetching works

**Solution:**
```javascript
// Add this temporarily to debug:
console.log('Item:', item);
console.log('Icon:', getSmartIcon(item));
```

---

### **Problem: All icons showing the same emoji**

**Cause:** The fallback is being used (no matches found)

**Solution:**
1. Check that `item.title` exists
2. Verify title is in the mapping lists
3. Add console log: `console.log('Title:', item.title);`

---

### **Problem: Build fails after adding import**

**Cause:** File path or syntax error

**Solution:**
1. Check import path: `'../../lib/icon-matcher.js'` (exact)
2. Verify icon-matcher.js has `export` statements
3. Check for typos in function names

---

## 🔄 Step 5: Deploy & Verify

### **5.1 Commit All Changes**

**Commit message template:**
```
feat: Implement smart icon matching system

- Add icon-matcher.js utility with 100+ mappings
- Update all section pages to use smart icons
- Add admin documentation for icon system
- Icons now automatically match content based on title/keywords
```

### **5.2 Push to GitHub**

```bash
git add .
git commit -m "feat: Implement smart icon matching system"
git push origin main
```

### **5.3 Wait for Deployment**

- **Next automated deploy:** 6:00 AM Sydney time
- **Manual trigger:** Use Netlify deploy trigger if urgent

### **5.4 Post-Deployment Verification**

**After deployment, verify:**
1. ✅ All 6 sections display correctly
2. ✅ Icons match content appropriately
3. ✅ No console errors in browser dev tools
4. ✅ Mobile display works correctly
5. ✅ Accessibility (screen readers announce icons)

---

## 📈 Step 6: Extending the System

### **Adding New Icon Mappings**

When committee adds new content types, update `/src/lib/icon-matcher.js`:

**Example: Adding a "Meditation Group"**

**File:** `/src/lib/icon-matcher.js`

**Find the exactMatches section, add:**
```javascript
'meditation group': '🧘',
```

**Or add to keywordMatches:**
```javascript
{ keywords: ['meditation', 'mindfulness'], icon: '🧘' },
```

**Commit & push** - changes apply at next deployment.

---

## 🎓 Advanced: Using Category Colors

The system also provides `getCategoryColor()` for dynamic coloring.

**Example usage:**
```astro
---
import { getSmartIcon, getCategoryColor } from '../../lib/icon-matcher.js';
const categoryColor = getCategoryColor(item.category);
---

<div style={{ borderLeftColor: categoryColor }}>
  <span>{getSmartIcon(item)}</span>
  {item.title}
</div>
```

---

## 📞 Support

**Questions during implementation?**
- Contact: Agility G
- Include: Screenshot of error or specific file/line number
- Provide: Browser console errors if relevant

**Post-implementation issues?**
- Check GitHub Actions logs for build errors
- Check Netlify deployment logs
- Test locally before pushing if possible

---

## ✅ Success Criteria

You'll know it's working when:
- ✅ Fire stations show 🚒
- ✅ Surf Life Saving shows 🏖️
- ✅ Boat ramps show 🚤
- ✅ Walking groups show 🥾
- ✅ Art groups show 🎨
- ✅ New content gets appropriate icons automatically

---

## 📊 Performance Impact

**Expected impact:**
- **Bundle size increase:** Negligible (~40KB uncompressed)
- **Runtime performance:** No measurable impact
- **Build time:** No change
- **SEO impact:** Positive (better semantic markup)

---

*Last Updated: January 2026*  
*Implementation Guide Version: 1.0*

# Icon System Deployment Checklist

**Part of Admin Playbook - Icon System Management**

Use this checklist when deploying icon system updates or troubleshooting icon-related issues.

---

## ✅ Pre-Deployment Checklist

### Repository Setup
- [ ] `/src/lib/icon-matcher.js` exists and has 400+ lines
- [ ] File includes `export function getSmartIcon(item)`
- [ ] File includes `export function getCategoryColor(category)`
- [ ] File has no syntax errors (check for unmatched braces)

### Page Files Updated
- [ ] `/src/pages/emergency/index.astro` imports icon-matcher
- [ ] `/src/pages/services/index.astro` imports icon-matcher
- [ ] `/src/pages/groups/index.astro` imports icon-matcher
- [ ] `/src/pages/environment/index.astro` imports icon-matcher
- [ ] `/src/pages/history/index.astro` imports icon-matcher
- [ ] `/src/pages/sitemap.astro` imports icon-matcher

### Icon Usage Implemented
- [ ] All hardcoded emojis replaced with `{getSmartIcon(item)}`
- [ ] No remaining `🚨`, `🏢`, `👥`, etc. hardcoded in templates
- [ ] Icon display wrapped in proper semantic HTML
- [ ] Icons have `role="img"` and `aria-label` attributes

### Documentation Added
- [ ] `/docs/ADMIN_ICON_GUIDE.md` exists
- [ ] `/docs/ICON_MAPPING_REFERENCE.md` exists
- [ ] `/docs/TECHNICAL_IMPLEMENTATION_GUIDE.md` exists
- [ ] README.md updated with icon system section

---

## 🧪 Testing Checklist

### Local Testing (if possible)
- [ ] Run `npm run dev` successfully
- [ ] Visit `/emergency/` - icons display correctly
- [ ] Visit `/services/` - icons display correctly
- [ ] Visit `/groups/` - icons display correctly
- [ ] Visit `/environment/` - icons display correctly
- [ ] Visit `/history/` - icons display correctly
- [ ] Visit `/sitemap/` - icons display correctly

### Browser Console
- [ ] No JavaScript errors in console
- [ ] No "undefined" errors for getSmartIcon
- [ ] No import/export errors

### Visual Verification
- [ ] Fire Station shows 🚒 (not 🚨)
- [ ] Surf Life Saving shows 🏖️
- [ ] Boat Ramps show 🚤
- [ ] Medical Centre shows 🏥
- [ ] Walking groups show 🥾
- [ ] Art groups show 🎨
- [ ] Landcare shows 🌳
- [ ] Waterways show 💧

---

## 🚀 Deployment Checklist

### GitHub Commit
- [ ] All changes committed with clear message
- [ ] Commit message follows convention: "feat: Add icon system"
- [ ] No merge conflicts
- [ ] Branch is up to date with main

### Push to Repository
- [ ] Changes pushed to GitHub successfully
- [ ] GitHub Actions workflow triggered
- [ ] Build completes without errors
- [ ] No TypeScript/ESLint errors

### Netlify Deployment
- [ ] Netlify build triggered (auto or manual)
- [ ] Build completes successfully
- [ ] Deploy preview available
- [ ] Production deploy successful

---

## ✓ Post-Deployment Verification

### Website Functionality
- [ ] Visit https://villagefirst.org.au
- [ ] Clear browser cache (Ctrl+Shift+R / Cmd+Shift+R)
- [ ] Homepage loads without errors

### Section-by-Section Check
- [ ] Emergency & Safety section:
  - [ ] Fire stations show 🚒
  - [ ] Surf Life Saving shows 🏖️
  - [ ] Medical services show 🏥
  - [ ] Police shows 👮
  - [ ] Boat ramps show 🚤

- [ ] Services & Amenities section:
  - [ ] Community halls show 🏛️
  - [ ] Toilets show 🚻
  - [ ] BBQ facilities show 🍖
  - [ ] Parks show 🎡

- [ ] Groups & Activities section:
  - [ ] Walking groups show 🥾
  - [ ] Art groups show 🎨
  - [ ] Sports groups show appropriate icons (⚽ 🎾 ⛳)
  - [ ] Social groups show ☕ or 🤝

- [ ] Environment section:
  - [ ] Landcare shows 🌳
  - [ ] Waterways show 💧
  - [ ] Wildlife shows 🦘 or 🦜
  - [ ] Recycling shows ♻️

- [ ] History section:
  - [ ] Indigenous content shows 🪃
  - [ ] Settlement history shows ⛵
  - [ ] General history shows 📜

- [ ] Sitemap:
  - [ ] All sections show appropriate icons
  - [ ] No generic 📋 icons (unless truly generic content)

### Mobile Testing
- [ ] Test on iPhone (Safari)
- [ ] Test on Android (Chrome)
- [ ] Icons display correctly at small sizes
- [ ] No layout issues caused by icons

### Accessibility Testing
- [ ] Screen reader announces icons properly
- [ ] Icon labels are meaningful
- [ ] Color contrast meets WCAG standards
- [ ] Keyboard navigation works

### Performance Check
- [ ] Page load time acceptable (<3 seconds)
- [ ] No console errors
- [ ] Lighthouse score still 90+ (if previously measured)

---

## 🐛 Troubleshooting Checklist

### If Icons Don't Display

**Check 1: Import Path**
- [ ] Import statement correct: `'../../lib/icon-matcher.js'`
- [ ] Path matches your folder structure
- [ ] No typos in filename

**Check 2: Function Call**
- [ ] Using `{getSmartIcon(item)}` not `getSmartIcon(item)`
- [ ] Item object has required properties (title, category, section)
- [ ] No undefined errors in console

**Check 3: Build Issues**
- [ ] GitHub Actions build completed
- [ ] Netlify deploy finished
- [ ] Check build logs for errors

### If Wrong Icons Display

**Check 1: Content Data**
- [ ] Verify title in Notion database
- [ ] Check category field is set correctly
- [ ] Ensure "Show on Website" is enabled

**Check 2: Mapping**
- [ ] Check if title should match exact mapping
- [ ] Verify keywords in title
- [ ] Review category fallback rules

**Check 3: Cache**
- [ ] Clear browser cache
- [ ] Hard refresh (Ctrl+Shift+R)
- [ ] Try incognito/private window

### If Some Sections Work, Others Don't

**Check:**
- [ ] Each file has correct import statement
- [ ] Each file calls `getSmartIcon(item)`
- [ ] Item object structure is consistent
- [ ] No copy-paste errors between files

---

## 📊 Validation Report Template

Use this after deployment to report status:

```
Icon System Deployment - [DATE]
Status: ✅ Success / ⚠️ Issues / ❌ Failed

Sections Updated:
- Emergency & Safety: ✅/❌
- Services & Amenities: ✅/❌
- Groups & Activities: ✅/❌
- Environment: ✅/❌
- History: ✅/❌
- Sitemap: ✅/❌

Issues Found:
[List any issues]

Icons Verified:
- Fire Station (🚒): ✅/❌
- Surf Life Saving (🏖️): ✅/❌
- Medical Centre (🏥): ✅/❌
- Walking Group (🥾): ✅/❌
- Art Group (🎨): ✅/❌
- Landcare (🌳): ✅/❌

Performance:
- Page Load Time: [X] seconds
- Console Errors: [X]
- Mobile Display: ✅/❌

Notes:
[Any observations]

Completed by: [Name]
Date: [Date]
```

---

## 🔄 Rollback Procedure

If deployment causes issues:

1. [ ] Identify the problematic commit
2. [ ] Revert changes in GitHub
3. [ ] Or: Remove icon-matcher import from affected files
4. [ ] Or: Replace `{getSmartIcon(item)}` with hardcoded emoji temporarily
5. [ ] Push fix to trigger new deployment
6. [ ] Verify site works
7. [ ] Document issue for later fixing

---

## 📝 Success Criteria

Deployment is successful when:

✅ All 6 sections display with appropriate icons  
✅ No JavaScript console errors  
✅ Icons match content semantically  
✅ Mobile display works correctly  
✅ Accessibility maintained  
✅ Page performance acceptable  
✅ Admin documentation available  

---

## 🎓 Training Checklist

After deployment, ensure:

- [ ] Committee members notified of new icon system
- [ ] Admin guide shared with content editors
- [ ] Icon reference accessible to team
- [ ] Training session scheduled (if needed)
- [ ] Support contact information provided

---

*Checklist Version: 1.0*  
*Last Updated: January 2026*

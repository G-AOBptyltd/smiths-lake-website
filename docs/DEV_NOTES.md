# DEV NOTES – Astro + Notion + Netlify

## 1. CRITICAL ASTRO RULE (Hard-Learned)
Astro files **must start with frontmatter**.

✅ Correct:
---
import Layout from '../layouts/BaseLayout.astro';
---

❌ Incorrect (will crash Astro compiler):
// Comment
---
import Layout from '../layouts/BaseLayout.astro';
---

No comments, whitespace, or BOM before `---`.

---

## 2. Astro Compiler Failure Symptoms
If you see errors like:
- `Expected ">" but found "class"`
- `html: bad parser state: originalIM was set twice`
- Random references to unrelated `.astro` files

👉 **Check frontmatter first.**
The error location is often misleading.

---

## 3. Notion → Astro Data Pattern
- All content comes from **one unified Notion database**
- Visibility controlled by:
  - `Show on Website` (Select: TRUE/FALSE)
  - `Section`
  - `Category`
  - `Display Locations` (for document libraries)
  - `Document Audience` (Public / Members)

Never hardcode content in Astro unless static by design.

---

## 4. Groups & Activities Page Rules
- Groups come from Section = `Groups & Activities`
- Category drives page placement:
  - Sports
  - Arts & Culture
  - Hobbies
  - Social
  - Service
- Optional links:
  - Website URL
  - Facebook URL
  - Group Info Document (Notion URL)

Circular links are filtered in code.

---

## 5. DocumentLibrary Component
- Powered by `getDocuments(displayLocation, audience)`
- Requires:
  - Record Type = `Document`
  - Show on Website = TRUE
  - Matching Display Locations value

Documents are **not pages** — they are references.

---

## 6. Deployment
- Netlify build uses:
  - Node 22
  - Astro 4.x
- If build fails after content change:
  1. Check Astro frontmatter
  2. Check Notion Select values (exact spelling)
  3. Re-deploy (cache is safe)

---

## 7. Golden Rule
If something breaks mysteriously:
👉 **Undo the last Astro file edit and check the first line.**

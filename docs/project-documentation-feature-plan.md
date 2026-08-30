# Project Documentation feature — implementation plan

**Module:** `/admin/projects/` (VF1 Projects system of record)
**Goal:** A new **Documentation** pill on every project that lets a village (a) upload/drag-drop a
document into its Google Drive documentation folder, (b) link to a document that already exists in
that Drive repository, tagging it as **Reference** or **Evidence** (e.g. an invoice PDF/image), and
(c) export a generated **Steering-Committee summary report** from the project's own data back into
the folder.

**Hard requirement:** generic for **any** village. Nothing is hardcoded to Smiths Lake — the Drive
folder is resolved per-village from the VF Villages registry.

---

## Decisions (locked)

| Decision | Choice |
|---|---|
| Storage backend | **Google Drive** — reuse the existing Google OAuth identity (`googleapis@144`, already installed). |
| Multi-village Drive model | **One platform identity, folder-per-village.** The existing OAuth account owns a root; each village = a subfolder whose ID is stored per-village in the VF Villages registry. |
| v1 scope | **Upload + link/browse + Evidence tagging** (Phases 0–2). Steering-Committee report export is Phase 3. |
| Notion model | **Dedicated `VF Project Documents` DB** (one row per doc) — the proper, project-scoped evolution of the interim `notionDocuments.ts` links DB. |

---

## What we build on (existing, verified)

- **Pill menu** — `public/admin/projects/index.html` detail view already has `.tabs` pills
  (*Overview / Budget / Schedule / Grants / Volunteers / Reports*), `showTab()` switching, one
  `.tabpanel` per pill. We add a **Documentation** pill the same way.
- **Auth** — Netlify Identity JWT; `requireRole(context, { village, anyOf })` in `_auth.js`; roles are
  namespaced `village:role`. Projects use `['admin','treasurer','pm']`. Client sends `authHeaders()`
  (Bearer JWT).
- **Function helpers** — `_projects.js`: `notionHeaders()`, `jsonResp()`, `rtChunks()` (chunk >2000-char
  strings across Notion rich_text segments), schema self-heal pattern (`ensureProjectSchema`).
- **Per-village config** — `_villages.js` → `queryVillage()` already returns per-village Content DB ID,
  News Build Hook, Notify Emails, Module-access matrix. We add one field: **Docs Root Folder ID**.
- **Google Drive already wired** — survey functions use `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` /
  `GOOGLE_REFRESH_TOKEN` with `google.auth.OAuth2`. `scripts/get-google-token.mjs` already requests the
  `drive.file` scope. We reuse this identity — **no new auth system**.
- **Upload transport precedent** — `news-image.js`: client base64-encodes a file and POSTs
  `{ ..., dataBase64 }`; server decodes and stores. 8 MB cap keeps us under Netlify's ~6 MB body limit
  (base64 inflates ~33%). Same transport for documents.
- **Interim pattern being replaced** — `src/lib/notionDocuments.ts` stores Google Drive **URLs** in a
  Notion "Documents" DB and surfaces them publicly. New feature is the project-scoped, managed version.

---

## Architecture

```
Admin UI (public/admin/projects/index.html)
  └─ "Documentation" pill  ──fetch(/api/project-docs, Bearer JWT)──▶  netlify/functions/project-docs.js
         · drag-drop upload (base64)                                        │
         · browse village Drive root → pick folder → pick file             ├─ _auth.requireRole(admin|treasurer|pm)
         · link picked/pasted file, tag Reference|Evidence                 ├─ _villages.getVillageRecord() → Docs Root Folder ID
         · list registered docs, remove                                    ├─ _gdrive.getDrive()  (OAuth2 refresh token)
                                                                           ├─ _gdrive.ensureProjectFolder(root, project)
                                                                           └─ Notion: VF Project Documents DB (register/list/remove)

Google Drive (owned by the platform OAuth identity)
  <village docs root>/<Project name>/ ── uploaded + generated files live here
```

**Per-village resolution:** every request carries `village`; the function resolves that village's
**Docs Root Folder ID** from the registry (fallback: `VILLAGE_DOCS_ROOT_FOLDER_ID` env, then the
Smiths Lake default folder). A per-project subfolder is auto-created/found under the root by name.

---

## Data model — new Notion DB: `VF Project Documents`

Env: `NOTION_VF_PROJECT_DOCS_DB_ID`. One row per document.

| Property | Type | Notes |
|---|---|---|
| Title | title | Document display name |
| Village | rich_text | Tenant key (matches `village` in every call) |
| Project | rich_text | Project **slug** (links to the Projects DB row) |
| Type | select | `Reference` \| `Evidence` \| `Report` |
| Drive File ID | rich_text | Google Drive file id |
| Drive URL | url | `webViewLink` for click-through |
| MIME | rich_text | content type |
| Size | number | bytes |
| Source | select | `Uploaded` \| `Linked` \| `Generated` |
| Grant | rich_text | (optional) grant slug an Evidence doc supports — enables acquittal bundling |
| Uploaded By | rich_text | Identity email |
| Uploaded At | date | ISO |

Self-healed on first use (create-if-missing), mirroring the existing project-DB schema pattern.

---

## Registry change (makes it generic)

Add **Docs Root Folder ID** (rich_text) to the **VF Villages** DB and extend
`_villages.js` `queryVillage()` / `getVillageRecord()` to return `docsRootFolderId`, with fallback:
`rec.docsRootFolderId ?? process.env.VILLAGE_DOCS_ROOT_FOLDER_ID ?? '<Smiths Lake default folder id>'`.

Each new village sets its own folder id here → feature works for any village with zero code change.

---

## New/changed files

**New**
- `netlify/functions/_gdrive.js` — shared Drive helper (mirrors survey `getSheets()`):
  - `getDrive()` → `google.drive({version:'v3', auth})` from the refresh token.
  - `ensureProjectFolder(rootId, projectName)` → find-or-create the per-project subfolder, return id.
  - `uploadFile(folderId, {name, mimeType, buffer})` → `files.create`, return `{id, webViewLink}`.
  - `listChildren(folderId)` → `files.list` (folders + files) for the browse picker.
- `netlify/functions/project-docs.js` — the module's single endpoint:
  - `GET  ?village&project` → list registered docs (from the DB), grouped by Type.
  - `POST { action:'upload', village, project, filename, contentType, dataBase64, type }`
    → decode → `ensureProjectFolder` → `uploadFile` → register row (Source=Uploaded).
  - `POST { action:'browse', village, folderId? }` → `listChildren` under the village root (or a
    chosen subfolder) for the "select project folder → select document" picker.
  - `POST { action:'link', village, project, driveFileId, title, type }` → register an existing Drive
    file (Source=Linked). Also accepts a pasted Drive URL (parse the id).
  - `POST { action:'remove', village, docId, alsoTrash? }` → unregister row; optional Drive trash.
  - All guarded by `requireRole(context, { village, anyOf:['admin','treasurer','pm'] })`.

**Changed**
- `public/admin/projects/index.html` — add the **Documentation** pill + `.tabpanel`:
  drag-drop zone (base64, reusing the news-image approach), a Drive browser (folder→file), a
  Reference/Evidence type selector, and a list of registered docs with open/remove.
- `netlify/functions/_villages.js` — return `docsRootFolderId` from the registry.
- `netlify.toml` — add `[[redirects]] /api/project-docs → /.netlify/functions/project-docs`.
- `scripts/get-google-token.mjs` — broaden scope (see ops note) and re-mint the refresh token.

---

## One-time ops step — OAuth scope

`drive.file` only exposes files the app **created** (or files a user explicitly opens via Google
Picker). To **browse an existing** documentation folder (requirement 2), broaden the platform
identity's scope to include `https://www.googleapis.com/auth/drive` (needed anyway to create the
per-project subfolders and upload). Steps: add the scope to `scripts/get-google-token.mjs`, re-run it,
replace `GOOGLE_REFRESH_TOKEN` in Netlify env. Existing survey Sheets/Drive usage is unaffected
(scopes are additive).

> Alternative considered: client-side **Google Picker** keeps scope at `drive.file`, but requires each
> admin to authenticate their own Google account against the folder — community volunteers often
> won't have that access. The platform-identity model matches how surveys already work, so we stay
> server-side.

---

## Phasing

**Phase 0 — plumbing**
1. Add `Docs Root Folder ID` to VF Villages; extend `_villages.js`.
2. Create/self-heal `VF Project Documents` DB; add `NOTION_VF_PROJECT_DOCS_DB_ID`.
3. Add `_gdrive.js`; broaden OAuth scope + re-mint refresh token.
4. Add the `/api/project-docs` redirect.

**Phase 1 — pill + upload + link/browse (req 1, 2a, 2b)**
5. `project-docs.js` (upload / browse / link / remove / list).
6. Documentation pill UI: drag-drop, Drive browser, Reference/Evidence tag, doc list.

**Phase 2 — evidence bundling (req 2b polish)**
7. Surface `Type=Evidence` docs on the **Grants** tab; "download evidence bundle" per grant
   (docs whose `Grant` = that grant's slug). Directly supports grant acquittal.

**Phase 3 — Steering-Committee report export (req 2c)**
8. Generate a branded summary from the existing `projects-get` aggregate (project, schedule, budget,
   rollups, grants, volunteers/hours, exec summary) → HTML → PDF (reuse the HTML-deck→PDF recipe) →
   upload to the project Drive folder → register as `Type=Report, Source=Generated`.

---

## Risks / notes

- **Drive ownership/quota:** files created by the platform OAuth identity are owned by that account and
  count against its Drive quota. Fine at community scale; if a village later needs true co-ownership,
  migrate that village to a Google **Shared Drive** (folder id in the registry stays the switch point).
- **Netlify body limit ~6 MB** → keep the 8 MB base64 cap and show a clear "file too large" message;
  large PDFs/scans may need chunked/resumable upload later (out of scope for v1).
- **Fail-safe:** if Drive isn't configured for a village (no folder id / no token), the pill shows a
  friendly "documentation storage not configured" state instead of erroring — same fail-open ethos as
  `_villages.js`.
- **Public gating:** documents stay admin-only by default; the `notionDocuments.ts` public surface is
  untouched. Any future "make public" is a deliberate, separately-gated step (per the publicity rule).

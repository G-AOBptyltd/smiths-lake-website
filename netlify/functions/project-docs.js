/**
 * project-docs.js — Documentation for the Projects system of record.
 *
 *  All routes are village-scoped and gated to admin | treasurer | pm (the same
 *  roles that may see the Projects module). Documents physically live in the
 *  village's OWN Google Drive folder (resolved per-village from the VF Villages
 *  registry — see _villages.getDocsRootFolderId), and each document is registered
 *  as a row in the self-healing "VF Project Documents" Notion DB so the committee
 *  can see, tag (Reference / Evidence / Report) and manage them from the console.
 *
 *  GET  /api/project-docs?village=..&project=<slug>
 *       → { ok, docs:[…], driveConfigured, docsDbReady }
 *
 *  POST /api/project-docs   (JSON body, action-dispatched)
 *    { action:'upload', village, project, projectName, filename, contentType,
 *      dataBase64, type, grant? }         → create the file in Drive + register
 *    { action:'link',   village, project, projectName, driveUrl|driveFileId,
 *      title, type, grant? }              → register an existing Drive file
 *    { action:'browse', village, folderId? }
 *                                          → list a Drive folder for the picker
 *    { action:'remove', village, docId, driveFileId?, alsoTrash? }
 *                                          → unregister (optionally trash in Drive)
 *
 * Fail-safe: if Drive or the docs DB isn't available for a village, reads return
 * empty with flags set so the UI shows a friendly "not configured" state rather
 * than an error — matching the fail-open ethos of the rest of the platform.
 */

import { requireRole } from './_auth.js';
import { notionHeaders, jsonResp, PROJECTS_DB } from './_projects.js';
import { getDocsRootFolderId } from './_villages.js';
import {
  driveConfigured, getDrive, ensureProjectFolder, uploadFile, listChildren,
  getFileMeta, trashFile, idFromUrl, isScopeError, webViewLinkFor,
} from './_gdrive.js';

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB (base64 body stays under Netlify's ~6 MB raw cap headroom)
const DOC_TYPES = ['Reference', 'Evidence', 'Report'];
const NOTION = 'https://api.notion.com/v1';

const rt = (p) => (p?.rich_text || []).map((t) => t.plain_text).join('');
function normType(t) { return DOC_TYPES.includes(t) ? t : 'Reference'; }

// ── Docs DB resolution (env → search → self-heal create) ─────────────────────
let cachedDocsDb = process.env.NOTION_VF_PROJECT_DOCS_DB_ID || null;
let docsDbResolved = false;

async function findDocsDb() {
  try {
    const res = await fetch(`${NOTION}/search`, {
      method: 'POST', headers: notionHeaders(),
      body: JSON.stringify({ query: 'VF Project Documents', filter: { property: 'object', value: 'database' }, page_size: 20 }),
    });
    if (!res.ok) return null;
    const hits = (await res.json()).results || [];
    const hit = hits.find((d) => ((d.title || []).map((t) => t.plain_text).join('').includes('VF Project Documents')) && !d.archived);
    return hit ? hit.id : null;
  } catch (_) { return null; }
}

// Self-heal: create the DB under the SAME parent page as the Projects DB, so the
// runtime Notion integration owns it (no manual "share with integration" step —
// avoids the child-DB-doesn't-inherit-connections gotcha).
async function createDocsDb() {
  if (!PROJECTS_DB) return null;
  try {
    const meta = await fetch(`${NOTION}/databases/${PROJECTS_DB}`, { headers: notionHeaders() });
    if (!meta.ok) return null;
    const parent = (await meta.json()).parent || {};
    if (parent.type !== 'page_id' || !parent.page_id) return null; // can only create under a page
    const res = await fetch(`${NOTION}/databases`, {
      method: 'POST', headers: notionHeaders(),
      body: JSON.stringify({
        parent: { type: 'page_id', page_id: parent.page_id },
        title: [{ type: 'text', text: { content: 'VF Project Documents' } }],
        properties: {
          Title: { title: {} },
          Village: { rich_text: {} },
          Project: { rich_text: {} },
          Type: { select: { options: [
            { name: 'Reference', color: 'blue' },
            { name: 'Evidence', color: 'orange' },
            { name: 'Report', color: 'green' },
          ] } },
          'Drive File ID': { rich_text: {} },
          'Drive URL': { url: {} },
          MIME: { rich_text: {} },
          Size: { number: { format: 'number' } },
          Source: { select: { options: [
            { name: 'Uploaded', color: 'purple' },
            { name: 'Linked', color: 'gray' },
            { name: 'Generated', color: 'green' },
          ] } },
          Grant: { rich_text: {} },
          'Uploaded By': { rich_text: {} },
          'Uploaded At': { date: {} },
        },
      }),
    });
    if (!res.ok) return null;
    return (await res.json()).id || null;
  } catch (_) { return null; }
}

async function ensureDocsDb() {
  if (docsDbResolved) return cachedDocsDb;
  if (!cachedDocsDb) cachedDocsDb = await findDocsDb();
  if (!cachedDocsDb) cachedDocsDb = await createDocsDb();
  docsDbResolved = true;
  return cachedDocsDb;
}

function parseDoc(page) {
  const p = page.properties || {};
  return {
    id: page.id,
    title: p.Title?.title?.[0]?.plain_text || '(untitled)',
    village: rt(p.Village),
    project: rt(p.Project),
    type: p.Type?.select?.name || 'Reference',
    driveFileId: rt(p['Drive File ID']),
    url: p['Drive URL']?.url || '',
    mime: rt(p.MIME),
    size: p.Size?.number ?? null,
    source: p.Source?.select?.name || 'Linked',
    grant: rt(p.Grant),
    uploadedBy: rt(p['Uploaded By']),
    uploadedAt: p['Uploaded At']?.date?.start || page.created_time || null,
  };
}

async function listDocs(dbId, village, project) {
  const res = await fetch(`${NOTION}/databases/${dbId}/query`, {
    method: 'POST', headers: notionHeaders(),
    body: JSON.stringify({
      filter: { and: [
        { property: 'Village', rich_text: { equals: village } },
        { property: 'Project', rich_text: { equals: project } },
      ] },
      sorts: [{ property: 'Uploaded At', direction: 'descending' }],
    }),
  });
  if (!res.ok) return [];
  return ((await res.json()).results || []).map(parseDoc);
}

async function registerDoc(dbId, doc) {
  const props = {
    Title: { title: [{ text: { content: (doc.title || 'document').slice(0, 1900) } }] },
    Village: { rich_text: [{ text: { content: doc.village || '' } }] },
    Project: { rich_text: [{ text: { content: doc.project || '' } }] },
    Type: { select: { name: normType(doc.type) } },
    'Drive File ID': { rich_text: [{ text: { content: doc.driveFileId || '' } }] },
    'Drive URL': { url: doc.url || null },
    MIME: { rich_text: [{ text: { content: doc.mime || '' } }] },
    Source: { select: { name: doc.source || 'Linked' } },
    'Uploaded By': { rich_text: [{ text: { content: doc.uploadedBy || '' } }] },
    'Uploaded At': { date: { start: doc.uploadedAt || new Date().toISOString() } },
  };
  if (doc.size != null) props.Size = { number: doc.size };
  if (doc.grant) props.Grant = { rich_text: [{ text: { content: doc.grant } }] };
  const res = await fetch(`${NOTION}/pages`, {
    method: 'POST', headers: notionHeaders(),
    body: JSON.stringify({ parent: { database_id: dbId }, properties: props }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Could not register document: ${res.status} ${err.slice(0, 200)}`);
  }
  return parseDoc(await res.json());
}

export const handler = async (event, context) => {
  const method = event.httpMethod;

  // ── GET: list a project's documents ────────────────────────────────────────
  if (method === 'GET') {
    const village = event.queryStringParameters?.village || process.env.VILLAGE_NAME || 'Smiths Lake';
    const project = event.queryStringParameters?.project || '';
    const auth = requireRole(context, { village, anyOf: ['admin', 'treasurer', 'pm'] });
    if (!auth.ok) return jsonResp(auth.status, { error: auth.error });
    if (!project) return jsonResp(400, { error: 'Missing project' });
    const dbId = await ensureDocsDb();
    let docs = [];
    if (dbId) { try { docs = await listDocs(dbId, village, project); } catch (_) { docs = []; } }
    let docsRootFolderId = null;
    try { docsRootFolderId = await getDocsRootFolderId(village); } catch (_) {}
    return jsonResp(200, { ok: true, docs, driveConfigured: driveConfigured(), docsDbReady: !!dbId, docsRootFolderId });
  }

  if (method !== 'POST') return jsonResp(405, { error: 'GET or POST only' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return jsonResp(400, { error: 'Invalid JSON' }); }
  const village = body.village || process.env.VILLAGE_NAME || 'Smiths Lake';
  const auth = requireRole(context, { village, anyOf: ['admin', 'treasurer', 'pm'] });
  if (!auth.ok) return jsonResp(auth.status, { error: auth.error });
  const actorEmail = (auth.user && auth.user.email) || '';
  const action = body.action || '';

  // ── browse: list a Drive folder for the "pick from repository" picker ───────
  if (action === 'browse') {
    const drive = await getDrive();
    if (!drive) return jsonResp(503, { error: 'Google Drive is not configured for this platform.' });
    const rootId = await getDocsRootFolderId(village);
    const folderId = body.folderId || rootId;
    try {
      const items = await listChildren(drive, folderId);
      return jsonResp(200, { ok: true, folderId, rootId, items });
    } catch (e) {
      if (isScopeError(e)) {
        return jsonResp(200, {
          ok: false, scopeError: true, folderId, rootId,
          message: 'Browsing the existing Drive folder needs a one-time Google re-authorisation. You can still upload a file, or paste a Drive link below.',
        });
      }
      return jsonResp(502, { error: 'Drive listing failed: ' + (e.message || 'unknown') });
    }
  }

  // Everything below writes to the docs DB.
  const dbId = await ensureDocsDb();
  if (!dbId) return jsonResp(503, { error: 'Document library is not set up for this village yet.' });

  // ── upload: store a new file in the village's Drive folder ──────────────────
  if (action === 'upload') {
    const project = body.project || '';
    if (!project) return jsonResp(400, { error: 'Missing project' });
    if (!body.dataBase64) return jsonResp(400, { error: 'No file data' });
    const drive = await getDrive();
    if (!drive) return jsonResp(503, { error: 'Google Drive is not configured for this platform.' });

    const buffer = Buffer.from(body.dataBase64, 'base64');
    if (!buffer.length) return jsonResp(400, { error: 'Empty file' });
    if (buffer.length > MAX_BYTES) return jsonResp(413, { error: 'File too large (max 8 MB). For a bigger file, upload it to Drive directly and use "Link a document".' });

    try {
      const rootId = await getDocsRootFolderId(village);
      const folder = await ensureProjectFolder(drive, rootId, body.projectName || project);
      const filename = String(body.filename || 'document').slice(0, 240);
      const up = await uploadFile(drive, folder.id, { name: filename, mimeType: body.contentType, buffer });
      const doc = await registerDoc(dbId, {
        title: filename, village, project, type: normType(body.type),
        driveFileId: up.id, url: up.url, mime: up.mimeType, size: up.size,
        source: 'Uploaded', grant: body.grant || '', uploadedBy: actorEmail,
        uploadedAt: new Date().toISOString(),
      });
      return jsonResp(200, { ok: true, doc });
    } catch (e) {
      if (isScopeError(e)) return jsonResp(502, { error: 'Google could not write to this village\'s Drive folder — check the folder is shared with the platform account, or re-authorise Drive access.' });
      return jsonResp(502, { error: 'Upload failed: ' + (e.message || 'unknown') });
    }
  }

  // ── link: register a document that already exists in Drive ──────────────────
  if (action === 'link') {
    const project = body.project || '';
    if (!project) return jsonResp(400, { error: 'Missing project' });
    const fileId = idFromUrl(body.driveFileId || body.driveUrl || '');
    if (!fileId) return jsonResp(400, { error: 'Could not read a Google Drive file/URL. Paste a link like https://drive.google.com/file/d/…' });

    let title = String(body.title || '').trim();
    let mime = '';
    let url = webViewLinkFor(fileId, false);
    let size = null;
    // Best-effort metadata (needs broad scope) — never block a link on it.
    const drive = await getDrive();
    if (drive) {
      try { const m = await getFileMeta(drive, fileId); title = title || m.name; mime = m.mimeType || ''; url = m.url || url; size = m.size; }
      catch (_) { /* narrow scope or not found — keep the pasted link */ }
    }
    if (!title) title = 'Linked document';
    try {
      const doc = await registerDoc(dbId, {
        title, village, project, type: normType(body.type),
        driveFileId: fileId, url, mime, size,
        source: 'Linked', grant: body.grant || '', uploadedBy: actorEmail,
        uploadedAt: new Date().toISOString(),
      });
      return jsonResp(200, { ok: true, doc });
    } catch (e) {
      return jsonResp(502, { error: e.message || 'Could not register document' });
    }
  }

  // ── remove: unregister (and optionally trash the Drive file) ────────────────
  if (action === 'remove') {
    const docId = body.docId || '';
    if (!docId) return jsonResp(400, { error: 'Missing docId' });
    try {
      await fetch(`${NOTION}/pages/${docId}`, {
        method: 'PATCH', headers: notionHeaders(), body: JSON.stringify({ archived: true }),
      });
    } catch (e) {
      return jsonResp(502, { error: 'Could not remove document: ' + (e.message || 'unknown') });
    }
    if (body.alsoTrash && body.driveFileId) {
      const drive = await getDrive();
      if (drive) { try { await trashFile(drive, body.driveFileId); } catch (_) { /* best-effort */ } }
    }
    return jsonResp(200, { ok: true });
  }

  return jsonResp(400, { error: 'Unknown action' });
};

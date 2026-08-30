/**
 * _gdrive.js — shared Google Drive helper for the Projects Documentation module.
 *
 * Files prefixed with "_" are NOT deployed as standalone endpoints, only imported.
 *
 * Reuses the SAME Google OAuth identity the survey platform already uses
 * (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN — the
 * admin@villagefirst.org.au account). No new auth system.
 *
 * Scope notes (see scripts/get-google-token.mjs):
 *   - Uploading a NEW file and creating a per-project subfolder work under the
 *     existing `drive.file` scope (the app owns files it creates).
 *   - BROWSING an existing folder's arbitrary contents (listChildren / getFileMeta
 *     on files the app didn't create) needs the broader `drive`/`drive.readonly`
 *     scope. When the current token lacks it, Drive returns 403 insufficient
 *     scope; we surface that as { scopeError:true } so the UI can show a friendly
 *     "re-authorise" hint and fall back to link-by-URL, which needs no read.
 *
 * All calls pass supportsAllDrives/includeItemsFromAllDrives so the same code
 * works whether a village's docs root lives in My Drive or a Shared Drive.
 */

let _driveClient = null;

export function driveConfigured() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN);
}

/** Lazily build (and cache) an authenticated Drive v3 client, or null if unconfigured. */
export async function getDrive() {
  if (_driveClient) return _driveClient;
  if (!driveConfigured()) return null;
  try {
    const { google } = await import('googleapis');
    const auth = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
    auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
    _driveClient = google.drive({ version: 'v3', auth });
    return _driveClient;
  } catch (e) {
    console.error('getDrive init failed:', e && e.message);
    return null;
  }
}

/** Is this Drive error a missing-scope / permission problem (vs a transient fault)? */
export function isScopeError(err) {
  const code = err && (err.code || err.status);
  const reason = err && err.errors && err.errors[0] && err.errors[0].reason;
  const msg = String((err && err.message) || '').toLowerCase();
  return code === 403 || reason === 'insufficientPermissions' || reason === 'insufficientFilePermissions'
    || msg.includes('insufficient') || msg.includes('scope');
}

/** Extract a Drive folder/file id from a pasted URL (or return the input if it already looks like an id). */
export function idFromUrl(input) {
  const s = String(input || '').trim();
  if (!s) return '';
  // https://drive.google.com/drive/folders/<ID>   or  .../folders/<ID>?usp=...
  let m = s.match(/\/folders\/([a-zA-Z0-9_-]{10,})/);
  if (m) return m[1];
  // https://drive.google.com/file/d/<ID>/view      or  /d/<ID>
  m = s.match(/\/d\/([a-zA-Z0-9_-]{10,})/);
  if (m) return m[1];
  // https://docs.google.com/...?id=<ID>  or  ...open?id=<ID>
  m = s.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
  if (m) return m[1];
  // Bare id
  if (/^[a-zA-Z0-9_-]{16,}$/.test(s)) return s;
  return '';
}

/** A stable webViewLink for a Drive id (used when the API doesn't hand one back). */
export function webViewLinkFor(id, isFolder) {
  return isFolder
    ? `https://drive.google.com/drive/folders/${id}`
    : `https://drive.google.com/file/d/${id}/view`;
}

function escQ(s) { return String(s || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }

const FOLDER_MIME = 'application/vnd.google-apps.folder';

/**
 * Find-or-create a subfolder named `name` under `parentId`. Returns { id, url }.
 * The find step only sees folders the app can list (all folders under the broad
 * scope; app-created ones under drive.file) — so under the narrow scope a fresh
 * upload may create a new "<Project>" folder rather than reuse a hand-made one.
 * Acceptable for v1; dedupes cleanly once the broader scope is granted.
 */
export async function ensureProjectFolder(drive, parentId, name) {
  const clean = String(name || 'Project').trim() || 'Project';
  try {
    const q = `mimeType='${FOLDER_MIME}' and name='${escQ(clean)}' and '${parentId}' in parents and trashed=false`;
    const res = await drive.files.list({
      q, fields: 'files(id,name)', pageSize: 5,
      supportsAllDrives: true, includeItemsFromAllDrives: true,
    });
    const hit = (res.data.files || [])[0];
    if (hit) return { id: hit.id, url: webViewLinkFor(hit.id, true) };
  } catch (e) {
    if (!isScopeError(e)) throw e; // scope error → fall through and create
  }
  const created = await drive.files.create({
    requestBody: { name: clean, mimeType: FOLDER_MIME, parents: [parentId] },
    fields: 'id, webViewLink',
    supportsAllDrives: true,
  });
  return { id: created.data.id, url: created.data.webViewLink || webViewLinkFor(created.data.id, true) };
}

/** Upload a buffer as a file into `folderId`. Returns Drive metadata. */
export async function uploadFile(drive, folderId, { name, mimeType, buffer }) {
  const { Readable } = await import('stream');
  const res = await drive.files.create({
    requestBody: { name: name || 'document', parents: [folderId] },
    media: { mimeType: mimeType || 'application/octet-stream', body: Readable.from(buffer) },
    fields: 'id, name, mimeType, size, webViewLink',
    supportsAllDrives: true,
  });
  const f = res.data;
  return {
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    size: Number(f.size) || buffer.length,
    url: f.webViewLink || webViewLinkFor(f.id, false),
  };
}

/** List folders + files directly under `folderId` (needs broad scope). */
export async function listChildren(drive, folderId) {
  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed=false`,
    fields: 'files(id,name,mimeType,webViewLink,iconLink,size,modifiedTime)',
    orderBy: 'folder,name',
    pageSize: 200,
    supportsAllDrives: true, includeItemsFromAllDrives: true,
  });
  return (res.data.files || []).map((f) => ({
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    isFolder: f.mimeType === FOLDER_MIME,
    url: f.webViewLink || webViewLinkFor(f.id, f.mimeType === FOLDER_MIME),
    iconLink: f.iconLink || '',
    size: Number(f.size) || null,
    modifiedTime: f.modifiedTime || '',
  }));
}

/** Best-effort metadata for a single file (used to auto-title a linked doc). */
export async function getFileMeta(drive, fileId) {
  const res = await drive.files.get({
    fileId, fields: 'id,name,mimeType,size,webViewLink',
    supportsAllDrives: true,
  });
  const f = res.data;
  return {
    id: f.id, name: f.name, mimeType: f.mimeType,
    size: Number(f.size) || null,
    url: f.webViewLink || webViewLinkFor(f.id, f.mimeType === FOLDER_MIME),
  };
}

/** Move a file to Drive trash (best-effort; only app-created files under drive.file). */
export async function trashFile(drive, fileId) {
  await drive.files.update({ fileId, requestBody: { trashed: true }, supportsAllDrives: true });
}

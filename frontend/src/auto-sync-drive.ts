/** Visible My Drive automatic sync; requires drive.file and app-created or Picker-granted file access. */
import { validateSnapshot, type Snapshot } from './domain.ts';
import { mergeAutoSync, snapshotSignature } from './auto-sync-merge.ts';

// DIY_FLASHCARD_MISSING_DRIVE_TARGET_V1
/** HTTP 404 can mean deletion OR lost permission: never erase local data automatically. */
export class MissingAutoSyncTargetError extends Error {
  constructor(reason: 'not-found' | 'trashed') {
    super(reason === 'trashed'
      ? 'The linked Drive JSON is in Trash. Local study data was preserved.'
      : 'The linked Drive JSON was not found or access was revoked. Local study data was preserved.');
    this.name = 'MissingAutoSyncTargetError';
  }
}
export type AutoSyncTarget = { id: string; name: string };
export type AutoSyncResult = { snapshot: Snapshot; baseline: Snapshot; uploaded: boolean };
const DRIVE = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const FOLDER_NAME = 'diy-flashcard';
const FILE_NAME = 'flashcards.json';

async function request(token: string, url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    if (res.status === 401) throw new Error('Google sign-in expired. Reconnect your account.');
    if (res.status === 404) throw new MissingAutoSyncTargetError('not-found');
    if (res.status === 403) throw new Error('Google Drive access denied. Reconnect or check permissions; local data was preserved.');
    throw new Error(`Google Drive returned HTTP ${res.status}: ${(await res.text()).slice(0, 180)}`);
  }
  return res;
}

type FileInfo = { id?: string; name?: string; mimeType?: string; size?: string; modifiedTime?: string; headRevisionId?: string; trashed?: boolean };
async function fileInfo(token: string, fileId: string): Promise<FileInfo> {
  const query = new URLSearchParams({ fields: 'id,name,mimeType,size,modifiedTime,headRevisionId,trashed' });
  return await (await request(token, `${DRIVE}/${encodeURIComponent(fileId)}?${query}`)).json() as FileInfo;
}
function version(info: FileInfo): string { return info.headRevisionId || info.modifiedTime || ''; }
async function list(token: string, query: string): Promise<FileInfo[]> {
  const params = new URLSearchParams({ q: query, spaces: 'drive', fields: 'nextPageToken,files(id,name,mimeType,trashed)', pageSize: '100' });
  const result = await (await request(token, `${DRIVE}?${params}`)).json() as { files?: FileInfo[]; nextPageToken?: string };
  if (result.nextPageToken) throw new Error('Multiple Drive pages found. Avoid ambiguous sync destinations.');
  return result.files || [];
}
async function createFolder(token: string): Promise<string> {
  const name = FOLDER_NAME.replace(/'/g, "\\'");
  const found = await list(token, `trashed = false and mimeType = 'application/vnd.google-apps.folder' and name = '${name}'`);
  if (found.length > 1) throw new Error('Multiple app-owned sync folders have the same name.');
  if (found.length === 1 && found[0].id) return found[0].id;
  const result = await (await request(token, DRIVE + '?fields=id', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
  })).json() as { id?: string };
  if (!result.id) throw new Error('Google Drive did not return the new folder ID.');
  return result.id;
}

/** New app-owned folder; existing file is re-used (without overwriting its content). */
export async function ensureAutoSyncFile(token: string, current: Snapshot): Promise<{ target: AutoSyncTarget; created: boolean }> {
  validateSnapshot(current);
  const folder = await createFolder(token);
  const existing = await list(token, `trashed = false and '${folder}' in parents and name = '${FILE_NAME}'`);
  if (existing.length > 1) throw new Error('More than one flashcards.json exists in the sync folder.');
  if (existing.length === 1 && existing[0].id) return { target: { id: existing[0].id, name: `${FOLDER_NAME}/${FILE_NAME}` }, created: false };
  const boundary = `flashcard_${Math.random().toString(36).slice(2)}`;
  const meta = JSON.stringify({ name: FILE_NAME, mimeType: 'application/json', parents: [folder] });
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(current, null, 2)}\r\n--${boundary}--\r\n`;
  const created = await (await request(token, `${UPLOAD}?uploadType=multipart&fields=id`, {
    method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body,
  })).json() as { id?: string };
  if (!created.id) throw new Error('Google Drive did not return a JSON file ID.');
  return { target: { id: created.id, name: `${FOLDER_NAME}/${FILE_NAME}` }, created: true };
}

export async function readAutoSyncFile(token: string, id: string): Promise<Snapshot> {
  const info = await fileInfo(token, id);
  if (info.trashed) throw new MissingAutoSyncTargetError('trashed');
  if (info.mimeType?.startsWith('application/vnd.google-apps.')) throw new Error('Sync target must be a normal JSON file.');
  if (info.size && Number(info.size) > 10 * 1024 * 1024) throw new Error('Sync JSON exceeds 10 MB.');
  const response = await request(token, `${DRIVE}/${encodeURIComponent(id)}?alt=media`);
  const body = await response.text();
  if (body.length > 10 * 1024 * 1024) throw new Error('Sync JSON exceeds 10 MB.');
  let data: unknown;
  try { data = JSON.parse(body); } catch { throw new Error('The linked Drive file is not valid JSON.'); }
  validateSnapshot(data);
  return data;
}

/** Writes a specifically granted file, never the whole Drive folder. */
export async function writeAutoSyncFile(token: string, id: string, data: Snapshot): Promise<void> {
  validateSnapshot(data);
  await request(token, `${UPLOAD}/${encodeURIComponent(id)}?uploadType=media`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(data, null, 2),
  });
}

/** Pull, 3-way merge and push. Best-effort revision check; not atomic across clients. */
export async function syncAutoSyncFile(token: string, target: AutoSyncTarget, local: Snapshot, baseline: Snapshot | null): Promise<AutoSyncResult> {
  const before = await fileInfo(token, target.id);
  const remote = await readAutoSyncFile(token, target.id);
  const combined = mergeAutoSync(local, remote, baseline);
  const changed = snapshotSignature(combined) !== snapshotSignature(remote);
  if (changed) {
    // Detect most concurrent Drive changes before writing, without claiming atomicity.
    const again = await fileInfo(token, target.id);
    if (version(before) && version(again) && version(before) !== version(again)) {
      throw new Error('Drive file changed during sync. Retry after the other editor finishes.');
    }
    await writeAutoSyncFile(token, target.id, combined);
  }
  return { snapshot: combined, baseline: combined, uploaded: changed };
}

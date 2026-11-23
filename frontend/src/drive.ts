import { mergeSnapshots, validateSnapshot, type Snapshot } from './domain.ts';
const NAME = 'service-v1.json';
const API = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';

async function driveFetch(token: string, url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(url, { ...init, headers });
  if (!response.ok) {
    if (response.status === 401) throw new Error('Google authentication expired. Please reconnect.');
    const body = await response.text();
    throw new Error(`Google Drive API ${response.status}: ${body.slice(0, 250)}`);
  }
  return response;
}
async function findFile(token: string): Promise<string | undefined> {
  const params = new URLSearchParams({
    spaces: 'appDataFolder', q: `name = '${NAME}' and trashed = false`,
    fields: 'nextPageToken,files(id,name,modifiedTime)', pageSize: '100',
  });
  const result = await (await driveFetch(token, `${API}?${params}`)).json() as { files?: Array<{ id: string; name: string }> };
  const files = (result.files || []).filter(f => f.name === NAME);
  if (files.length > 1) throw new Error('Multiple backups with the same name were found in Google Drive. Please review them manually.');
  return files[0]?.id;
}
async function readRemote(token: string, fileId: string): Promise<Snapshot> {
  const response = await driveFetch(token, `${API}/${encodeURIComponent(fileId)}?alt=media`);
  const data: unknown = await response.json();
  validateSnapshot(data);
  return data;
}
async function writeRemote(token: string, fileId: string | undefined, data: Snapshot): Promise<void> {
  const json = JSON.stringify(data);
  if (fileId) {
    await driveFetch(token, `${UPLOAD}/${encodeURIComponent(fileId)}?uploadType=media`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: json,
    });
  } else {
    const boundary = `recalldeck_${Math.random().toString(36).slice(2)}`;
    const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: NAME, parents: ['appDataFolder'], mimeType: 'application/json' })}\r\n--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${json}\r\n--${boundary}--\r\n`;
    await driveFetch(token, `${UPLOAD}?uploadType=multipart&fields=id`, {
      method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body,
    });
  }
}

/** Explicit on-demand merge then upload. Not an atomic multi-device transaction. */
export async function syncDrive(token: string, local: Snapshot): Promise<Snapshot> {
  validateSnapshot(local);
  const fileId = await findFile(token);
  const merged = fileId ? mergeSnapshots(local, await readRemote(token, fileId)) : local;
  await writeRemote(token, fileId, merged);
  return merged;
}



// YOU_FLASHCARD_DRIVE_V1 — Visible files (My Drive), independent of hidden appDataFolder.
export type MyDriveFile = {
  id: string; name: string; modifiedTime?: string; webViewLink?: string;
};
const MYDRIVE_PREFIX = 'you-flashcard-';
const LIBRARY_NAME = 'you-flashcard-library.json';

/** Only lists JSON files this OAuth client can access through drive.file. */
export async function listMyDriveFiles(token: string): Promise<MyDriveFile[]> {
  const files: MyDriveFile[] = [];
  let pageToken = '';
  for (let page = 0; page < 10; page++) {
    const params = new URLSearchParams({
      spaces: 'drive',
      q: "trashed = false and mimeType = 'application/json' and name contains 'you-flashcard-'",
      fields: 'nextPageToken,files(id,name,modifiedTime,webViewLink,mimeType)',
      pageSize: '100',
    });
    if (pageToken) params.set('pageToken', pageToken);
    const result = await (await driveFetch(token, `${API}?${params}`)).json() as {
      nextPageToken?: string;
      files?: Array<MyDriveFile & { mimeType?: string }>;
    };
    files.push(...(result.files || []).filter(f =>
      f.id && f.name.startsWith(MYDRIVE_PREFIX) && f.name.endsWith('.json') &&
      f.mimeType === 'application/json').map(({ id, name, modifiedTime, webViewLink }) =>
      ({ id, name, modifiedTime, webViewLink })));
    pageToken = result.nextPageToken || '';
    if (!pageToken) return files.sort((a, b) => a.name.localeCompare(b.name));
  }
  throw new Error('My Drive has too many app files to list safely. Narrow the collection.');
}

/** Import directly from the Google Drive API, not via a downloaded file. */
export async function readMyDriveFile(token: string, fileId: string): Promise<Snapshot> {
  if (!fileId || !/^[A-Za-z0-9_-]+$/.test(fileId)) throw new Error('Invalid Drive file ID');
  return readRemote(token, fileId);
}

export function deckOnlySnapshot(snapshot: Snapshot, deckId: string): Snapshot {
  validateSnapshot(snapshot);
  const deck = snapshot.decks.find(d => d.id === deckId && !d.deletedAt);
  if (!deck) throw new Error('The selected deck no longer exists.');
  const cards = snapshot.cards.filter(c => c.deckId === deckId);
  const ids = new Set(cards.map(c => c.id));
  return { schemaVersion: 1, updatedAt: snapshot.updatedAt,
    decks: [deck], cards, reviews: snapshot.reviews.filter(r => ids.has(r.cardId)) };
}

function myDriveName(snapshot: Snapshot, deckId?: string): string {
  if (!deckId) return LIBRARY_NAME;
  const deck = snapshot.decks.find(d => d.id === deckId && !d.deletedAt);
  if (!deck) throw new Error('The selected deck no longer exists.');
  // Stable across deck renames; identity is the deck ID, not the display name.
  return `${MYDRIVE_PREFIX}deck-${deckId}.json`;
}

/** Write an editable JSON backup to visible My Drive; merge to preserve tombstones. */
export async function saveMyDriveFile(token: string, local: Snapshot, deckId?: string): Promise<MyDriveFile> {
  validateSnapshot(local);
  const data = deckId ? deckOnlySnapshot(local, deckId) : local;
  const name = myDriveName(local, deckId);
  const files = (await listMyDriveFiles(token)).filter(f => f.name === name);
  if (files.length > 1) throw new Error(`Multiple My Drive files named ${name}. Remove duplicates manually.`);
  const oldId = files[0]?.id;
  const merged = oldId ? mergeSnapshots(data, await readMyDriveFile(token, oldId)) : data;
  const json = JSON.stringify(merged, null, 2);
  if (oldId) {
    await driveFetch(token, `${UPLOAD}/${encodeURIComponent(oldId)}?uploadType=media`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: json,
    });
    return files[0];
  }
  const boundary = `youflashcard_${Math.random().toString(36).slice(2)}`;
  // No parents means the file is placed in the visible My Drive root.
  const metadata = JSON.stringify({ name, mimeType: 'application/json',
    description: 'You Flashcard editable JSON backup' });
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${json}\r\n--${boundary}--\r\n`;
  const created = await (await driveFetch(token, `${UPLOAD}?uploadType=multipart&fields=id,name,webViewLink`, {
    method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body,
  })).json() as MyDriveFile;
  if (!created.id) throw new Error('Google Drive did not return a file ID.');
  return { id: created.id, name, webViewLink: created.webViewLink };
}

/** Explicit remote deletion; only accepts files returned by our app's listing. */
export async function removeMyDriveFile(token: string, fileId: string): Promise<void> {
  const owned = (await listMyDriveFiles(token)).some(f => f.id === fileId);
  if (!owned) throw new Error('File not accessible via this app.');
  await driveFetch(token, `${API}/${encodeURIComponent(fileId)}`, { method: 'DELETE' });
}

/** Remove every visible file made by this app, for an explicit full reset. */
export async function removeAllMyDriveFiles(token: string): Promise<number> {
  const files = await listMyDriveFiles(token);
  for (const file of files) await driveFetch(token, `${API}/${encodeURIComponent(file.id)}`, { method: 'DELETE' });
  return files.length;
}

// YOU_FLASHCARD_GOOGLE_PICKER_V2 — read arbitrary files explicitly granted via Google Picker.
/** Limit large imports; validate the exact snapshot schema before modifying local data. */
export async function readPickedJsonFile(token: string, fileId: string): Promise<Snapshot> {
  if (!/^[A-Za-z0-9_-]+$/.test(fileId)) throw new Error('Invalid Google Drive file ID.');
  const meta = await (await driveFetch(token, `${API}/${encodeURIComponent(fileId)}?fields=id,name,size,mimeType`)).json() as {
    id?: string; name?: string; size?: string; mimeType?: string;
  };
  if (!meta.name?.toLowerCase().endsWith('.json')) throw new Error('The selected file must have a .json filename.');
  const limit = 10 * 1024 * 1024;
  if (meta.size && Number(meta.size) > limit) throw new Error('JSON file exceeds the 10 MB import limit.');
  if (meta.mimeType?.startsWith('application/vnd.google-apps.')) throw new Error('Native Google Docs files are not supported. Upload a .json file.');
  const response = await driveFetch(token, `${API}/${encodeURIComponent(fileId)}?alt=media`);
  const body = await response.text();
  if (body.length > limit) throw new Error('JSON file exceeds the 10 MB import limit.');
  let parsed: unknown;
  try { parsed = JSON.parse(body); }
  catch { throw new Error('Invalid JSON. Select a you-flashcard JSON export.'); }
  validateSnapshot(parsed);
  return parsed;
}

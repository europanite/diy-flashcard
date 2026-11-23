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

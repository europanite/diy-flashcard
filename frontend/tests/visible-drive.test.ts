// YOU_FLASHCARD_DRIVE_V1
import assert from 'node:assert/strict';
import test from 'node:test';
import { emptySnapshot, makeDeck } from '../src/domain.ts';
import { deckOnlySnapshot, listMyDriveFiles, readMyDriveFile, removeMyDriveFile, saveMyDriveFile } from '../src/drive.ts';

test('visible My Drive save creates a normal JSON file, not hidden appDataFolder', async () => {
  const original = globalThis.fetch;
  const seen: Array<{ url: string; method: string; body: string }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input), method = init?.method || 'GET', body = String(init?.body || '');
    seen.push({ url, method, body });
    if (url.startsWith('https://www.googleapis.com/drive/v3/files?')) return new Response(JSON.stringify({ files: [] }), { status: 200 });
    if (url.includes('uploadType=multipart')) return new Response(JSON.stringify({ id: 'fileid', name: 'you-flashcard-library.json' }), { status: 200 });
    return new Response('bad request', { status: 500 });
  }) as typeof fetch;
  try {
    const created = await saveMyDriveFile('fake-token', emptySnapshot());
    assert.equal(created.name, 'you-flashcard-library.json');
    const post = seen.find(x => x.method === 'POST');
    assert.ok(post);
    assert.match(post.body, /you-flashcard-library.json/);
    assert.doesNotMatch(post.body, /appDataFolder/);
    assert.match(seen.find(x => x.url.includes('/drive/v3/files?'))?.url || '', /spaces=drive/);
  } finally { globalThis.fetch = original; }
});

test('Drive list, direct import, and delete use the file ID', async () => {
  const original = globalThis.fetch;
  const target = emptySnapshot();
  const seen: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input); seen.push(`${init?.method || 'GET'} ${url}`);
    if (url.includes('alt=media')) return new Response(JSON.stringify(target), { status: 200 });
    if (init?.method === 'DELETE') return new Response(null, { status: 204 });
    return new Response(JSON.stringify({ files: [{ id:'fileid', name:'you-flashcard-library.json', mimeType:'application/json' },
      { id:'other', name:'other.json', mimeType:'application/json' }] }), { status: 200 });
  }) as typeof fetch;
  try {
    const files = await listMyDriveFiles('token');
    assert.equal(files.length, 1);
    assert.deepEqual(await readMyDriveFile('token', files[0].id), target);
    await removeMyDriveFile('token', files[0].id);
    assert.ok(seen.some(v => v === 'DELETE https://www.googleapis.com/drive/v3/files/fileid'));
  } finally { globalThis.fetch = original; }
});

test('deck export includes only matching deck, its cards, and reviews', () => {
  const a = makeDeck('A'); const b = makeDeck('B');
  const all = { ...emptySnapshot(), decks:[a,b] };
  assert.deepEqual(deckOnlySnapshot(all, a.id).decks.map(d => d.id), [a.id]);
});

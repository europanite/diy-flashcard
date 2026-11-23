import assert from 'node:assert/strict';
import test from 'node:test';
import { syncDrive } from '../src/drive.ts';
import { emptySnapshot, makeDeck } from '../src/domain.ts';

test('Drive sync creates a hidden appDataFolder backup when absent', async () => {
  const prior = globalThis.fetch;
  const requests: { url: string; method: string; body: string }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, method: init?.method || 'GET', body: String(init?.body || '') });
    if (url.includes('spaces=appDataFolder')) return new Response(JSON.stringify({ files: [] }), { status: 200 });
    if (url.includes('uploadType=multipart')) return new Response(JSON.stringify({ id: 'created' }), { status: 200 });
    return new Response('unexpected URL', { status: 500 });
  }) as typeof fetch;
  try {
    const snapshot = emptySnapshot();
    const result = await syncDrive('mock-token', snapshot);
    assert.deepEqual(result, snapshot);
    const uploaded = requests.find(r => r.method === 'POST');
    assert.ok(uploaded);
    assert.match(uploaded.body, /appDataFolder/);
    assert.match(uploaded.body, /service-v1.json/);
  } finally { globalThis.fetch = prior; }
});

test('Drive sync merges a remote deck and uploads merged snapshot', async () => {
  const prior = globalThis.fetch;
  const remote = { ...emptySnapshot(), decks: [makeDeck('Remote')] };
  const local = { ...emptySnapshot(), decks: [makeDeck('Local')] };
  let patch: unknown;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('spaces=appDataFolder')) return new Response(JSON.stringify({ files: [{ id: 'file-id', name: 'service-v1.json' }] }), { status: 200 });
    if (url.includes('alt=media')) return new Response(JSON.stringify(remote), { status: 200 });
    if (init?.method === 'PATCH') {
      patch = JSON.parse(String(init.body));
      return new Response('{}', { status: 200 });
    }
    return new Response('unexpected URL', { status: 500 });
  }) as typeof fetch;
  try {
    const merged = await syncDrive('mock-token', local);
    assert.equal(merged.decks.length, 2);
    assert.equal((patch as typeof local).decks.length, 2);
  } finally { globalThis.fetch = prior; }
});

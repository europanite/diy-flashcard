// YOU_FLASHCARD_GOOGLE_PICKER_V2
import assert from 'node:assert/strict';
import test from 'node:test';
import { activeCards, activeDecks, clearAllData, emptySnapshot, importAsNewDecks, makeCard, makeDeck, mergeSnapshots } from '../src/domain.ts';
import { readPickedJsonFile } from '../src/drive.ts';

test('manually chosen JSON file is read by ID with OAuth and validated', async () => {
  const original = globalThis.fetch;
  const source = emptySnapshot();
  const deck = makeDeck('微分方程式');
  source.decks.push(deck); source.cards.push(makeCard(deck.id, '公式は？', '$$\\frac{dy}{dx}$$'));
  const calls: Array<{url: string, auth: string | null}> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({url, auth: new Headers(init?.headers).get('Authorization')});
    if (url.includes('fields=id,name,size,mimeType')) return new Response(JSON.stringify({id: 'uploadedID', name:'ode.json', size:'600', mimeType:'application/json'}), {status:200});
    if (url.includes('alt=media')) return new Response(JSON.stringify(source), {status:200});
    return new Response('Unexpected request', {status:500});
  }) as typeof fetch;
  try {
    const read = await readPickedJsonFile('token', 'uploadedID');
    assert.equal(read.cards.length, 1);
    assert.equal(calls.length, 2);
    assert.ok(calls.every(c => c.auth === 'Bearer token'));
  } finally { globalThis.fetch = original; }
});

test('after delete-all, fresh import survives tombstones and is immediately due', () => {
  const source = emptySnapshot('2026-01-01T00:00:00Z');
  const deck = makeDeck('Equations', '', '2026-01-01T00:00:00Z');
  const card = makeCard(deck.id, 'y?', '$$y=e^x$$', '2026-01-01T00:00:00Z');
  source.decks.push(deck); source.cards.push(card);
  const cleared = clearAllData(source, '2026-11-23T00:00:00Z');
  assert.equal(activeCards(cleared).length, 0);
  const imported = importAsNewDecks(source, '2026-11-23T01:00:00Z');
  assert.notEqual(imported.decks[0].id, deck.id);
  assert.notEqual(imported.cards[0].id, card.id);
  assert.equal(imported.cards[0].dueAt, '2026-11-23T01:00:00Z');
  assert.deepEqual(imported.reviews, []);
  const merged = mergeSnapshots(cleared, imported);
  assert.equal(activeDecks(merged).length, 1);
  assert.equal(activeCards(merged).length, 1);
  assert.equal(activeCards(merged)[0].back, '$$y=e^x$$');
});

test('importing twice adds two distinct decks without reactivating deleted IDs', () => {
  const s = emptySnapshot(); const d = makeDeck('DECK'); s.decks.push(d); s.cards.push(makeCard(d.id, 'Q', 'A'));
  const first = importAsNewDecks(s); const second = importAsNewDecks(s);
  assert.notEqual(first.decks[0].id, second.decks[0].id);
  assert.equal(activeDecks(mergeSnapshots(first, second)).length, 2);
});

test('invalid and oversized Picker JSON is rejected without changing data', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({name:'malformed.json', size:'12000000'}), {status:200})) as typeof fetch;
  try {
    await assert.rejects(() => readPickedJsonFile('token', 'uploadedID'), /10 MB/);
    await assert.rejects(() => readPickedJsonFile('token', 'invalid/id'), /Invalid Google Drive file ID/);
  } finally { globalThis.fetch = original; }
});

// YOU_FLASHCARD_DRIVE_V1
import assert from 'node:assert/strict';
import test from 'node:test';
import { clearAllData, deleteCardData, deleteDeckData, emptySnapshot, makeCard, makeDeck, mergeSnapshots, progress, rateCard } from '../src/domain.ts';

test('delete deck scrubs its cards/reviews but preserves other decks and sync tombstones', () => {
  const a = makeDeck('A', 'private notes', '2026-01-01T00:00:00Z');
  const b = makeDeck('B', '', '2026-01-01T00:00:00Z');
  const c1 = makeCard(a.id, 'secret question', 'private answer', '2026-01-01T00:00:00Z');
  const c2 = makeCard(b.id, 'keep this', 'answer', '2026-01-01T00:00:00Z');
  const r1 = rateCard(c1, 2, '2026-01-02T00:00:00Z');
  const r2 = rateCard(c2, 2, '2026-01-02T00:00:00Z');
  const before = { ...emptySnapshot(), decks:[a,b], cards:[r1.card,r2.card], reviews:[r1.review,r2.review] };
  const erased = deleteDeckData(before, a.id, '2026-01-03T00:00:00Z');
  assert.equal(progress(erased).total, 1);
  assert.equal(erased.reviews.length, 1);
  assert.equal(erased.cards.find(c => c.id === c1.id)?.front, '');
  assert.equal(erased.decks.find(d => d.id === a.id)?.description, '');
  const afterSync = mergeSnapshots(erased, before);
  assert.equal(afterSync.decks.find(d => d.id === a.id)?.deletedAt !== undefined, true);
  assert.equal(afterSync.cards.find(c => c.id === c1.id)?.front, '');
  assert.equal(afterSync.reviews.length, 1);
  assert.equal(progress(afterSync).total, 1);
});

test('delete card removes review history, survives old remote merge', () => {
  const deck = makeDeck('Deck');
  const card = makeCard(deck.id, 'question', 'answer');
  const reviewed = rateCard(card, 2);
  const old = { ...emptySnapshot(), decks:[deck], cards:[reviewed.card], reviews:[reviewed.review] };
  const newer = deleteCardData(old, card.id);
  const merged = mergeSnapshots(newer, old);
  assert.equal(progress(merged).total, 0);
  assert.deepEqual(merged.reviews, []);
  assert.equal(merged.cards[0].front, '');
});

test('clear all hides everything, removes all reviews, old remote cannot resurrect cards', () => {
  const deck = makeDeck('One');
  const card = makeCard(deck.id, 'formula', '$x^2$');
  const reviewed = rateCard(card, 3);
  const before = { ...emptySnapshot(), decks:[deck], cards:[reviewed.card], reviews:[reviewed.review] };
  const cleared = clearAllData(before);
  assert.deepEqual(cleared.reviews, []);
  assert.equal(cleared.cards[0].back, '');
  const merged = mergeSnapshots(before, cleared);
  assert.equal(progress(merged).total, 0);
  assert.equal(merged.reviews.length, 0);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { activeCards, activeDecks, dailyReviewCounts, dueCards, emptySnapshot, makeCard, makeDeck, mergeSnapshots, progress, rateCard, validateSnapshot, type Snapshot } from '../src/domain.ts';

const NOW = '2026-11-23T00:00:00.000Z';

test('new cards are due immediately; a good answer schedules tomorrow', () => {
  const deck = makeDeck('Math', '', NOW);
  const card = makeCard(deck.id, 'Q', 'A', NOW);
  const snapshot: Snapshot = { ...emptySnapshot(NOW), decks: [deck], cards: [card] };
  assert.equal(dueCards(snapshot, undefined, NOW).length, 1);
  const rated = rateCard(card, 2, NOW);
  assert.equal(rated.card.seen, 1);
  assert.equal(rated.card.remembered, 1);
  assert.equal(rated.card.intervalDays, 1);
  assert.equal(dueCards({ ...snapshot, cards: [rated.card] }, undefined, NOW).length, 0);
});

test('again retries in one minute, resets repetitions and counts lapse', () => {
  const deck = makeDeck('Math', '', NOW);
  const card = makeCard(deck.id, 'Q', 'A', NOW);
  const first = rateCard(card, 3, NOW);
  const again = rateCard(first.card, 0, NOW);
  assert.equal(again.card.repetitions, 0);
  assert.equal(again.card.lapses, 1);
  assert.equal(again.card.intervalDays, 1 / 1440);
});

test('merge is commutative for unchanged payloads and review events deduplicate', () => {
  const deck = makeDeck('Math', '', NOW);
  const card = makeCard(deck.id, 'Q', 'A', NOW);
  const rating = rateCard(card, 2, NOW);
  const a = { ...emptySnapshot(NOW), decks: [deck], cards: [card], reviews: [rating.review] };
  const b = { ...emptySnapshot(NOW), decks: [deck], cards: [card], reviews: [rating.review] };
  const ab = mergeSnapshots(a, b);
  const ba = mergeSnapshots(b, a);
  assert.deepEqual(ab.decks, ba.decks);
  assert.equal(ab.reviews.length, 1);
});

test('delete tombstones suppress cards across merge', () => {
  const deck = makeDeck('Math', '', NOW);
  const card = makeCard(deck.id, 'Q', 'A', NOW);
  const a = { ...emptySnapshot(NOW), decks: [deck], cards: [card] };
  const deleted = { ...card, updatedAt: '2026-11-23T01:00:00.000Z', deletedAt: '2026-11-23T01:00:00.000Z' };
  const b = { ...emptySnapshot(NOW), decks: [deck], cards: [deleted] };
  assert.equal(activeCards(mergeSnapshots(a, b)).length, 0);
});

test('reject bad import schema', () => {
  assert.throws(() => validateSnapshot({ schemaVersion: 20, decks: [], cards: [], reviews: [] }));
});

test('daily counts, retention, and deck filtering', () => {
  const deck = makeDeck('Math', '', NOW);
  const card = makeCard(deck.id, 'Q', 'A', NOW);
  const reviewed = rateCard(card, 2, NOW);
  const snap: Snapshot = { ...emptySnapshot(NOW), decks: [deck], cards: [reviewed.card], reviews: [reviewed.review] };
  assert.equal(activeDecks(snap).length, 1);
  assert.equal(progress(snap, new Date(NOW)).retention, 100);
  assert.equal(dailyReviewCounts(snap, 1, new Date(NOW))[0].count, 1);
});

/** Pure, platform-independent spaced repetition and sync domain logic. */
export type Grade = 0 | 1 | 2 | 3;
export type Deck = {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
};
export type Card = {
  id: string;
  deckId: string;
  front: string;
  back: string;
  createdAt: string;
  updatedAt: string;
  dueAt: string;
  intervalDays: number;
  ease: number;
  repetitions: number;
  lapses: number;
  seen: number;
  remembered: number;
  deletedAt?: string;
};
export type Review = {
  id: string;
  cardId: string;
  grade: Grade;
  reviewedAt: string;
  intervalDays: number;
};
export type Snapshot = {
  schemaVersion: 1;
  updatedAt: string;
  decks: Deck[];
  cards: Card[];
  reviews: Review[];
};

export function id(): string {
  // Not security-sensitive, but avoid collisions between devices.
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

export function emptySnapshot(now = new Date().toISOString()): Snapshot {
  return { schemaVersion: 1, updatedAt: now, decks: [], cards: [], reviews: [] };
}
export function makeDeck(name: string, description = '', now = new Date().toISOString()): Deck {
  if (!name.trim()) throw new Error('Enter a deck name.');
  return { id: id(), name: name.trim(), description: description.trim(), createdAt: now, updatedAt: now };
}
export function makeCard(deckId: string, front: string, back: string, now = new Date().toISOString()): Card {
  if (!front.trim() || !back.trim()) throw new Error('Enter both the front and back of the card.');
  return {
    id: id(), deckId, front: front.trim(), back: back.trim(), createdAt: now, updatedAt: now,
    dueAt: now, intervalDays: 0, ease: 2.5, repetitions: 0, lapses: 0, seen: 0, remembered: 0,
  };
}

export function rateCard(card: Card, grade: Grade, at = new Date().toISOString()): { card: Card; review: Review } {
  if (![0, 1, 2, 3].includes(grade)) throw new Error('Invalid grade');
  let ease = card.ease;
  let interval: number;
  let repetitions = card.repetitions;
  let lapses = card.lapses;
  if (grade === 0) {
    repetitions = 0;
    lapses += 1;
    ease = Math.max(1.3, ease - 0.2);
    interval = 1 / (24 * 60); // Again: retry in one minute.
  } else if (grade === 1) {
    ease = Math.max(1.3, ease - 0.15);
    repetitions += 1;
    interval = card.intervalDays < 1 ? 1 : Math.max(1, card.intervalDays * 1.2);
  } else if (grade === 2) {
    repetitions += 1;
    interval = card.intervalDays < 1 ? 1 : Math.max(1, card.intervalDays * ease);
  } else {
    ease = Math.min(3.2, ease + 0.15);
    repetitions += 1;
    interval = card.intervalDays < 1 ? 4 : Math.max(4, card.intervalDays * ease * 1.3);
  }
  const dueAt = new Date(new Date(at).getTime() + interval * 86400000).toISOString();
  return {
    card: {
      ...card, updatedAt: at, dueAt, ease, intervalDays: interval,
      repetitions, lapses, seen: card.seen + 1,
      remembered: card.remembered + (grade >= 2 ? 1 : 0),
    },
    review: { id: id(), cardId: card.id, grade, reviewedAt: at, intervalDays: interval },
  };
}
export function activeDecks(s: Snapshot): Deck[] {
  return s.decks.filter(d => !d.deletedAt).sort((a, b) => a.name.localeCompare(b.name));
}
export function activeCards(s: Snapshot, deckId?: string): Card[] {
  const deckIds = new Set(activeDecks(s).map(d => d.id));
  return s.cards.filter(c => !c.deletedAt && deckIds.has(c.deckId) && (!deckId || c.deckId === deckId));
}
export function dueCards(s: Snapshot, deckId?: string, now = new Date().toISOString()): Card[] {
  return activeCards(s, deckId).filter(c => c.dueAt <= now).sort((a, b) => a.dueAt.localeCompare(b.dueAt));
}
export function dailyReviewCounts(s: Snapshot, days = 7, now = new Date()): { date: string; count: number }[] {
  const output = [];
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(dayStart.getTime());
    d.setDate(d.getDate() - i);
    const start = d.getTime();
    const end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
    output.push({ date: `${d.getMonth() + 1}/${d.getDate()}`, count: s.reviews.filter(r => {
      const n = new Date(r.reviewedAt).getTime();
      return n >= start && n < end;
    }).length });
  }
  return output;
}
export function progress(s: Snapshot, now = new Date()): { total: number; due: number; learned: number; reviewsToday: number; retention: number; streak: number } {
  const cards = activeCards(s);
  const hist = dailyReviewCounts(s, 365, now);
  const good = s.reviews.filter(r => r.grade >= 2).length;
  let streak = 0;
  for (let i = hist.length - 1; i >= 0; i--) {
    if (hist[i].count === 0 && i === hist.length - 1) continue;
    if (hist[i].count === 0) break;
    streak++;
  }
  return {
    total: cards.length,
    due: dueCards(s, undefined, now.toISOString()).length,
    learned: cards.filter(c => c.repetitions >= 3 && c.intervalDays >= 7).length,
    reviewsToday: hist[hist.length - 1].count,
    retention: s.reviews.length ? Math.round(100 * good / s.reviews.length) : 0,
    streak,
  };
}
function byLatest<T extends { id: string; updatedAt: string }>(left: T[], right: T[]): T[] {
  const map = new Map<string, T>();
  for (const item of [...left, ...right]) {
    const current = map.get(item.id);
    // Updated-at LWW (deterministic tie break); tombstones are preserved.
    if (!current || item.updatedAt > current.updatedAt || (item.updatedAt === current.updatedAt && JSON.stringify(item) > JSON.stringify(current))) map.set(item.id, item);
  }
  return [...map.values()].sort((a, b) => a.id.localeCompare(b.id));
}
export function mergeSnapshots(local: Snapshot, remote: Snapshot): Snapshot {
  validateSnapshot(local);
  validateSnapshot(remote);
  const reviews = new Map<string, Review>();
  for (const r of [...local.reviews, ...remote.reviews]) reviews.set(r.id, r);
  const decks = byLatest(local.decks, remote.decks);
  const cards = byLatest(local.cards, remote.cards);
  const deletedDeckIds = new Set(decks.filter(d => d.deletedAt).map(d => d.id));
  const removedIds = new Set(cards.filter(c => c.deletedAt || deletedDeckIds.has(c.deckId)).map(c => c.id));
  // Deleting a deck or card also removes its review history after merging with old backups.
  return {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    decks,
    cards: cards.map(c => c.deletedAt || deletedDeckIds.has(c.deckId) ? {
      ...c, front: '', back: '', deletedAt: c.deletedAt || decks.find(d => d.id === c.deckId)!.deletedAt,
    } : c),
    reviews: [...reviews.values()].filter(r => !removedIds.has(r.cardId)).sort((a, b) => a.id.localeCompare(b.id)),
  };
}
export function validateSnapshot(data: unknown): asserts data is Snapshot {
  if (!data || typeof data !== 'object') throw new Error('Invalid backup file.');
  const d = data as Partial<Snapshot>;
  if (d.schemaVersion !== 1 || !Array.isArray(d.decks) || !Array.isArray(d.cards) || !Array.isArray(d.reviews)) throw new Error('Unsupported backup format.');
  if (d.decks.length > 100000 || d.cards.length > 100000 || d.reviews.length > 1000000) throw new Error('Backup exceeds the size limit.');
  for (const deck of d.decks) if (!deck || typeof deck.id !== 'string' || typeof deck.name !== 'string' || typeof deck.updatedAt !== 'string') throw new Error('Invalid deck data.');
  for (const c of d.cards) if (!c || typeof c.id !== 'string' || typeof c.deckId !== 'string' || typeof c.front !== 'string' || typeof c.back !== 'string' || typeof c.updatedAt !== 'string' || typeof c.dueAt !== 'string' || !Number.isFinite(c.intervalDays) || !Number.isFinite(c.ease)) throw new Error('Invalid card data.');
  for (const r of d.reviews) if (!r || typeof r.id !== 'string' || typeof r.cardId !== 'string' || ![0,1,2,3].includes(r.grade) || typeof r.reviewedAt !== 'string') throw new Error('Invalid review history.');
}


// YOU_FLASHCARD_DRIVE_V1 — Destructive operations keep scrubbed tombstones for syncing.
function deletionTime(snapshot: Snapshot, now: string): string {
  // A tombstone must be newer than records from this device, even after clock skew.
  const timestamps = [snapshot.updatedAt,
    ...snapshot.decks.map(d => d.updatedAt), ...snapshot.cards.map(c => c.updatedAt)];
  const latest = Math.max(...timestamps.map(t => Date.parse(t) || 0), 0);
  return new Date(Math.max(Date.parse(now), latest + 1)).toISOString();
}

/** Removes a card's content and reviews, keeping only the sync tombstone. */
export function deleteCardData(snapshot: Snapshot, cardId: string, now = new Date().toISOString()): Snapshot {
  validateSnapshot(snapshot);
  const at = deletionTime(snapshot, now);
  return {
    ...snapshot, updatedAt: at,
    cards: snapshot.cards.map(c => c.id === cardId
      ? { ...c, front: '', back: '', updatedAt: at, deletedAt: at } : c),
    reviews: snapshot.reviews.filter(r => r.cardId !== cardId),
  };
}

/** Permanently clears a deck's content and reviews, preserving IDs as tombstones. */
export function deleteDeckData(snapshot: Snapshot, deckId: string, now = new Date().toISOString()): Snapshot {
  validateSnapshot(snapshot);
  const at = deletionTime(snapshot, now);
  const cardIds = new Set(snapshot.cards.filter(c => c.deckId === deckId).map(c => c.id));
  return {
    ...snapshot, updatedAt: at,
    decks: snapshot.decks.map(d => d.id === deckId
      ? { ...d, name: 'Deleted deck', description: '', deletedAt: at, updatedAt: at } : d),
    cards: snapshot.cards.map(c => cardIds.has(c.id)
      ? { ...c, front: '', back: '', deletedAt: at, updatedAt: at } : c),
    reviews: snapshot.reviews.filter(r => !cardIds.has(r.cardId)),
  };
}

/** Resets all visible decks, cards, and review history. Tombstones block old sync data. */
export function clearAllData(snapshot: Snapshot, now = new Date().toISOString()): Snapshot {
  validateSnapshot(snapshot);
  const at = deletionTime(snapshot, now);
  return {
    schemaVersion: 1, updatedAt: at,
    decks: snapshot.decks.map(d => ({ ...d, name: 'Deleted deck', description: '', deletedAt: at, updatedAt: at })),
    cards: snapshot.cards.map(c => ({ ...c, front: '', back: '', deletedAt: at, updatedAt: at })),
    reviews: [],
  };
}

// YOU_FLASHCARD_GOOGLE_PICKER_V2 — a fresh copy cannot be erased by prior Drive tombstones.
/** Import decks and cards with NEW IDs, reset study progress and exclude deletion records. */
export function importAsNewDecks(source: Snapshot, at = new Date().toISOString()): Snapshot {
  validateSnapshot(source);
  const liveDecks = source.decks.filter(d => !d.deletedAt);
  if (!liveDecks.length) throw new Error('The selected JSON contains no active decks.');
  const deckIds = new Map(liveDecks.map(d => [d.id, id()]));
  const liveCards = source.cards.filter(c => !c.deletedAt && deckIds.has(c.deckId));
  const decks = liveDecks.map(d => ({
    id: deckIds.get(d.id)!, name: d.name, description: d.description || '',
    createdAt: at, updatedAt: at,
  }));
  const cards = liveCards.map(c => ({
    id: id(), deckId: deckIds.get(c.deckId)!, front: c.front, back: c.back,
    createdAt: at, updatedAt: at, dueAt: at, intervalDays: 0, ease: 2.5,
    repetitions: 0, lapses: 0, seen: 0, remembered: 0,
  }));
  return { schemaVersion: 1, updatedAt: at, decks, cards, reviews: [] };
}

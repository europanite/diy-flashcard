/** Stable, entity-level 3-way merge for an explicitly linked Drive JSON file.
 * No silent overwrite when the same entity changed independently on both sides.
 */
import { mergeSnapshots, validateSnapshot, type Snapshot, type Deck, type Card, type Review } from './domain.ts';

const signature = (value: unknown) => JSON.stringify(value);
const sorted = <T extends { id: string }>(records: T[]): T[] => [...records].sort((a, b) => a.id.localeCompare(b.id));

/** Ignore snapshot.updatedAt: it is not a data change. */
export function snapshotSignature(s: Snapshot): string {
  return signature({ decks: sorted(s.decks), cards: sorted(s.cards), reviews: sorted(s.reviews) });
}

function mergeEntities<T extends { id: string }>(kind: string, local: T[], remote: T[], base: T[]): T[] {
  const l = new Map(local.map(item => [item.id, item]));
  const r = new Map(remote.map(item => [item.id, item]));
  const b = new Map(base.map(item => [item.id, item]));
  const output: T[] = [];
  for (const id of new Set([...l.keys(), ...r.keys(), ...b.keys()])) {
    const left = l.get(id), right = r.get(id), previous = b.get(id);
    let choice: T | undefined;
    if (signature(left) === signature(right)) choice = left;
    else if (signature(left) === signature(previous)) choice = right;
    else if (signature(right) === signature(previous)) choice = left;
    else throw new Error(`Auto-sync conflict: ${kind} ${id} changed in the app and Drive. No data was overwritten.`);
    if (choice) output.push(choice);
  }
  return sorted(output);
}

export function mergeAutoSync(local: Snapshot, remote: Snapshot, base: Snapshot | null): Snapshot {
  validateSnapshot(local); validateSnapshot(remote);
  if (!base) return mergeSnapshots(local, remote);
  validateSnapshot(base);
  const decks = mergeEntities<Deck>('deck', local.decks, remote.decks, base.decks);
  const cards = mergeEntities<Card>('card', local.cards, remote.cards, base.cards);
  const reviews = mergeEntities<Review>('review', local.reviews, remote.reviews, base.reviews);
  const removedDecks = new Set(decks.filter(d => d.deletedAt).map(d => d.id));
  const removedCards = new Set(cards.filter(c => !!c.deletedAt || removedDecks.has(c.deckId)).map(c => c.id));
  return {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    decks, cards,
    reviews: reviews.filter(r => !removedCards.has(r.cardId)),
  };
}

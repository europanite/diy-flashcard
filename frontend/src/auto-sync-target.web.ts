/** Sync target and common ancestor belong to THIS browser only; never OAuth access tokens. */
import { validateSnapshot, type Snapshot } from './domain.ts';
import type { AutoSyncTarget } from './auto-sync-drive.ts';
const TARGET = 'diy-flashcard-auto-target-v1';
const BASE = 'diy-flashcard-auto-base-v1:';
function storage(): Storage { if (typeof localStorage === 'undefined') throw new Error('Web storage is unavailable.'); return localStorage; }
export async function loadAutoSyncTarget(): Promise<AutoSyncTarget | null> {
  const raw = storage().getItem(TARGET);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as AutoSyncTarget;
    return typeof value.id === 'string' && /^[A-Za-z0-9_-]+$/.test(value.id) && typeof value.name === 'string' ? value : null;
  } catch { return null; }
}
export async function saveAutoSyncTarget(value: AutoSyncTarget): Promise<void> { storage().setItem(TARGET, JSON.stringify(value)); }
export async function clearAutoSyncTarget(): Promise<void> { storage().removeItem(TARGET); }
export async function loadAutoSyncBaseline(fileId: string): Promise<Snapshot | null> {
  const raw = storage().getItem(BASE + fileId);
  if (!raw) return null;
  try { const value: unknown = JSON.parse(raw); validateSnapshot(value); return value; }
  catch { return null; }
}
export async function saveAutoSyncBaseline(fileId: string, value: Snapshot): Promise<void> {
  validateSnapshot(value); storage().setItem(BASE + fileId, JSON.stringify(value));
}
export async function clearAutoSyncBaseline(fileId: string): Promise<void> { storage().removeItem(BASE + fileId); }

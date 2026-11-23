// Auto-sync linking is currently a Web-only feature. Native app remains usable with manual Drive sync.
import type { Snapshot } from './domain.ts';
import type { AutoSyncTarget } from './auto-sync-drive.ts';
export async function loadAutoSyncTarget(): Promise<AutoSyncTarget | null> { return null; }
export async function saveAutoSyncTarget(_value: AutoSyncTarget): Promise<void> { throw new Error('Auto-sync setup is currently Web-only.'); }
export async function clearAutoSyncTarget(): Promise<void> { /* noop */ }
export async function loadAutoSyncBaseline(_id: string): Promise<Snapshot | null> { return null; }
export async function saveAutoSyncBaseline(_id: string, _s: Snapshot): Promise<void> { /* noop */ }
export async function clearAutoSyncBaseline(_id: string): Promise<void> { /* noop */ }

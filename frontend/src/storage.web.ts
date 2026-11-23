import { emptySnapshot, validateSnapshot, type Snapshot } from './domain';
const KEY = 'recalldeck-v1';
export async function loadSnapshot(): Promise<Snapshot> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptySnapshot();
    const data: unknown = JSON.parse(raw);
    validateSnapshot(data);
    return data;
  } catch (error) {
    // Do not overwrite a corrupted backup automatically.
    console.warn('Could not load local snapshot', error);
    throw new Error('Unable to load local data. Check your browser storage.');
  }
}
export async function saveSnapshot(s: Snapshot): Promise<void> {
  validateSnapshot(s);
  localStorage.setItem(KEY, JSON.stringify(s));
}

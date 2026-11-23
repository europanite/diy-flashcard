import AsyncStorage from '@react-native-async-storage/async-storage';
import { emptySnapshot, validateSnapshot, type Snapshot } from './domain';
const KEY = 'recalldeck-v1';
export async function loadSnapshot(): Promise<Snapshot> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return emptySnapshot();
  const data: unknown = JSON.parse(raw);
  validateSnapshot(data);
  return data;
}
export async function saveSnapshot(s: Snapshot): Promise<void> {
  validateSnapshot(s);
  await AsyncStorage.setItem(KEY, JSON.stringify(s));
}

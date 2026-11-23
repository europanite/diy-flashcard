// YOU_FLASHCARD_GOOGLE_PICKER_V2 — Google Picker is available on Web only.
export type PickedDriveJson = { id: string; name: string };
export function isJsonName(name: string): boolean { return name.toLowerCase().endsWith('.json'); }
export async function pickMyDriveJson(_token: string): Promise<PickedDriveJson | null> {
  throw new Error('Google Picker direct import is available in the Web app only.');
}

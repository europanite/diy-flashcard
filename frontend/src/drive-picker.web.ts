// YOU_FLASHCARD_GOOGLE_PICKER_V2: Picker grants access to user-selected Drive files.
// Web-only: no Drive-wide OAuth scope is required.
export type PickedDriveJson = { id: string; name: string };

type Gapi = { load: (name: string, callback: (() => void) | { callback: () => void; onerror: () => void }) => void };
type PickerDocument = { [key: string]: unknown };
type PickerResponse = { [key: string]: unknown };
type PickerView = {
  setMode: (mode: string) => PickerView;
};
type PickerInstance = { setVisible: (visible: boolean) => void };
type PickerBuilder = {
  addView: (view: PickerView) => PickerBuilder;
  setDeveloperKey: (key: string) => PickerBuilder;
  setAppId: (id: string) => PickerBuilder;
  setOAuthToken: (token: string) => PickerBuilder;
  setCallback: (callback: (data: PickerResponse) => void) => PickerBuilder;
  build: () => PickerInstance;
};
type PickerNamespace = {
  DocsView: new (viewId: string) => PickerView;
  PickerBuilder: new () => PickerBuilder;
  ViewId: { DOCS: string };
  DocsViewMode: { LIST: string };
  Action: { PICKED: string; CANCEL: string };
  Response: { ACTION: string; DOCUMENTS: string };
  Document: { ID: string; NAME: string };
};
type PickerWindow = Window & {
  gapi?: Gapi;
  google?: { picker?: PickerNamespace };
};

const API_KEY = process.env.EXPO_PUBLIC_GOOGLE_PICKER_API_KEY || '';
const PROJECT_NUMBER = process.env.EXPO_PUBLIC_GOOGLE_PROJECT_NUMBER || '';
let loader: Promise<PickerNamespace> | null = null;

/** A JSON file can have application/json or text/plain MIME in Google Drive. */
export function isJsonName(name: string): boolean {
  return typeof name === 'string' && name.toLowerCase().endsWith('.json');
}

function loadPicker(): Promise<PickerNamespace> {
  if (typeof window === 'undefined') return Promise.reject(new Error('Google Picker requires the Web app.'));
  const win = window as PickerWindow;
  if (win.google?.picker) return Promise.resolve(win.google.picker);
  if (loader) return loader;
  loader = new Promise<PickerNamespace>((resolve, reject) => {
    const initialize = () => {
      if (!win.gapi) { reject(new Error('Google API loader is unavailable.')); return; }
      win.gapi.load('picker', {
        callback: () => win.google?.picker ? resolve(win.google.picker) : reject(new Error('Google Picker did not initialize.')),
        onerror: () => reject(new Error('Could not load Google Picker. Check API enablement and network access.')),
      });
    };
    if (win.gapi) { initialize(); return; }
    const script = document.createElement('script');
    script.src = 'https://apis.google.com/js/api.js';
    script.async = true;
    script.onload = initialize;
    script.onerror = () => reject(new Error('Could not download the Google Picker script.'));
    document.head.appendChild(script);
  }).catch(error => { loader = null; throw error; });
  return loader;
}

/** Returns null on Cancel; never downloads a file in the browser. */
export async function pickMyDriveJson(token: string): Promise<PickedDriveJson | null> {
  if (!token) throw new Error('Connect Google Drive before selecting a file.');
  if (!API_KEY || !/^\d+$/.test(PROJECT_NUMBER)) {
    throw new Error('Set EXPO_PUBLIC_GOOGLE_PICKER_API_KEY and numeric EXPO_PUBLIC_GOOGLE_PROJECT_NUMBER in the root .env, then recreate the frontend.');
  }
  const picker = await loadPicker();
  return new Promise<PickedDriveJson | null>((resolve, reject) => {
    let done = false;
    const settle = (action: () => void) => {
      if (done) return;
      done = true;
      action();
    };
    try {
      // LIST mode works with the per-file drive.file scope (no thumbnail permissions).
      const view = new picker.DocsView(picker.ViewId.DOCS);
      view.setMode(picker.DocsViewMode.LIST);
      const dialog = new picker.PickerBuilder()
        .addView(view)
        .setOAuthToken(token)
        .setDeveloperKey(API_KEY)
        .setAppId(PROJECT_NUMBER)
        .setCallback((data) => {
          const action = data[picker.Response.ACTION];
          if (action === picker.Action.CANCEL) { settle(() => resolve(null)); return; }
          if (action !== picker.Action.PICKED) return;
          const docs = data[picker.Response.DOCUMENTS];
          const doc = Array.isArray(docs) ? docs[0] as PickerDocument | undefined : undefined;
          const id = doc?.[picker.Document.ID];
          const name = doc?.[picker.Document.NAME];
          if (typeof id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(id) || typeof name !== 'string') {
            settle(() => reject(new Error('Google Picker returned an invalid file.'))); return;
          }
          if (!isJsonName(name)) {
            settle(() => reject(new Error('Choose a .json file, not a Google Doc or another file type.'))); return;
          }
          settle(() => resolve({ id, name }));
        })
        .build();
      dialog.setVisible(true);
    } catch (error) { settle(() => reject(error)); }
  });
}

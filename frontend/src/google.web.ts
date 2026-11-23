import { useCallback, useEffect, useState } from 'react';
// YOU_FLASHCARD_DRIVE_V1: the app requests both hidden backup and visible app files.
const SCOPE = 'https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/drive.file';
const CLIENT = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || '';
type GoogleToken = { access_token?: string; error?: string; error_description?: string };
type TokenClient = { requestAccessToken: (options?: { prompt?: string }) => void };
type GoogleGlobal = { accounts: { oauth2: { initTokenClient: (config: { client_id: string; scope: string; callback: (r: GoogleToken) => void }) => TokenClient } } };
declare global { interface Window { google?: GoogleGlobal } }
let scriptPromise: Promise<void> | undefined;
function ensureScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('This feature is available in a browser only.'));
  if (window.google) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => window.google ? resolve() : reject(new Error('Unable to initialize Google authentication.'));
    script.onerror = () => reject(new Error('Unable to load the Google authentication script.'));
    document.head.appendChild(script);
  }).catch(error => { scriptPromise = undefined; throw error; });
  return scriptPromise;
}
export function useGoogleDriveAuth(): { token: string | null; configured: boolean; connect: () => Promise<void>; disconnect: () => void } {
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => { if (CLIENT) ensureScript().catch(() => {}); }, []);
  const connect = useCallback(async () => {
    if (!CLIENT) throw new Error('EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID is not configured.');
    await ensureScript();
    await new Promise<void>((resolve, reject) => {
      const client = window.google!.accounts.oauth2.initTokenClient({
        client_id: CLIENT, scope: SCOPE,
        callback: result => {
          if (result.access_token) { setToken(result.access_token); resolve(); }
          else reject(new Error(result.error_description || result.error || 'Google authentication was canceled.'));
        },
      });
      client.requestAccessToken();
    });
  }, []);
  return { token, configured: !!CLIENT, connect, disconnect: () => setToken(null) };
}

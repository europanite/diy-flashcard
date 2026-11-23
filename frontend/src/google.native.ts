import { useCallback, useEffect, useState } from 'react';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';
WebBrowser.maybeCompleteAuthSession();
const ANDROID = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID || '';
const IOS = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || '';
export function useGoogleDriveAuth(): { token: string | null; configured: boolean; connect: () => Promise<void>; disconnect: () => void } {
  const configured = Platform.OS === 'ios' ? !!IOS : !!ANDROID;
  // Placeholder prevents hook initialization from throwing in local-only mode.
  // Login remains disabled until the real per-platform OAuth client is configured.
  const [, result, promptAsync] = Google.useAuthRequest({
    iosClientId: IOS || 'not-configured',
    androidClientId: ANDROID || 'not-configured',
    // YOU_FLASHCARD_DRIVE_V1
    scopes: ['https://www.googleapis.com/auth/drive.appdata', 'https://www.googleapis.com/auth/drive.file'],
  });
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    if (result?.type === 'success') {
      setToken(result.authentication?.accessToken || result.params.access_token || null);
    }
  }, [result]);
  const connect = useCallback(async () => {
    if (!configured) throw new Error('Native Google OAuth Client ID is not configured.');
    const r = await promptAsync();
    if (r.type === 'error') throw new Error(r.error?.message || 'Google authentication error.');
    if (r.type === 'cancel' || r.type === 'dismiss') throw new Error('Google authentication was canceled.');
  }, [configured, promptAsync]);
  return { token, configured, connect, disconnect: () => setToken(null) };
}

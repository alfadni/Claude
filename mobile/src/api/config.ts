import { Platform } from 'react-native';

/**
 * Base URL of the forecast API, from EXPO_PUBLIC_API_URL (inlined at build
 * time). In development it falls back to the local server; the Android
 * emulator reaches the host machine on 10.0.2.2. Release builds refuse
 * anything but HTTPS.
 */
export function resolveApiUrl(
  env: string | undefined = process.env.EXPO_PUBLIC_API_URL,
  isDev: boolean = __DEV__,
  os: string = Platform.OS,
): string {
  const fallback = os === 'android' ? 'http://10.0.2.2:8000' : 'http://localhost:8000';
  const url = (env?.trim() || (isDev ? fallback : '')).replace(/\/+$/, '');
  if (!url) throw new Error('EXPO_PUBLIC_API_URL is not set for this build.');
  if (!isDev && !url.startsWith('https://')) {
    throw new Error('EXPO_PUBLIC_API_URL must use HTTPS in release builds.');
  }
  return url;
}

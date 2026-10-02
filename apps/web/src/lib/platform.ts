/**
 * Runtime platform: browser/PWA vs. the Android app (Capacitor).
 *
 * In the app the UI is served from the APK itself (http://localhost), so the
 * API server lives at a different, user-configurable address and requests
 * authenticate with a bearer token instead of a cookie.
 */
import { Capacitor } from '@capacitor/core';

export const isNative = Capacitor.isNativePlatform();
export const platform = Capacitor.getPlatform();

const API_KEY = 'sos-api-url';
const TOKEN_KEY = 'sos-token';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // storage unavailable
  }
}

/** Base URL for API calls ('' = same origin, the default on the web). */
export function apiBase(): string {
  const configured = read(API_KEY);
  if (configured) return configured;
  return (import.meta.env.VITE_API_URL as string | undefined) ?? '';
}

/** Normalise and save the server address, e.g. "192.168.1.10:4000" → "http://192.168.1.10:4000". */
export function setApiBase(raw: string): string {
  let v = raw.trim().replace(/\/+$/, '');
  if (v && !/^https?:\/\//i.test(v)) v = `http://${v}`;
  write(API_KEY, v || null);
  return v;
}

export function authToken(): string | null {
  return isNative ? read(TOKEN_KEY) : null;
}

export function setAuthToken(token: string | null | undefined) {
  if (isNative) write(TOKEN_KEY, token ?? null);
}

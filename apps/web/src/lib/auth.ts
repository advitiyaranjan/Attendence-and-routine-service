import { api, ApiError } from './api';
import { db, kvGet, kvSet } from './db';
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { registerPlugin } from '@capacitor/core';
import { apiBase, isNative, setAuthToken } from './platform';
import { useSetup } from './setup';
import { toast, useApp, type User } from './store';
import { resetSyncCursor, syncNow } from './sync';
import { disablePush, ensurePushSubscription, flushDeliveryReports, pullReadState } from './notifications';

const USER_KEY = 'auth.user';
const LOCAL_MODE_KEY = 'auth.localMode';

/** Restore the cached user immediately (offline-friendly), then confirm with the server. */
export async function initAuth() {
  const [cached, localMode] = await Promise.all([kvGet<User>(USER_KEY), kvGet<boolean>(LOCAL_MODE_KEY)]);
  useApp.setState({ localMode: !!localMode });
  if (cached) useApp.getState().setUser(cached);
  await checkServer();
}

/** Ask the server who we are. Also used by the login page's "Try again". */
export async function checkServer(): Promise<boolean> {
  try {
    const res = await api<{ user: User | null; googleClientId: string | null; googleAndroidClientId?: string | null }>('/api/auth/me');
    useApp.setState({ googleClientId: res.googleClientId, googleAndroidClientId: res.googleAndroidClientId ?? null, serverIssue: null });
    await setSignedIn(res.user);
    return true;
  } catch (err) {
    // offline or server down: keep the cached session, app stays fully usable
    useApp.setState({ authChecked: true, serverIssue: err instanceof ApiError ? err.message : "Can't reach the server right now." });
    return false;
  }
}

/** Use the app on this device only (when the server can't be reached). Sign in later from Settings. */
export async function continueOffline() {
  await kvSet(LOCAL_MODE_KEY, true);
  useApp.setState({ localMode: true });
}

async function setSignedIn(user: User | null) {
  const previous = await kvGet<User>(USER_KEY);
  if (user && previous && previous.id !== user.id) {
    // Different account on this device: start a fresh pull.
    await resetSyncCursor();
  }
  await kvSet(USER_KEY, user);
  if (user && (!previous || previous.id !== user.id)) useApp.setState({ firstSyncDone: false });
  useApp.getState().setUser(user);
  if (user) {
    await kvSet(LOCAL_MODE_KEY, false);
    useApp.setState({ localMode: false });
    void syncNow();
    void ensurePushSubscription();
    void flushDeliveryReports();
    void pullReadState();
  }
}

/** An emailed one-time code the student must enter to finish. */
export interface OtpChallenge {
  challengeId: string;
  email: string;
  purpose: 'register' | 'login' | 'reset' | 'change_email';
}

/** Step 1: check details and email a code. The account exists only after `verifyCode`. */
export async function register(email: string, password: string, name?: string) {
  return (await api<{ otp: OtpChallenge }>('/api/auth/register', { body: { email, password, name } })).otp;
}

/** Step 1: check the password and email a code. */
export async function login(email: string, password: string) {
  return (await api<{ otp: OtpChallenge }>('/api/auth/login', { body: { email, password } })).otp;
}

/** Step 2 of sign-in / sign-up. */
export async function verifyCode(otp: OtpChallenge, code: string) {
  const res = await api<{ user: User; token?: string }>('/api/auth/otp/verify', { body: { challengeId: otp.challengeId, code, purpose: otp.purpose } });
  setAuthToken(res.token);
  await setSignedIn(res.user);
}

export async function resendCode(otp: OtpChallenge) {
  await api('/api/auth/otp/resend', { body: { challengeId: otp.challengeId } });
}

export async function forgotPassword(email: string) {
  return (await api<{ otp: OtpChallenge }>('/api/auth/password/forgot', { body: { email } })).otp;
}

/** Set a new password with the emailed code; signs in on success. */
export async function resetPassword(otp: OtpChallenge, code: string, password: string) {
  const res = await api<{ user: User; token?: string }>('/api/auth/password/reset', { body: { challengeId: otp.challengeId, code, password } });
  setAuthToken(res.token);
  await setSignedIn(res.user);
}

/** Change email: a code is sent to the new address. */
export async function changeEmail(email: string) {
  return (await api<{ otp: OtpChallenge }>('/api/auth/email/change', { body: { email } })).otp;
}

export async function confirmEmailChange(otp: OtpChallenge, code: string) {
  const res = await api<{ user: User }>('/api/auth/email/change/verify', { body: { challengeId: otp.challengeId, code } });
  useApp.getState().setUser(res.user);
  await kvSet(USER_KEY, res.user);
}

export async function loginWithGoogle(credential: string, nonce?: string) {
  const res = await api<{ user: User; token?: string }>('/api/auth/google', { body: { credential, nonce } });
  setAuthToken(res.token);
  await setSignedIn(res.user);
}

/**
 * Sign out. Local data stays on this device unless `wipe` is set, in which case
 * everything (including unsynced changes) is removed.
 */
export async function logout(wipe: boolean) {
  // Stop push reminders for the signed-out account on this device.
  await disablePush().catch(() => undefined);
  await kvSet('push.optOut', false);
  try {
    await api('/api/auth/logout', { body: {} });
  } catch {
    // still sign out locally
  }
  setAuthToken(null);
  useSetup.getState().reset();
  await kvSet(USER_KEY, null);
  await resetSyncCursor();
  if (wipe) {
    await db.delete();
    location.reload();
    return;
  }
  useApp.getState().setUser(null);
  useApp.getState().setSync({ phase: 'local' });
}

// ---------------------------------------------------------------------------
// Google sign-in in the Android app: Chrome tab → /app-google → back via the app's link.

/** The app's link that /app-google returns to (see the intent filter in AndroidManifest.xml). */
export const APP_LINK_GOOGLE = 'com.studentos.app://google';
const NONCE_KEY = 'sos-google-nonce';

async function sha256Hex(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const GoogleSignIn = registerPlugin<{ signIn(o: { serverClientId: string; nonce: string }): Promise<{ idToken: string }> }>('GoogleSignIn');

/**
 * Google's account picker inside the app; falls back to a Chrome tab when the phone
 * can't show it (no Google Play services, older app build...).
 */
export async function startNativeGoogleSignIn() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const nonce = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  const { googleClientId, googleAndroidClientId } = useApp.getState();
  if (googleClientId && !nativeGoogleBroken()) {
    try {
      let idToken: string;
      try {
        ({ idToken } = await GoogleSignIn.signIn({ serverClientId: googleClientId, nonce: await sha256Hex(nonce) }));
      } catch (first) {
        // Second try with the Android OAuth client id (the server accepts tokens for either).
        if (!googleAndroidClientId) throw first;
        console.warn('In-app Google sign-in with the web client id failed', first);
        ({ idToken } = await GoogleSignIn.signIn({ serverClientId: googleAndroidClientId, nonce: await sha256Hex(nonce) }));
      }
      await loginWithGoogle(idToken, nonce);
      return;
    } catch (err) {
      // Server said no (e.g. network): show that rather than opening a tab.
      if (err instanceof ApiError) throw err;
      const detail = (err as Error).message ?? '';
      console.warn('In-app Google sign-in failed', err);
      // A real "back" tap on the picker: stop. Anything else (including the "cancelled"
      // Android reports when the app isn't matched to its Google client) → browser sign-in.
      if (/user canceled|user cancelled|TYPE_USER_CANCELED/i.test(detail) && !/\[\d+\]/.test(detail)) {
        toast("Google sign-in didn't finish.", 'error', { label: 'Use browser', run: () => void openGoogleInBrowser() });
        return;
      }
      markNativeGoogleBroken(detail);
      toast(`Signing in through the browser (in-app: ${detail || 'failed'})`, 'success');
    }
  }
  await openGoogleInBrowser();
}

const NATIVE_FAIL_KEY = 'sos-google-native-failed-v2';
/** After the in-app picker fails, go straight to the browser for a day (then try the picker again). */
function nativeGoogleBroken(): boolean {
  try {
    const at = Number(JSON.parse(localStorage.getItem(NATIVE_FAIL_KEY) ?? 'null')?.at ?? 0);
    return Date.now() - at < 24 * 3600_000;
  } catch {
    return false;
  }
}
function markNativeGoogleBroken(detail: string) {
  try {
    localStorage.setItem(NATIVE_FAIL_KEY, JSON.stringify({ at: Date.now(), detail }));
  } catch {
    // storage unavailable
  }
}

/** Fallback: Google sign-in in a Chrome tab, which returns to the app by its link. */
async function openGoogleInBrowser() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const nonce = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  try {
    localStorage.setItem(NONCE_KEY, nonce);
  } catch {
    // Kept in memory below as well.
  }
  pendingNonce = nonce;
  await Browser.open({ url: `${apiBase()}/app-google?nonce=${await sha256Hex(nonce)}` });
}

let pendingNonce: string | null = null;

async function finishNativeGoogle(url: string) {
  if (!url.startsWith(APP_LINK_GOOGLE)) return;
  void Browser.close().catch(() => undefined);
  const credential = new URL(url.replace(/^com\.studentos\.app:/, 'https:')).searchParams.get('credential');
  let nonce = pendingNonce;
  try {
    nonce ??= localStorage.getItem(NONCE_KEY);
    localStorage.removeItem(NONCE_KEY);
  } catch {
    // storage unavailable
  }
  pendingNonce = null;
  if (!credential || !nonce) return;
  try {
    await loginWithGoogle(credential, nonce);
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Google sign-in failed. Please try again.', 'error');
  }
}

/** Call once at startup: completes a Google sign-in when the Chrome tab sends us back. */
export function listenForGoogleReturn() {
  if (!isNative) return;
  void App.addListener('appUrlOpen', ({ url }) => void finishNativeGoogle(url));
  void App.getLaunchUrl().then((r) => {
    if (r?.url) void finishNativeGoogle(r.url);
  });
}

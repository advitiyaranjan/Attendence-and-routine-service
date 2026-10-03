import { api, ApiError } from './api';
import { db, kvGet, kvSet } from './db';
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { registerPlugin } from '@capacitor/core';
import { apiBase, isNative, setAuthToken } from './platform';
import { useSetup } from './setup';
import { useApp, type User } from './store';
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
/** Waits for a best-effort step, but never longer than `ms` (sign-out must not hang on the network). */
const atMost = (p: Promise<unknown>, ms: number) => Promise.race([p.catch(() => undefined), new Promise((r) => setTimeout(r, ms))]);

export async function logout(wipe: boolean) {
  // Stop push reminders for the signed-out account on this device.
  await atMost(disablePush(), 4000);
  await kvSet('push.optOut', false);
  await atMost(api('/api/auth/logout', { body: {} }), 4000);
  setAuthToken(null);
  useSetup.getState().reset();
  await kvSet(USER_KEY, null);
  await resetSyncCursor();
  if (wipe) {
    await db.delete();
    location.reload();
    return;
  }
  // Back to the sign-in screen, even if "Use on this device only" was chosen before.
  await kvSet(LOCAL_MODE_KEY, false);
  useApp.setState({ localMode: false });
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

const GoogleSignIn = registerPlugin<{ signIn(o: { serverClientId: string; nonce?: string; method?: 'button' | 'sheet' | 'legacy' }): Promise<{ idToken: string }> }>('GoogleSignIn');

/**
 * Google's account picker inside the app. If it fails, the exact error stays on the sign-in
 * screen with a "Use browser" button (Chrome tab sign-in), instead of failing silently.
 */
/**
 * In-app account picker off: on this app's Google Cloud setup it fails ("[10] DEVELOPER_ERROR"),
 * so "Continue with Google" signs in through a Chrome tab. Set to true to try the picker first.
 */
const IN_APP_GOOGLE = false;

export async function startNativeGoogleSignIn() {
  useApp.setState({ googleNotice: null });
  const { googleClientId } = useApp.getState();
  if (!IN_APP_GOOGLE || !googleClientId) return openGoogleInBrowser();
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const nonce = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  const hashed = await sha256Hex(nonce);
  const errors: string[] = [];
  // Some phones fail one of Google's in-app methods (e.g. "[16] Account reauth failed"
  // from the Sign in with Google picker) while another works, so try them in turn.
  for (const method of ['button', 'sheet', 'legacy'] as const) {
    let idToken: string;
    try {
      ({ idToken } = await GoogleSignIn.signIn({ serverClientId: googleClientId, nonce: hashed, method }));
    } catch (err) {
      const message = (err as Error).message || 'failed';
      console.warn(`In-app Google sign-in (${method}) failed`, err);
      // The classic chooser closed by the student (12501): a real "back", so stop quietly.
      if (method === 'legacy' && /\[12501\]/.test(message)) return;
      errors.push(`${method}: ${message}`);
      continue;
    }
    // The classic method can't carry the nonce; the server only checks it when present.
    await loginWithGoogle(idToken, method === 'legacy' ? undefined : nonce);
    return;
  }
  useApp.setState({ googleNotice: `In-app Google sign-in didn't work. ${errors.join(' | ')}` });
}

/** Fallback: Google sign-in in a Chrome tab, which returns to the app by its link. */
export async function openGoogleInBrowser() {
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
    useApp.setState({ googleNotice: err instanceof Error ? err.message : 'Google sign-in failed. Please try again.' });
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

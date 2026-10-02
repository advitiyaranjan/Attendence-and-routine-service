import { api, ApiError } from './api';
import { db, kvGet, kvSet } from './db';
import { setAuthToken } from './platform';
import { useSetup } from './setup';
import { useApp, type User } from './store';
import { resetSyncCursor, syncNow } from './sync';
import { disablePush, ensurePushSubscription, flushDeliveryReports } from './notifications';

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
    const res = await api<{ user: User | null; googleClientId: string | null }>('/api/auth/me');
    useApp.setState({ googleClientId: res.googleClientId, serverIssue: null });
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
  }
}

export async function register(email: string, password: string, name?: string) {
  const res = await api<{ user: User; token?: string }>('/api/auth/register', { body: { email, password, name } });
  setAuthToken(res.token);
  await setSignedIn(res.user);
}

export async function login(email: string, password: string) {
  const res = await api<{ user: User; token?: string }>('/api/auth/login', { body: { email, password } });
  setAuthToken(res.token);
  await setSignedIn(res.user);
}

export async function loginWithGoogle(credential: string) {
  const res = await api<{ user: User; token?: string }>('/api/auth/google', { body: { credential } });
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

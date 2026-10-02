import { api } from './api';
import { db, kvGet, kvSet } from './db';
import { setAuthToken } from './platform';
import { useApp, type User } from './store';
import { resetSyncCursor, syncNow } from './sync';
import { disablePush, ensurePushSubscription, flushDeliveryReports } from './notifications';

const USER_KEY = 'auth.user';

/** Restore the cached user immediately (offline-friendly), then confirm with the server. */
export async function initAuth() {
  const cached = await kvGet<User>(USER_KEY);
  if (cached) useApp.getState().setUser(cached);
  try {
    const res = await api<{ user: User | null; googleClientId: string | null }>('/api/auth/me');
    useApp.setState({ googleClientId: res.googleClientId });
    await setSignedIn(res.user);
  } catch {
    // offline or server down: keep the cached session, app stays fully usable
    useApp.setState({ authChecked: true });
  }
}

async function setSignedIn(user: User | null) {
  const previous = await kvGet<User>(USER_KEY);
  if (user && previous && previous.id !== user.id) {
    // Different account on this device: start a fresh pull.
    await resetSyncCursor();
  }
  await kvSet(USER_KEY, user);
  useApp.getState().setUser(user);
  if (user) {
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

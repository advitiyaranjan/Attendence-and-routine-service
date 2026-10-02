import { create } from 'zustand';

export interface User {
  id: string;
  email: string | null;
  name: string | null;
  hasGoogle: boolean;
}

export type SyncPhase = 'idle' | 'syncing' | 'error' | 'offline' | 'local';

export interface Toast {
  id: number;
  message: string;
  tone: 'info' | 'success' | 'error';
  action?: { label: string; run: () => void };
}

interface AppState {
  online: boolean;
  user: User | null;
  authChecked: boolean;
  /** Set once the first sync after start-up or sign-in has finished (or failed). */
  firstSyncDone: boolean;
  /** Why the server couldn't be reached at start-up, if it couldn't. */
  serverIssue: string | null;
  /** The student chose to use the app on this device only because the server was unreachable. */
  localMode: boolean;
  googleClientId: string | null;
  aiAvailable: boolean | null;
  /** Why AI is unavailable, in words the student can act on. */
  aiIssue: string | null;
  sync: { phase: SyncPhase; lastSyncedAt: string | null; pending: number; error: string | null; conflicts: number };
  quickAdd: string | null;
  toasts: Toast[];
  setOnline(v: boolean): void;
  setUser(u: User | null): void;
  setSync(p: Partial<AppState['sync']>): void;
  openQuickAdd(kind: string | null): void;
  toast(message: string, tone?: Toast['tone'], action?: Toast['action']): void;
  dismissToast(id: number): void;
}

let toastId = 0;

export const useApp = create<AppState>((set, get) => ({
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  user: null,
  authChecked: false,
  firstSyncDone: false,
  serverIssue: null,
  localMode: false,
  googleClientId: null,
  aiAvailable: null,
  aiIssue: null,
  sync: { phase: 'local', lastSyncedAt: null, pending: 0, error: null, conflicts: 0 },
  quickAdd: null,
  toasts: [],
  setOnline: (online) => set({ online }),
  setUser: (user) => set({ user, authChecked: true }),
  setSync: (p) => set({ sync: { ...get().sync, ...p } }),
  openQuickAdd: (quickAdd) => set({ quickAdd }),
  toast: (message, tone = 'info', action) => {
    const id = ++toastId;
    set({ toasts: [...get().toasts, { id, message, tone, action }] });
    setTimeout(() => get().dismissToast(id), action ? 6000 : 3500);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

export const toast = (...args: Parameters<AppState['toast']>) => useApp.getState().toast(...args);

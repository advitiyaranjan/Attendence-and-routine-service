/**
 * First-run setup state shared by AI Pilot and Manual setup, so the student can
 * switch between them at any point without losing answers. Kept per tab in
 * sessionStorage, so an accidental reload doesn't restart setup.
 *
 * Settings are written once, on finish. Timetable rows are saved as soon as the
 * student confirms them (same as everywhere else in the app).
 */
import { create } from 'zustand';
import { addMonths, todayISO, type Settings } from '@student-os/core';
import type { ReviewRow } from '../components/TimetableImport';
import { defaultSettings, saveSettings } from './repo';
import { useApp } from './store';

export type SetupMode = 'choice' | 'pilot' | 'manual';

export interface PilotMessage {
  id: number;
  role: 'assistant' | 'user';
  text: string;
  /** Extracted timetable shown for confirmation. */
  schedule?: ReviewRow[];
  warnings?: string[];
  /** A step's checklist of what was configured. */
  checklist?: string[];
}

export interface PilotState {
  step: string;
  messages: PilotMessage[];
  /** Rows extracted from the uploaded timetable, awaiting confirmation. */
  rows: ReviewRow[] | null;
  warnings: string[];
  saved: { subjects: number; classes: number } | null;
}

interface SetupState {
  mode: SetupMode;
  draft: Settings;
  manualStep: number;
  pilot: PilotState;
  setMode(mode: SetupMode): void;
  patch(p: Partial<Settings>): void;
  patchProfile(p: Partial<Settings['profile']>): void;
  patchClassReminder(minutes: number): void;
  setManualStep(step: number): void;
  setPilot(p: Partial<PilotState> | ((s: PilotState) => Partial<PilotState>)): void;
  finish(): Promise<void>;
  /** Forget all setup progress (e.g. on sign-out, so the next account starts clean). */
  reset(): void;
}

const KEY = 'sos-setup';

function initialDraft(): Settings {
  const today = todayISO();
  const base = defaultSettings();
  return { ...base, semesterStart: today, semesterEnd: addMonths(today, 4), profile: { ...base.profile, name: useApp.getState().user?.name ?? '' } };
}

const emptyPilot = (): PilotState => ({ step: 'intro', messages: [], rows: null, warnings: [], saved: null });

function load(): Pick<SetupState, 'mode' | 'draft' | 'manualStep' | 'pilot'> | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export const useSetup = create<SetupState>((set, get) => {
  const saved = load();
  return {
    mode: saved?.mode ?? 'choice',
    draft: saved?.draft ?? initialDraft(),
    manualStep: saved?.manualStep ?? 0,
    pilot: saved?.pilot ?? emptyPilot(),
    setMode: (mode) => set({ mode }),
    patch: (p) => set({ draft: { ...get().draft, ...p } }),
    patchProfile: (p) => set({ draft: { ...get().draft, profile: { ...get().draft.profile, ...p } } }),
    patchClassReminder: (minutes) => {
      const d = get().draft;
      const c = d.notifications.categories;
      set({
        draft: {
          ...d,
          notifications: { ...d.notifications, categories: { ...c, classes: { ...c.classes, enabled: minutes > 0, offsets: minutes > 0 ? [minutes] : [] } } },
        },
      });
    },
    setManualStep: (manualStep) => set({ manualStep }),
    setPilot: (p) => set({ pilot: { ...get().pilot, ...(typeof p === 'function' ? p(get().pilot) : p) } }),
    reset() {
      try {
        sessionStorage.removeItem(KEY);
      } catch {
        // ignore
      }
      set({ mode: 'choice', draft: initialDraft(), manualStep: 0, pilot: emptyPilot() });
    },
    async finish() {
      const { id: _i, createdAt: _c, updatedAt: _u, deletedAt: _d, version: _v, deviceId: _dv, syncStatus: _s, ...rest } = get().draft;
      if (rest.targetAttendance < rest.minAttendance) rest.targetAttendance = rest.minAttendance;
      if (rest.safeAttendance < rest.targetAttendance) rest.safeAttendance = Math.min(100, rest.targetAttendance + 5);
      await saveSettings({ ...rest, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', onboarded: true });
      try {
        sessionStorage.removeItem(KEY);
      } catch {
        // ignore
      }
      set({ mode: 'choice', draft: initialDraft(), manualStep: 0, pilot: emptyPilot() });
    },
  };
});

useSetup.subscribe((s) => {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ mode: s.mode, draft: s.draft, manualStep: s.manualStep, pilot: s.pilot }));
  } catch {
    // storage unavailable: progress just isn't kept across reloads
  }
});

import { useEffect, useState } from 'react';
import { Bell, Brain, CheckCircle2, ChevronLeft } from 'lucide-react';
import { addMonths, initialRevisions, todayISO, WEEKDAY_SHORT, type Settings } from '@student-os/core';
import { AuthForm } from '../components/AuthForm';
import { TimetableImport } from '../components/TimetableImport';
import { Button, Card, cn, Field, Input, Modal, Select } from '../components/ui';
import { useAll } from '../lib/hooks';
import { requestNotificationPermission } from '../lib/notifications';
import { defaultSettings, saveSettings } from '../lib/repo';
import { toast, useApp } from '../lib/store';

const STEPS = ['Profile', 'Timetable', 'Attendance', 'Study target', 'Revision', 'Notifications'];

/** Onboarding progress survives an accidental reload (per tab). */
const PROGRESS_KEY = 'sos-onboarding';
function loadProgress(): { step: number; draft: Settings } | null {
  try {
    const raw = sessionStorage.getItem(PROGRESS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function Onboarding() {
  const [step, setStep] = useState(() => loadProgress()?.step ?? -1);
  const [draft, setDraft] = useState<Settings>(
    () =>
      loadProgress()?.draft ?? {
        ...defaultSettings(),
        semesterStart: todayISO(),
        semesterEnd: addMonths(todayISO(), 4),
      },
  );
  useEffect(() => {
    try {
      sessionStorage.setItem(PROGRESS_KEY, JSON.stringify({ step, draft }));
    } catch {
      // storage unavailable: progress just isn't kept across reloads
    }
  }, [step, draft]);
  const [signIn, setSignIn] = useState(false);
  const user = useApp((s) => s.user);
  const schedules = useAll('classSchedule') ?? [];
  const set = (patch: Partial<Settings>) => setDraft((d) => ({ ...d, ...patch }));
  const setProfile = (patch: Partial<Settings['profile']>) => setDraft((d) => ({ ...d, profile: { ...d.profile, ...patch } }));

  async function finish() {
    const { id: _i, createdAt: _c, updatedAt: _u, deletedAt: _d, version: _v, deviceId: _dv, syncStatus: _s, ...rest } = draft;
    await saveSettings({ ...rest, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', onboarded: true });
    try {
      sessionStorage.removeItem(PROGRESS_KEY);
    } catch {
      // ignore
    }
    toast('Your academic workspace is ready.', 'success');
  }

  if (step === -1) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-10">
        <Brain className="mb-6 size-10 text-accent" />
        <h1 className="text-3xl font-semibold tracking-tight">Your academic life, organised automatically.</h1>
        <p className="mt-3 text-ink-2">
          Upload your timetable once. Student OS tracks attendance, plans your day, schedules revisions and keeps everything working offline.
        </p>
        <div className="mt-8 flex flex-col gap-2">
          <Button variant="primary" onClick={() => setStep(0)}>
            Get started
          </Button>
          <Button variant="ghost" onClick={() => setSignIn(true)}>
            {user ? `Signed in as ${user.email} — waiting for your data…` : 'I already have an account'}
          </Button>
        </div>
        <p className="mt-6 text-xs text-muted">No account needed. Everything is stored on this device until you choose to sign in.</p>
        <Modal open={signIn} onClose={() => setSignIn(false)} title="Sign in to restore your workspace">
          <AuthForm onSuccess={() => setSignIn(false)} />
        </Modal>
      </div>
    );
  }

  const preview = initialRevisions(todayISO(), draft.revisionIntervals);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6 flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => setStep(step - 1)} aria-label="Back">
          <ChevronLeft className="size-4" />
        </Button>
        <ol className="flex flex-1 gap-1" aria-label="Progress">
          {STEPS.map((s, i) => (
            <li key={s} className={cn('h-1.5 flex-1 rounded-full', i <= step ? 'bg-accent' : 'bg-line')} aria-current={i === step ? 'step' : undefined}>
              <span className="sr-only">{s}</span>
            </li>
          ))}
        </ol>
        <span className="text-xs text-muted">
          {Math.min(step + 1, STEPS.length)}/{STEPS.length}
        </span>
      </div>

      {step === 0 && (
        <Card className="space-y-4">
          <h2 className="text-lg font-semibold">Create your profile</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name">
              <Input value={draft.profile.name} onChange={(e) => setProfile({ name: e.target.value })} autoFocus />
            </Field>
            <Field label="College / university">
              <Input value={draft.profile.college} onChange={(e) => setProfile({ college: e.target.value })} />
            </Field>
            <Field label="Course / programme">
              <Input value={draft.profile.course} onChange={(e) => setProfile({ course: e.target.value })} placeholder="B.Tech CSE" />
            </Field>
            <Field label="Semester">
              <Input value={draft.profile.semester} onChange={(e) => setProfile({ semester: e.target.value })} placeholder="5" />
            </Field>
            <Field label="Academic year">
              <Input value={draft.profile.academicYear} onChange={(e) => setProfile({ academicYear: e.target.value })} placeholder="2026–27" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="College starts">
                <Input type="time" value={draft.collegeStart} onChange={(e) => set({ collegeStart: e.target.value })} />
              </Field>
              <Field label="College ends">
                <Input type="time" value={draft.collegeEnd} onChange={(e) => set({ collegeEnd: e.target.value })} />
              </Field>
            </div>
            <Field label="Semester starts" hint="Attendance is counted from this date.">
              <Input type="date" value={draft.semesterStart ?? ''} onChange={(e) => set({ semesterStart: e.target.value || null })} />
            </Field>
            <Field label="Semester ends" hint="Lets us count classes remaining.">
              <Input type="date" value={draft.semesterEnd ?? ''} onChange={(e) => set({ semesterEnd: e.target.value || null })} />
            </Field>
          </div>
          <Field label="Working days" group>
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAY_SHORT.map((d, i) => {
                const on = draft.workingDays.includes(i);
                return (
                  <button
                    key={d}
                    aria-pressed={on}
                    onClick={() => set({ workingDays: on ? draft.workingDays.filter((x) => x !== i) : [...draft.workingDays, i].sort() })}
                    className={cn('rounded-lg border px-3 py-1.5 text-sm', on ? 'border-accent bg-accent-soft font-medium' : 'border-line text-ink-2')}
                  >
                    {d}
                  </button>
                );
              })}
            </div>
          </Field>
          <div className="flex justify-end">
            <Button variant="primary" onClick={() => setStep(1)}>
              Continue
            </Button>
          </div>
        </Card>
      )}

      {step === 1 && (
        <Card className="space-y-4">
          <h2 className="text-lg font-semibold">Add your timetable</h2>
          {schedules.length > 0 ? (
            <div className="space-y-3">
              <p className="flex items-center gap-2 text-sm">
                <CheckCircle2 className="size-4" style={{ color: 'var(--color-good)' }} /> {schedules.length} weekly classes saved.
              </p>
              <div className="flex justify-end">
                <Button variant="primary" onClick={() => setStep(2)}>
                  Continue
                </Button>
              </div>
            </div>
          ) : (
            <>
              <TimetableImport mode="onboarding" onDone={() => setStep(2)} />
              <div className="flex justify-end">
                <Button variant="ghost" onClick={() => setStep(2)}>
                  Skip for now
                </Button>
              </div>
            </>
          )}
        </Card>
      )}

      {step === 2 && (
        <Card className="space-y-4">
          <h2 className="text-lg font-semibold">Attendance requirement</h2>
          <p className="text-sm text-ink-2">You can override these per subject later.</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Minimum required %">
              <Input type="number" min={0} max={100} value={draft.minAttendance} onChange={(e) => set({ minAttendance: Number(e.target.value) })} />
            </Field>
            <Field label="Your target %">
              <Input type="number" min={0} max={100} value={draft.targetAttendance} onChange={(e) => set({ targetAttendance: Number(e.target.value) })} />
            </Field>
            <Field label="Comfortably safe %">
              <Input type="number" min={0} max={100} value={draft.safeAttendance} onChange={(e) => set({ safeAttendance: Number(e.target.value) })} />
            </Field>
          </div>
          <div className="flex justify-end">
            <Button variant="primary" onClick={() => setStep(3)}>
              Continue
            </Button>
          </div>
        </Card>
      )}

      {step === 3 && (
        <Card className="space-y-4">
          <h2 className="text-lg font-semibold">Daily study target</h2>
          <Field label="Hours of self-study per day">
            <Select value={draft.dailyStudyTargetMinutes} onChange={(e) => set({ dailyStudyTargetMinutes: Number(e.target.value) })}>
              {[60, 90, 120, 180, 240, 300, 360].map((m) => (
                <option key={m} value={m}>
                  {m / 60} h
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex justify-end">
            <Button variant="primary" onClick={() => setStep(4)}>
              Continue
            </Button>
          </div>
        </Card>
      )}

      {step === 4 && (
        <Card className="space-y-4">
          <h2 className="text-lg font-semibold">Revision schedule</h2>
          <p className="text-sm text-ink-2">
            When you log a topic you learned, revisions are scheduled on these days after learning. They adapt to how well you remember.
          </p>
          <Field label="Days after learning" hint="Comma-separated, e.g. 1, 3, 7, 30, 90, 180">
            <Input
              defaultValue={draft.revisionIntervals.join(', ')}
              onBlur={(e) => {
                const nums = e.target.value
                  .split(/[,\s]+/)
                  .map(Number)
                  .filter((n) => Number.isInteger(n) && n > 0);
                if (nums.length) set({ revisionIntervals: [...new Set(nums)].sort((a, b) => a - b) });
              }}
            />
          </Field>
          <p className="text-xs text-muted">Learn something today → revise on {preview.map((p) => p.dueDate.slice(5)).join(', ')}</p>
          <div className="flex justify-end">
            <Button variant="primary" onClick={() => setStep(5)}>
              Continue
            </Button>
          </div>
        </Card>
      )}

      {step === 5 && (
        <Card className="space-y-4">
          <h2 className="text-lg font-semibold">Notifications</h2>
          <p className="text-sm text-ink-2">Get a reminder before each class and a one-tap “Did you attend?” afterwards.</p>
          <Field label="Remind me before class">
            <Select
              value={draft.notifications.categories.classes.offsets[0] ?? 0}
              onChange={(e) => {
                const v = Number(e.target.value);
                const c = draft.notifications.categories;
                set({ notifications: { ...draft.notifications, categories: { ...c, classes: { ...c.classes, enabled: v > 0, offsets: v > 0 ? [v] : [] } } } });
              }}
            >
              {[0, 5, 10, 15, 30].map((m) => (
                <option key={m} value={m}>
                  {m === 0 ? 'No reminder' : `${m} minutes before`}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="secondary"
              icon={<Bell className="size-4" />}
              onClick={async () => {
                await requestNotificationPermission();
                await finish();
              }}
            >
              Enable notifications & finish
            </Button>
            <Button variant="primary" onClick={finish}>
              Finish
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

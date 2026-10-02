/** Manual setup: a 7-step wizard. Every step can be skipped; switch to AI Pilot at any point. */
import { useState, type ReactNode } from 'react';
import { Bell, Bot, Check, ChevronLeft, Plus, Trash2, Upload } from 'lucide-react';
import { formatMinutes, initialRevisions, todayISO, WEEKDAY_SHORT, type Settings } from '@student-os/core';
import { ScheduleForm } from '../../components/forms';
import { TimetableImport } from '../../components/TimetableImport';
import { AppLogo, Button, Chip, cn, Field, Input, Modal, SubjectDot, Toggle } from '../../components/ui';
import { nextSubjectColor } from '../../lib/actions';
import { useAll, useSubjectMap } from '../../lib/hooks';
import { notificationsSupported, requestNotificationPermission } from '../../lib/notifications';
import { create, remove } from '../../lib/repo';
import { useSetup } from '../../lib/setup';
import { STUDY_TIMES } from '../../lib/setup-parse';
import { toast } from '../../lib/store';

const STEPS = [
  { title: 'Basic academic information', short: 'Basics' },
  { title: 'Subjects', short: 'Subjects' },
  { title: 'Class schedule', short: 'Schedule' },
  { title: 'Attendance rules', short: 'Attendance' },
  { title: 'Revision preferences', short: 'Revision' },
  { title: 'Notifications', short: 'Notifications' },
  { title: 'Study preferences', short: 'Study' },
];
const RECOMMENDED = [1, 3, 7, 30, 90, 180];

export function ManualSetup() {
  const { manualStep: step, setManualStep, setMode, finish } = useSetup();
  const [finishing, setFinishing] = useState(false);
  const last = step === STEPS.length - 1;

  async function next() {
    if (!last) {
      setManualStep(step + 1);
      window.scrollTo(0, 0);
      return;
    }
    setFinishing(true);
    await finish();
    toast('Your academic workspace is ready.', 'success');
  }

  return (
    <div className="safe-top safe-bottom min-h-dvh bg-page">
      <header className="sticky top-0 z-10 border-b border-line bg-surface/85 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
          {step > 0 ? (
            <Button size="sm" variant="ghost" aria-label="Back" onClick={() => setManualStep(step - 1)}>
              <ChevronLeft className="size-4" />
            </Button>
          ) : (
            <AppLogo size="sm" />
          )}
          <div className="min-w-0 flex-1">
            <div className="text-xs text-muted">
              Step {step + 1} of {STEPS.length}
            </div>
            <div className="truncate text-sm font-semibold">{STEPS[step]!.title}</div>
          </div>
          <Button size="sm" variant="secondary" icon={<Bot className="size-4" />} onClick={() => setMode('pilot')}>
            <span className="hidden sm:inline">Continue with</span> AI Pilot
          </Button>
        </div>
        <ol className="mx-auto flex max-w-2xl gap-1 px-4 pb-3" aria-label="Progress">
          {STEPS.map((s, i) => (
            <li key={s.short} className="flex-1">
              <button
                onClick={() => setManualStep(i)}
                className={cn('block h-1.5 w-full rounded-full transition-colors', i <= step ? 'bg-accent' : 'bg-line')}
                aria-label={`Step ${i + 1}: ${s.title}`}
                aria-current={i === step ? 'step' : undefined}
              />
            </li>
          ))}
        </ol>
      </header>

      <main className="mx-auto max-w-2xl animate-rise px-4 py-6" key={step}>
        {step === 0 && <BasicsStep />}
        {step === 1 && <SubjectsStep />}
        {step === 2 && <ScheduleStep />}
        {step === 3 && <AttendanceStep />}
        {step === 4 && <RevisionStep />}
        {step === 5 && <NotificationsStep />}
        {step === 6 && <StudyStep />}

        <div className="mt-8 flex items-center justify-between gap-2">
          <Button variant="ghost" onClick={() => void next()} disabled={finishing}>
            {last ? 'Skip & finish' : 'Skip'}
          </Button>
          <Button variant="primary" size="lg" loading={finishing} onClick={() => void next()}>
            {last ? 'Finish setup' : 'Continue'}
          </Button>
        </div>
      </main>
    </div>
  );
}

function StepIntro({ children }: { children: ReactNode }) {
  return <p className="mb-5 text-sm text-ink-2">{children}</p>;
}

function Panel({ children }: { children: ReactNode }) {
  return <div className="space-y-4 rounded-2xl border border-line bg-surface p-4 shadow-card sm:p-5">{children}</div>;
}

function BasicsStep() {
  const { draft, patch, patchProfile } = useSetup();
  return (
    <>
      <StepIntro>All optional. Semester dates help count how many classes you can still miss.</StepIntro>
      <Panel>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Name">
            <Input value={draft.profile.name} onChange={(e) => patchProfile({ name: e.target.value })} autoComplete="name" />
          </Field>
          <Field label="College / university">
            <Input value={draft.profile.college} onChange={(e) => patchProfile({ college: e.target.value })} />
          </Field>
          <Field label="Course">
            <Input value={draft.profile.course} onChange={(e) => patchProfile({ course: e.target.value })} placeholder="B.Tech CSE" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Semester">
              <Input value={draft.profile.semester} onChange={(e) => patchProfile({ semester: e.target.value })} placeholder="5" inputMode="numeric" />
            </Field>
            <Field label="Academic year">
              <Input value={draft.profile.academicYear} onChange={(e) => patchProfile({ academicYear: e.target.value })} placeholder="2026–27" />
            </Field>
          </div>
          <Field label="Semester starts" hint="Attendance counts from this date.">
            <Input type="date" value={draft.semesterStart ?? ''} onChange={(e) => patch({ semesterStart: e.target.value || null })} />
          </Field>
          <Field label="Semester ends">
            <Input type="date" value={draft.semesterEnd ?? ''} onChange={(e) => patch({ semesterEnd: e.target.value || null })} />
          </Field>
        </div>
      </Panel>
    </>
  );
}

function SubjectsStep() {
  const subjects = useAll('subject') ?? [];
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [faculty, setFaculty] = useState('');

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await create('subject', { name: name.trim(), code: code.trim() || null, faculty: faculty.trim() || null, color: await nextSubjectColor() });
    setName('');
    setCode('');
    setFaculty('');
  }

  return (
    <>
      <StepIntro>Add the subjects you study this semester. Importing a timetable in the next step also creates them for you.</StepIntro>
      <Panel>
        <form onSubmit={add} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_7rem_1fr_auto]">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Subject name" aria-label="Subject name" />
          <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Code" aria-label="Code" />
          <Input value={faculty} onChange={(e) => setFaculty(e.target.value)} placeholder="Faculty (optional)" aria-label="Faculty" />
          <Button type="submit" variant="primary" disabled={!name.trim()} icon={<Plus className="size-4" />}>
            Add
          </Button>
        </form>
        {subjects.length === 0 ? (
          <p className="text-sm text-muted">No subjects yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {subjects.map((s) => (
              <li key={s.id} className="flex items-center gap-3 py-2.5">
                <SubjectDot color={s.color} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{s.name}</div>
                  {(s.code || s.faculty) && <div className="truncate text-xs text-muted">{[s.code, s.faculty].filter(Boolean).join(' · ')}</div>}
                </div>
                <Button size="sm" variant="ghost" aria-label={`Remove ${s.name}`} onClick={() => void remove('subject', s.id)}>
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}

function ScheduleStep() {
  const schedules = (useAll('classSchedule') ?? []).filter((s) => s.active && (!s.validUntil || s.validUntil >= todayISO()));
  const subjects = useSubjectMap();
  const [dialog, setDialog] = useState<'import' | 'add' | null>(null);
  const days = [1, 2, 3, 4, 5, 6, 0].filter((d) => schedules.some((s) => s.weekday === d));

  return (
    <>
      <StepIntro>Upload your timetable (PDF, image, screenshot, Excel or CSV) and review it, or add classes one by one.</StepIntro>
      {schedules.length === 0 ? (
        <Panel>
          <TimetableImport mode="onboarding" onDone={() => undefined} />
        </Panel>
      ) : (
        <Panel>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-2 text-sm font-medium">
              <Check className="size-4" style={{ color: 'var(--color-good)' }} /> {schedules.length} weekly classes saved
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" icon={<Plus className="size-4" />} onClick={() => setDialog('add')}>
                Add class
              </Button>
              <Button size="sm" variant="secondary" icon={<Upload className="size-4" />} onClick={() => setDialog('import')}>
                Replace
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {days.map((d) => (
              <div key={d} className="rounded-xl bg-surface-2 p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted">{WEEKDAY_SHORT[d]}</div>
                <ul className="mt-1 space-y-1 text-sm">
                  {schedules
                    .filter((s) => s.weekday === d)
                    .sort((a, b) => a.startTime.localeCompare(b.startTime))
                    .map((s) => (
                      <li key={s.id} className="flex items-center gap-2">
                        <span className="w-11 shrink-0 tabular text-ink-2">{s.startTime}</span>
                        <SubjectDot color={subjects.get(s.subjectId)?.color ?? '#888'} />
                        <span className="truncate">{subjects.get(s.subjectId)?.name ?? 'Class'}</span>
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </div>
        </Panel>
      )}
      <Modal open={dialog !== null} onClose={() => setDialog(null)} title={dialog === 'add' ? 'Add a class' : 'Replace timetable'} wide={dialog === 'import'}>
        {dialog === 'add' && <ScheduleForm onDone={() => setDialog(null)} />}
        {dialog === 'import' && <TimetableImport mode="replace" onDone={() => setDialog(null)} />}
      </Modal>
    </>
  );
}

function PercentField({ label, value, onChange, hint }: { label: string; value: number; onChange: (n: number) => void; hint?: string }) {
  return (
    <Field label={label} hint={hint}>
      <div className="relative">
        <Input type="number" min={1} max={100} value={value} onChange={(e) => onChange(Math.max(0, Math.min(100, Number(e.target.value) || 0)))} className="pr-8" />
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted">%</span>
      </div>
    </Field>
  );
}

function AttendanceStep() {
  const { draft, patch } = useSetup();
  return (
    <>
      <StepIntro>Your college's minimum, and the level you personally want to stay above. You can override both per subject later.</StepIntro>
      <Panel>
        <Field label="Common minimums" group>
          <div className="flex flex-wrap gap-2">
            {[65, 70, 75, 80, 85].map((n) => (
              <Chip key={n} selected={draft.minAttendance === n} onClick={() => patch({ minAttendance: n, targetAttendance: Math.max(draft.targetAttendance, n) })}>
                {n}%
              </Chip>
            ))}
          </div>
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <PercentField label="Minimum required" value={draft.minAttendance} onChange={(n) => patch({ minAttendance: n })} />
          <PercentField label="Personal target" value={draft.targetAttendance} onChange={(n) => patch({ targetAttendance: n })} />
          <PercentField label="Comfortably safe" value={draft.safeAttendance} onChange={(n) => patch({ safeAttendance: n })} />
        </div>
        {draft.targetAttendance < draft.minAttendance && <p className="text-xs text-warning-ink">Your target is below the minimum; it will be raised to {draft.minAttendance}%.</p>}
      </Panel>
    </>
  );
}

function RevisionStep() {
  const { draft, patch } = useSetup();
  const isRecommended = draft.revisionIntervals.join() === RECOMMENDED.join();
  const [text, setText] = useState(draft.revisionIntervals.join(', '));
  const preview = initialRevisions(todayISO(), draft.revisionIntervals);
  return (
    <>
      <StepIntro>When you log a topic you learned, revisions are scheduled on these days after learning. They adapt to how well you remember.</StepIntro>
      <Panel>
        <div className="flex flex-wrap gap-2">
          <Chip
            selected={isRecommended}
            onClick={() => {
              patch({ revisionIntervals: RECOMMENDED });
              setText(RECOMMENDED.join(', '));
            }}
          >
            Recommended · 1, 3, 7, 30, 90, 180
          </Chip>
        </div>
        <Field label="Custom days after learning" hint="Comma-separated, e.g. 1, 3, 7, 14, 30">
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => {
              const nums = text
                .split(/[,\s]+/)
                .map(Number)
                .filter((n) => Number.isInteger(n) && n > 0 && n <= 3650);
              if (nums.length) patch({ revisionIntervals: [...new Set(nums)].sort((a, b) => a - b).slice(0, 20) });
            }}
          />
        </Field>
        <p className="text-xs text-muted">Learn something today → revise on {preview.map((p) => p.dueDate.slice(5)).join(', ')}</p>
      </Panel>
    </>
  );
}

function NotificationsStep() {
  const { draft, patch, patchClassReminder } = useSetup();
  const [permission, setPermission] = useState<string | null>(null);
  const c = draft.notifications.categories;
  const lead = c.classes.enabled ? (c.classes.offsets[0] ?? 0) : 0;
  const toggle = (k: 'revision' | 'tasks' | 'assignments' | 'exams', enabled: boolean) =>
    patch({ notifications: { ...draft.notifications, categories: { ...c, [k]: { ...c[k], enabled } } } as Settings['notifications'] });

  return (
    <>
      <StepIntro>Reminders work offline while the app is open, and as push notifications when it's closed.</StepIntro>
      <Panel>
        <Field label="Remind me before class" group>
          <div className="flex flex-wrap gap-2">
            {[0, 5, 10, 15, 30].map((m) => (
              <Chip key={m} selected={lead === m} onClick={() => patchClassReminder(m)}>
                {m === 0 ? 'Off' : `${m} min`}
              </Chip>
            ))}
          </div>
        </Field>
        <div className="divide-y divide-line">
          <Toggle checked={c.revision.enabled} onChange={(v) => toggle('revision', v)} label="Revisions due" />
          <Toggle checked={c.tasks.enabled} onChange={(v) => toggle('tasks', v)} label="Task deadlines" />
          <Toggle checked={c.assignments.enabled} onChange={(v) => toggle('assignments', v)} label="Assignment deadlines" description="7 days, 3 days, 1 day and 1 hour before" />
          <Toggle checked={c.exams.enabled} onChange={(v) => toggle('exams', v)} label="Exams" description="30, 14, 7 and 1 day before" />
        </div>
        {notificationsSupported() && (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="secondary"
              icon={<Bell className="size-4" />}
              onClick={async () => {
                const r = await requestNotificationPermission();
                setPermission(r === 'granted' ? 'Notifications are allowed.' : r === 'denied' ? 'Blocked in browser settings. Reminders still show in the app.' : 'Not allowed yet.');
              }}
            >
              Allow notifications
            </Button>
            {permission && <span className="text-sm text-ink-2">{permission}</span>}
          </div>
        )}
      </Panel>
    </>
  );
}

function StudyStep() {
  const { draft, patch } = useSetup();
  const times = draft.studyTimes;
  return (
    <>
      <StepIntro>Used when planning your day. These are preferences, not strict rules.</StepIntro>
      <Panel>
        <Field label="When do you like to study?" hint="Pick any." group>
          <div className="flex flex-wrap gap-2">
            {STUDY_TIMES.map((t) => (
              <Chip key={t} selected={times.includes(t)} onClick={() => patch({ studyTimes: times.includes(t) ? times.filter((x) => x !== t) : STUDY_TIMES.filter((x) => x === t || times.includes(x)) })}>
                {t[0]!.toUpperCase() + t.slice(1)}
              </Chip>
            ))}
          </div>
        </Field>
        <Field label="Daily study target" hint={`Currently ${formatMinutes(draft.dailyStudyTargetMinutes)} of self-study per day.`} group>
          <div className="flex flex-wrap gap-2">
            {[60, 120, 180, 240, 300, 360].map((m) => (
              <Chip key={m} selected={draft.dailyStudyTargetMinutes === m} onClick={() => patch({ dailyStudyTargetMinutes: m })}>
                {m / 60} h
              </Chip>
            ))}
          </div>
        </Field>
      </Panel>
    </>
  );
}

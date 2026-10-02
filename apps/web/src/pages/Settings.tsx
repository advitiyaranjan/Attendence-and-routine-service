import { useEffect, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Download, LogOut, RefreshCw } from 'lucide-react';
import { ENTITY_NAMES, initialRevisions, todayISO, WEEKDAY_SHORT, type Settings as SettingsT } from '@student-os/core';
import { AuthForm } from '../components/AuthForm';
import { ServerAddress } from '../components/ServerAddress';
import { isNative } from '../lib/platform';
import { SyncBadge } from '../components/Layout';
import { Button, Card, Chip, cn, Field, Input, PageHeader, Select, Toggle } from '../components/ui';
import { STUDY_TIMES } from '../lib/setup-parse';
import { logout } from '../lib/auth';
import { db, kvGet } from '../lib/db';
import { useSettings } from '../lib/hooks';
import { AIPermissionSettings } from '../components/settings/AIPermissionSettings';
import { NotificationSettings } from '../components/settings/NotificationSettings';
import { saveSettings } from '../lib/repo';
import { toast, useApp } from '../lib/store';
import { syncNow } from '../lib/sync';
import { ACCENT_NAMES, accentSwatch } from '../lib/theme';

function Section({ id, title, description, children }: { id?: string; title: string; description?: string; children: ReactNode }) {
  return (
    <Card id={id} className="scroll-mt-16 space-y-3">
      <div>
        <h2 className="font-semibold">{title}</h2>
        {description && <p className="text-sm text-ink-2">{description}</p>}
      </div>
      {children}
    </Card>
  );
}

export default function Settings() {
  const s = useSettings();
  const { user, sync } = useApp();
  const [holiday, setHoliday] = useState('');
  const failed = useLiveQuery(() => kvGet<Array<{ entity: string; id: string; error: string }>>('sync.failed'), []) ?? [];
  const save = (patch: Partial<SettingsT>) => void saveSettings(patch);
  useEffect(() => {
    const id = location.hash.slice(1);
    if (id) document.getElementById(id)?.scrollIntoView();
  }, []);
  const num = (v: string, fallback: number) => (Number.isFinite(Number(v)) && v !== '' ? Number(v) : fallback);

  async function exportData() {
    const data: Record<string, unknown> = { exportedAt: new Date().toISOString() };
    for (const e of ENTITY_NAMES) data[e] = await db.entity(e).toArray();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `student-os-${todayISO()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const account = (
      <Section id="account" title="Account & sync" description={user ? "Your data syncs across laptop, phone and tablet." : "Sign in to back up and sync across laptop, phone and tablet."}>
        {isNative && user && <ServerAddress />}
        {user ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm">
                Signed in as <strong>{user.email ?? user.name}</strong>
              </div>
              <SyncBadge />
            </div>
            {sync.error && <p className="text-sm text-ink-2">Last sync problem: {sync.error}. Retrying automatically.</p>}
            {sync.conflicts > 0 && (
              <p className="text-sm text-ink-2">
                {sync.conflicts} edit conflict(s) were resolved by keeping the most recent change. Older versions are preserved on the server.
              </p>
            )}
            {failed.length > 0 && (
              <details className="text-sm">
                <summary className="cursor-pointer text-critical-ink">{failed.length} change(s) couldn't be synced</summary>
                <ul className="mt-1 list-disc pl-5 text-xs text-ink-2">
                  {failed.slice(-10).map((f, i) => (
                    <li key={i}>
                      {f.entity}: {f.error}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" icon={<RefreshCw className="size-4" />} onClick={() => void syncNow()}>
                Sync now
              </Button>
              <Button size="sm" variant="secondary" icon={<LogOut className="size-4" />} onClick={() => void logout(false)}>
                Sign out (keep data here)
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={() => {
                  if (sync.pending && !confirm(`${sync.pending} change(s) haven't synced yet and will be lost. Continue?`)) return;
                  if (confirm('Sign out and remove all Student OS data from this device?')) void logout(true);
                }}
              >
                Sign out & erase this device
              </Button>
            </div>
          </div>
        ) : (
          <div className="max-w-sm">
            <AuthForm onSuccess={() => undefined} />
          </div>
        )}
      </Section>
  );

  return (
    <div className="space-y-4">
      <PageHeader title="Settings" />
      <nav className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:px-0" aria-label="Settings sections">
        {[
          ['profile', 'Profile'],
          ['academic', 'Academic'],
          ['notifications', 'Notifications'],
          ['attendance', 'Attendance'],
          ['study', 'Revision & study'],
          ['ai', 'AI'],
          ['appearance', 'Appearance'],
          ['data', 'Privacy & data'],
          ['account', 'Account & sync'],
        ].map(([id, label]) => (
          <a key={id} href={`#${id}`} className="shrink-0 whitespace-nowrap rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink-2 hover:text-ink">
            {label}
          </a>
        ))}
      </nav>

      {!user && account}

      <Section id="profile" title="Profile">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {(['name', 'college', 'course', 'semester', 'academicYear'] as const).map((k) => (
            <Field key={k} label={{ name: 'Name', college: 'College', course: 'Course', semester: 'Semester', academicYear: 'Academic year' }[k]}>
              <Input defaultValue={s.profile[k]} onBlur={(e) => e.target.value !== s.profile[k] && save({ profile: { ...s.profile, [k]: e.target.value } })} />
            </Field>
          ))}
        </div>
      </Section>

      <Section id="academic" title="Academic information">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Semester starts" hint="Attendance counts from this date">
            <Input type="date" value={s.semesterStart ?? ''} onChange={(e) => save({ semesterStart: e.target.value || null })} />
          </Field>
          <Field label="Semester ends" hint="Used to count remaining classes">
            <Input type="date" value={s.semesterEnd ?? ''} onChange={(e) => save({ semesterEnd: e.target.value || null })} />
          </Field>
          <Field label="College starts">
            <Input type="time" value={s.collegeStart} onChange={(e) => e.target.value && save({ collegeStart: e.target.value })} />
          </Field>
          <Field label="College ends">
            <Input type="time" value={s.collegeEnd} onChange={(e) => e.target.value && save({ collegeEnd: e.target.value })} />
          </Field>
          <Field label="Week starts on">
            <Select value={s.weekStartsOn} onChange={(e) => save({ weekStartsOn: Number(e.target.value) as 0 | 1 })}>
              <option value={1}>Monday</option>
              <option value={0}>Sunday</option>
            </Select>
          </Field>
        </div>
        <Field label="Working days" group>
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAY_SHORT.map((d, i) => {
              const on = s.workingDays.includes(i);
              return (
                <button
                  key={d}
                  aria-pressed={on}
                  onClick={() => save({ workingDays: on ? s.workingDays.filter((x) => x !== i) : [...s.workingDays, i].sort() })}
                  className={cn('rounded-lg border px-3 py-1.5 text-sm', on ? 'border-accent bg-accent-soft font-medium' : 'border-line text-ink-2')}
                >
                  {d}
                </button>
              );
            })}
          </div>
        </Field>
        <Field label="Holidays" hint="No classes are generated on these dates." group>
          <div className="flex gap-2">
            <Input type="date" value={holiday} onChange={(e) => setHoliday(e.target.value)} className="w-44" />
            <Button
              variant="secondary"
              disabled={!holiday}
              onClick={() => {
                save({ holidays: [...new Set([...s.holidays, holiday])].sort() });
                setHoliday('');
              }}
            >
              Add
            </Button>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {s.holidays.map((h) => (
              <button key={h} onClick={() => save({ holidays: s.holidays.filter((x) => x !== h) })} className="rounded-md bg-surface-2 px-2 py-0.5 text-xs" aria-label={`Remove holiday ${h}`}>
                {h} ✕
              </button>
            ))}
          </div>
        </Field>
      </Section>

      <Section id="attendance" title="Attendance" description="Defaults for every subject; override per subject on the Subjects page.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Minimum %">
            <Input type="number" min={0} max={100} defaultValue={s.minAttendance} onBlur={(e) => save({ minAttendance: num(e.target.value, s.minAttendance) })} />
          </Field>
          <Field label="Target %">
            <Input type="number" min={0} max={100} defaultValue={s.targetAttendance} onBlur={(e) => save({ targetAttendance: num(e.target.value, s.targetAttendance) })} />
          </Field>
          <Field label="Safe %">
            <Input type="number" min={0} max={100} defaultValue={s.safeAttendance} onBlur={(e) => save({ safeAttendance: num(e.target.value, s.safeAttendance) })} />
          </Field>
        </div>
      </Section>

      <Section id="study" title="Revision & study">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Daily study target (minutes)">
            <Input type="number" min={0} step={15} defaultValue={s.dailyStudyTargetMinutes} onBlur={(e) => save({ dailyStudyTargetMinutes: num(e.target.value, s.dailyStudyTargetMinutes) })} />
          </Field>
          <Field label="Revision days after learning" hint={`Today → ${initialRevisions(todayISO(), s.revisionIntervals).map((r) => r.dueDate.slice(5)).join(', ')}`}>
            <Input
              defaultValue={s.revisionIntervals.join(', ')}
              onBlur={(e) => {
                const nums = e.target.value
                  .split(/[,\s]+/)
                  .map(Number)
                  .filter((n) => Number.isInteger(n) && n > 0);
                if (nums.length) save({ revisionIntervals: [...new Set(nums)].sort((a, b) => a - b) });
              }}
            />
          </Field>
        </div>
        <p className="text-xs text-muted">Changes apply to topics you log from now on.</p>
        <Field label="Preferred study times" hint="AI Pilot uses these when planning your day." group>
          <div className="flex flex-wrap gap-2">
            {STUDY_TIMES.map((t) => (
              <Chip key={t} selected={s.studyTimes.includes(t)} onClick={() => save({ studyTimes: s.studyTimes.includes(t) ? s.studyTimes.filter((x) => x !== t) : STUDY_TIMES.filter((x) => x === t || s.studyTimes.includes(x)) })}>
                {t[0]!.toUpperCase() + t.slice(1)}
              </Chip>
            ))}
          </div>
        </Field>
      </Section>

      <Section id="notifications" title="Notifications" description="Choose what to be reminded about and when. Reminders work offline while the app is open; with push on, they also arrive when it's closed.">
        <NotificationSettings s={s} />
      </Section>

      <Section id="appearance" title="Appearance">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Theme">
            <Select value={s.theme} onChange={(e) => save({ theme: e.target.value as SettingsT['theme'] })}>
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </Select>
          </Field>
          <Field label="Accent colour" group>
            <div className="flex gap-2 pt-1">
              {ACCENT_NAMES.map((a) => (
                <button
                  key={a}
                  onClick={() => save({ accent: a })}
                  aria-label={`${a} accent`}
                  aria-pressed={s.accent === a}
                  className="size-7 rounded-full ring-offset-2 ring-offset-surface aria-pressed:ring-2 aria-pressed:ring-ink"
                  style={{ background: accentSwatch(a) }}
                />
              ))}
            </div>
          </Field>
        </div>
      </Section>

      <Section id="ai" title="AI Pilot & permissions" description="Gemini is reached only through our server. Control what AI Pilot can see and propose.">
        <AIPermissionSettings s={s} />
      </Section>

      <Section id="data" title="Privacy & data" description="Your data is stored on this device and, when signed in, in your account. Export it anytime.">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" icon={<Download className="size-4" />} onClick={() => void exportData().then(() => toast('Export downloaded', 'success'))}>
            Export all data (JSON)
          </Button>
          {!user && (
            <Button
              size="sm"
              variant="danger"
              onClick={async () => {
                if (!confirm('Delete all Student OS data on this device? This cannot be undone.')) return;
                await db.delete();
                location.reload();
              }}
            >
              Erase local data
            </Button>
          )}
        </div>
      </Section>
      {user && account}
    </div>
  );
}

/** Individual settings screens. Each is self-contained and saves as you change it. */
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowDown, ArrowUp, Download, LogOut, RefreshCw, Trash2 } from 'lucide-react';
import { APP_PAGES, ENTITY_NAMES, HOME_SECTIONS, initialRevisions, todayISO, type AppPage, type HomeSection, type Settings } from '@student-os/core';
import { AuthForm } from '../AuthForm';
import { SyncBadge } from '../Layout';
import { ServerAddress } from '../ServerAddress';
import { Button, Chip, cn, Input, Select, Toggle } from '../ui';
import { HOME_SECTION_LABEL, PAGE_LABEL, UNHIDEABLE_PAGES } from '../../lib/app-prefs';
import { logout } from '../../lib/auth';
import { db, kvGet } from '../../lib/db';
import { isNative } from '../../lib/platform';
import { useAll } from '../../lib/hooks';
import { saveSettings, sortBaskets, update } from '../../lib/repo';
import { STUDY_TIMES } from '../../lib/setup-parse';
import { toast, useApp } from '../../lib/store';
import { syncNow } from '../../lib/sync';
import { ACCENT_NAMES, accentSwatch } from '../../lib/theme';
import { AIPermissionSettings } from './AIPermissionSettings';
import { ChangeEmailButton } from './ChangeEmail';
import { NotificationSettings } from './NotificationSettings';
import { NumberField, Segmented, SettingBlock, SettingRow, SettingsGroup } from './SettingsUI';

const save = (patch: Partial<Settings>) => void saveSettings(patch);

/** Text field that saves on blur. */
function TextRow({ label, value, onSave, placeholder }: { label: string; value: string; onSave: (v: string) => void; placeholder?: string }) {
  return (
    <SettingRow label={label}>
      <input
        aria-label={label}
        defaultValue={value}
        key={value}
        placeholder={placeholder}
        onBlur={(e) => e.target.value.trim() !== value && onSave(e.target.value.trim())}
        className="h-9 w-48 rounded-lg border border-transparent bg-transparent px-2 text-right text-sm text-ink placeholder:text-muted hover:border-line focus:border-accent focus:bg-surface-2 focus:outline-none sm:w-64"
      />
    </SettingRow>
  );
}

export function AccountSection() {
  const { user, sync } = useApp();
  const failed = useLiveQuery(() => kvGet<Array<{ entity: string; id: string; error: string }>>('sync.failed'), []) ?? [];
  if (!user) {
    return (
      <SettingsGroup title="Sign in" footer="Your data on this device is kept and uploaded to your account when you sign in.">
        <SettingBlock>
          <div className="max-w-sm py-2">
            <AuthForm onSuccess={() => undefined} />
          </div>
        </SettingBlock>
      </SettingsGroup>
    );
  }
  return (
    <div className="space-y-6">
      <SettingsGroup title="Account">
        <SettingRow label="Signed in as" description={user.email ?? user.name}>
          <ChangeEmailButton current={user.email} />
        </SettingRow>
        <SettingRow label="Sync" description={sync.error ? `Last problem: ${sync.error}. Retrying automatically.` : 'Changes sync across your devices automatically.'}>
          <div className="flex items-center gap-2">
            <SyncBadge />
            <Button size="sm" variant="secondary" icon={<RefreshCw className="size-4" />} onClick={() => void syncNow()}>
              Sync now
            </Button>
          </div>
        </SettingRow>
        {sync.conflicts > 0 && <SettingRow label="Edit conflicts resolved" description="The most recent change was kept; older versions are preserved on the server.">{sync.conflicts}</SettingRow>}
        {failed.length > 0 && (
          <SettingRow label={`${failed.length} change(s) couldn't sync`} description={failed.slice(-3).map((f) => `${f.entity}: ${f.error}`).join(' · ')} />
        )}
      </SettingsGroup>
      {isNative && (
        <SettingsGroup title="Server">
          <SettingBlock>
            <div className="py-2">
              <ServerAddress />
            </div>
          </SettingBlock>
        </SettingsGroup>
      )}
      <SettingsGroup title="Sign out">
        <SettingRow label="Sign out" description="Your data stays on this device.">
          <Button size="sm" variant="secondary" icon={<LogOut className="size-4" />} onClick={() => void logout(false)}>
            Sign out
          </Button>
        </SettingRow>
        <SettingRow label="Sign out and erase this device" description="Removes all Student OS data stored here. Your account keeps its copy.">
          <Button
            size="sm"
            variant="danger"
            onClick={() => {
              if (sync.pending && !confirm(`${sync.pending} change(s) haven't synced yet and will be lost. Continue?`)) return;
              if (confirm('Sign out and remove all Student OS data from this device?')) void logout(true);
            }}
          >
            Erase
          </Button>
        </SettingRow>
      </SettingsGroup>
    </div>
  );
}

export function ProfileSection({ s }: { s: Settings }) {
  const p = s.profile;
  const set = (k: keyof Settings['profile']) => (v: string) => save({ profile: { ...p, [k]: v } });
  const timeInput = 'h-9 rounded-lg border border-line bg-surface-2 px-2 text-sm text-ink focus:border-accent focus:outline-none';
  return (
    <div className="space-y-6">
      <SettingsGroup title="About you">
      <TextRow label="Name" value={p.name} onSave={set('name')} placeholder="Your name" />
      <TextRow label="College" value={p.college} onSave={set('college')} placeholder="College or university" />
      <TextRow label="Course" value={p.course} onSave={set('course')} placeholder="e.g. B.Tech CSE" />
      <TextRow label="Semester" value={p.semester} onSave={set('semester')} placeholder="e.g. 5" />
      <TextRow label="Academic year" value={p.academicYear} onSave={set('academicYear')} placeholder="e.g. 2026–27" />
      </SettingsGroup>
      <SettingsGroup title="Bio" footer="A line or two about you. AI Pilot can use it to personalise plans when allowed.">
        <SettingBlock>
          <textarea
            defaultValue={p.bio}
            key={p.bio}
            maxLength={500}
            rows={3}
            placeholder="e.g. Final-year CSE student preparing for placements"
            aria-label="Bio"
            onBlur={(e) => e.target.value !== p.bio && save({ profile: { ...p, bio: e.target.value } })}
            className="w-full resize-y rounded-xl border border-line bg-surface-2 px-3 py-2 text-base text-ink placeholder:text-muted focus:border-accent focus:outline-none sm:text-sm"
          />
        </SettingBlock>
      </SettingsGroup>
      <SettingsGroup title="Study hours" footer="When you usually study. Revision and reminders are planned inside this window.">
        <SettingBlock>
          <Toggle checked={!!s.studyWindow} onChange={(v) => save({ studyWindow: v ? { start: '18:00', end: '21:00' } : null })} label="Set study hours" />
        </SettingBlock>
        {s.studyWindow && (
          <>
            <SettingRow label="From">
              <input type="time" aria-label="Study from" className={timeInput} value={s.studyWindow.start} onChange={(e) => e.target.value && save({ studyWindow: { ...s.studyWindow!, start: e.target.value } })} />
            </SettingRow>
            <SettingRow label="Until">
              <input type="time" aria-label="Study until" className={timeInput} value={s.studyWindow.end} onChange={(e) => e.target.value && save({ studyWindow: { ...s.studyWindow!, end: e.target.value } })} />
            </SettingRow>
          </>
        )}
      </SettingsGroup>
    </div>
  );
}

export function AcademicSection({ s }: { s: Settings }) {
  const [holiday, setHoliday] = useState('');
  const [scope, setScope] = useState('all');
  const baskets = sortBaskets(useAll('basket') ?? []);
  const dateInput = 'h-9 rounded-lg border border-line bg-surface-2 px-2 text-sm text-ink focus:border-accent focus:outline-none';
  const holidays = [
    ...s.holidays.map((date) => ({ date, basket: null })),
    ...baskets.flatMap((b) => b.holidays.map((date) => ({ date, basket: b }))),
  ].sort((a, b) => a.date.localeCompare(b.date));
  function addHoliday() {
    const basket = baskets.find((b) => b.id === scope);
    if (basket) void update('basket', basket.id, { holidays: [...new Set([...basket.holidays, holiday])].sort() });
    else save({ holidays: [...new Set([...s.holidays, holiday])].sort() });
    setHoliday('');
  }
  return (
    <div className="space-y-6">
      <SettingsGroup title="Semester" footer="Applies to every basket unless a basket sets its own term. Attendance is counted from the start date; the end date lets us count classes remaining.">
        <SettingRow label="Starts">
          <input type="date" aria-label="Semester starts" className={dateInput} value={s.semesterStart ?? ''} onChange={(e) => save({ semesterStart: e.target.value || null })} />
        </SettingRow>
        <SettingRow label="Ends">
          <input type="date" aria-label="Semester ends" className={dateInput} value={s.semesterEnd ?? ''} onChange={(e) => save({ semesterEnd: e.target.value || null })} />
        </SettingRow>
      </SettingsGroup>
      <SettingsGroup title="College hours">
        <SettingRow label="Starts">
          <input type="time" aria-label="College starts" className={dateInput} value={s.collegeStart} onChange={(e) => e.target.value && save({ collegeStart: e.target.value })} />
        </SettingRow>
        <SettingRow label="Ends">
          <input type="time" aria-label="College ends" className={dateInput} value={s.collegeEnd} onChange={(e) => e.target.value && save({ collegeEnd: e.target.value })} />
        </SettingRow>
      </SettingsGroup>
      <SettingsGroup title="Week">
        <SettingRow label="Week starts on">
          <Segmented label="Week starts on" value={s.weekStartsOn} onChange={(v) => save({ weekStartsOn: v })} options={[{ value: 1, label: 'Monday' }, { value: 0, label: 'Sunday' }]} />
        </SettingRow>
      </SettingsGroup>
      <SettingsGroup title="Holidays" footer="No classes are generated on these dates — for every basket, or just the one you pick (e.g. a coaching break while college runs).">
        <SettingRow label="Add a holiday" stacked>
          <div className="flex flex-wrap gap-2">
            <input type="date" aria-label="Holiday date" className={dateInput} value={holiday} onChange={(e) => setHoliday(e.target.value)} />
            {baskets.length > 0 && (
              <Select aria-label="Holiday applies to" value={scope} onChange={(e) => setScope(e.target.value)} className="h-9 w-auto">
                <option value="all">Every basket</option>
                {baskets.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.icon} {b.name} only
                  </option>
                ))}
              </Select>
            )}
            <Button size="sm" variant="secondary" disabled={!holiday} onClick={addHoliday}>
              Add
            </Button>
          </div>
        </SettingRow>
        {holidays.map(({ date, basket }) => (
          <SettingRow
            key={`${basket?.id ?? 'all'}:${date}`}
            label={new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
            description={basket ? `${basket.icon} ${basket.name} only` : baskets.length ? 'Every basket' : undefined}
          >
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Remove holiday ${date}${basket ? ` for ${basket.name}` : ''}`}
              onClick={() => (basket ? void update('basket', basket.id, { holidays: basket.holidays.filter((x) => x !== date) }) : save({ holidays: s.holidays.filter((x) => x !== date) }))}
            >
              <Trash2 className="size-4" />
            </Button>
          </SettingRow>
        ))}
      </SettingsGroup>
    </div>
  );
}

export function AttendanceSection({ s }: { s: Settings }) {
  return (
    <SettingsGroup title="Attendance rules" footer="Defaults for every basket and subject. A basket (Settings → Baskets) or a single subject can set its own.">
      <SettingRow label="Minimum required" description="Below this you're flagged “below minimum”.">
        <NumberField label="Minimum attendance" value={s.minAttendance} min={0} max={100} unit="%" onCommit={(v) => save({ minAttendance: v })} />
      </SettingRow>
      <SettingRow label="Your target" description="What you aim for.">
        <NumberField label="Target attendance" value={s.targetAttendance} min={0} max={100} unit="%" onCommit={(v) => save({ targetAttendance: v })} />
      </SettingRow>
      <SettingRow label="Comfortably safe" description="Above this you're marked “safe”.">
        <NumberField label="Safe attendance" value={s.safeAttendance} min={0} max={100} unit="%" onCommit={(v) => save({ safeAttendance: v })} />
      </SettingRow>
    </SettingsGroup>
  );
}

export function StudySection({ s }: { s: Settings }) {
  const preview = initialRevisions(todayISO(), s.revisionIntervals)
    .map((r) => new Date(`${r.dueDate}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }))
    .join(' · ');
  const timeInput = 'h-9 rounded-lg border border-line bg-surface-2 px-2 text-sm text-ink focus:border-accent focus:outline-none';
  return (
    <div className="space-y-6">
      <SettingsGroup title="Sleep time" footer="Nothing is scheduled while you sleep: AI Pilot, automatic catch-up sessions and the calendar all avoid this time.">
        <SettingRow label="Bedtime">
          <input type="time" aria-label="Bedtime" className={timeInput} value={s.sleepWindow.start} onChange={(e) => e.target.value && save({ sleepWindow: { ...s.sleepWindow, start: e.target.value } })} />
        </SettingRow>
        <SettingRow label="Wake up">
          <input type="time" aria-label="Wake up" className={timeInput} value={s.sleepWindow.end} onChange={(e) => e.target.value && save({ sleepWindow: { ...s.sleepWindow, end: e.target.value } })} />
        </SettingRow>
      </SettingsGroup>
      <SettingsGroup title="Study">
        <SettingRow label="Daily study target" description="Self-study time you aim for each day.">
          <NumberField label="Daily study target in minutes" value={s.dailyStudyTargetMinutes} min={0} max={1440} step={15} unit="min" onCommit={(v) => save({ dailyStudyTargetMinutes: v })} />
        </SettingRow>
        <SettingRow label="Preferred study times" description="AI Pilot plans sessions in these parts of the day." stacked>
          <div className="flex flex-wrap gap-2">
            {STUDY_TIMES.map((t) => (
              <Chip key={t} selected={s.studyTimes.includes(t)} onClick={() => save({ studyTimes: s.studyTimes.includes(t) ? s.studyTimes.filter((x) => x !== t) : STUDY_TIMES.filter((x) => x === t || s.studyTimes.includes(x)) })}>
                {t[0]!.toUpperCase() + t.slice(1)}
              </Chip>
            ))}
          </div>
        </SettingRow>
      </SettingsGroup>
      <SettingsGroup title="Spaced revision" footer={`Learn something today → revise on ${preview}. Changes apply to topics you log from now on.`}>
        <SettingRow label="Revise after (days)" description="Comma-separated, e.g. 1, 3, 7, 30, 90, 180">
          <Input
            aria-label="Revision days after learning"
            className="h-9 w-48"
            defaultValue={s.revisionIntervals.join(', ')}
            key={s.revisionIntervals.join(',')}
            onBlur={(e) => {
              const nums = e.target.value.split(/[,\s]+/).map(Number).filter((n) => Number.isInteger(n) && n > 0);
              if (nums.length) save({ revisionIntervals: [...new Set(nums)].sort((a, b) => a - b) });
            }}
          />
        </SettingRow>
      </SettingsGroup>
    </div>
  );
}

export function NotificationsSection({ s }: { s: Settings }) {
  return (
    <SettingsGroup>
      <SettingBlock>
        <div className="py-2">
          <NotificationSettings s={s} />
        </div>
      </SettingBlock>
    </SettingsGroup>
  );
}

export function AppearanceSection({ s }: { s: Settings }) {
  return (
    <>
    <SettingsGroup title="Look and feel">
      <SettingRow label="Theme">
        <Segmented label="Theme" value={s.theme} onChange={(v) => save({ theme: v })} options={[{ value: 'system', label: 'Auto' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />
      </SettingRow>
      <SettingRow label="Accent colour" stacked>
        <div role="group" aria-label="Accent colour" className="flex flex-wrap gap-3">
          {ACCENT_NAMES.map((a) => (
            <button
              key={a}
              onClick={() => save({ accent: a })}
              aria-label={`${a} accent`}
              aria-pressed={s.accent === a}
              className="size-9 rounded-full ring-offset-2 ring-offset-surface transition-transform hover:scale-110 aria-pressed:ring-2 aria-pressed:ring-ink"
              style={{ background: accentSwatch(a) }}
            />
          ))}
        </div>
      </SettingRow>
    </SettingsGroup>
    <AppLayoutSettings s={s} />
    </>
  );
}

/** Home cards, the "Up next" card, start page and menu. AI Pilot can change all of these too. */
function AppLayoutSettings({ s }: { s: Settings }) {
  const app = s.app;
  const saveApp = (patch: Partial<Settings['app']>) => save({ app: { ...app, ...patch } });
  const cards = [...app.homeSections, ...HOME_SECTIONS.filter((k) => !app.homeSections.includes(k))];
  const move = (k: HomeSection, step: -1 | 1) => {
    const list = [...app.homeSections];
    const i = list.indexOf(k);
    const j = i + step;
    if (i === -1 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j]!, list[i]!];
    saveApp({ homeSections: list });
  };
  return (
    <>
      <SettingsGroup title="Home screen" footer="Tip: you can also ask AI Pilot, e.g. “hide the This week card” or “put attendance first”.">
        {cards.map((k) => {
          const on = app.homeSections.includes(k);
          const i = app.homeSections.indexOf(k);
          return (
            <div key={k} className="flex items-center gap-1 px-4">
              <div className={cn('min-w-0 flex-1', !on && 'text-muted')}>
                <Toggle checked={on} onChange={(v) => saveApp({ homeSections: v ? [...app.homeSections, k] : app.homeSections.filter((x) => x !== k) })} label={HOME_SECTION_LABEL[k]} />
              </div>
              <button onClick={() => move(k, -1)} disabled={!on || i === 0} aria-label={`Move ${HOME_SECTION_LABEL[k]} up`} className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-30">
                <ArrowUp className="size-4" />
              </button>
              <button onClick={() => move(k, 1)} disabled={!on || i === app.homeSections.length - 1} aria-label={`Move ${HOME_SECTION_LABEL[k]} down`} className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-30">
                <ArrowDown className="size-4" />
              </button>
            </div>
          );
        })}
      </SettingsGroup>
      <SettingsGroup title="Up next card" footer="Classes always show. Swipe the card left or right to see what's next or what came before.">
        <SettingBlock>
          <Toggle checked={app.upNext.tasks} onChange={(v) => saveApp({ upNext: { ...app.upNext, tasks: v } })} label="Tasks due today" description="Tasks with a due time" />
          <Toggle checked={app.upNext.events} onChange={(v) => saveApp({ upNext: { ...app.upNext, events: v } })} label="Events and study sessions" />
          <Toggle checked={app.upNext.reminders} onChange={(v) => saveApp({ upNext: { ...app.upNext, reminders: v } })} label="Reminders" />
        </SettingBlock>
      </SettingsGroup>
      <SettingsGroup title="Navigation">
        <SettingRow label="Open the app on">
          <Select aria-label="Open the app on" value={app.startPage} onChange={(e) => saveApp({ startPage: e.target.value as AppPage })} className="h-9 w-auto">
            {APP_PAGES.map((p) => (
              <option key={p} value={p}>
                {PAGE_LABEL[p]}
              </option>
            ))}
          </Select>
        </SettingRow>
        <SettingBlock>
          {APP_PAGES.filter((p) => !UNHIDEABLE_PAGES.includes(p)).map((p) => (
            <Toggle
              key={p}
              checked={!app.hiddenPages.includes(p)}
              onChange={(v) => saveApp({ hiddenPages: v ? app.hiddenPages.filter((x) => x !== p) : [...app.hiddenPages, p] })}
              label={`Show ${PAGE_LABEL[p]} in the menu`}
            />
          ))}
        </SettingBlock>
      </SettingsGroup>
    </>
  );
}

export function AISection({ s }: { s: Settings }) {
  return <AIPermissionSettings s={s} />;
}

export function DataSection() {
  const user = useApp((x) => x.user);
  async function exportData() {
    const data: Record<string, unknown> = { exportedAt: new Date().toISOString() };
    for (const e of ENTITY_NAMES) data[e] = await db.entity(e).toArray();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `student-os-${todayISO()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('Export downloaded', 'success');
  }
  return (
    <SettingsGroup title="Your data" footer="Your data is stored on this device and, when signed in, in your account.">
      <SettingRow label="Export everything" description="Download all your data as a JSON file.">
        <Button size="sm" variant="secondary" icon={<Download className="size-4" />} onClick={() => void exportData()}>
          Export
        </Button>
      </SettingRow>
      {!user && (
        <SettingRow label="Erase local data" description="Deletes everything on this device. This can't be undone.">
          <Button
            size="sm"
            variant="danger"
            onClick={async () => {
              if (!confirm('Delete all Student OS data on this device? This cannot be undone.')) return;
              await db.delete();
              location.reload();
            }}
          >
            Erase
          </Button>
        </SettingRow>
      )}
    </SettingsGroup>
  );
}

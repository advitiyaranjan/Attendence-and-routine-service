/**
 * Settings: a menu of sections (with a live one-line summary each) and a
 * detail pane. Desktop shows both side by side (Gmail-style); mobile shows
 * the menu, then each section full-screen with a back button (Instagram-style).
 */
import { useEffect, type ComponentType } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router';
import { Bell, CalendarRange, ChevronLeft, ChevronRight, Database, GraduationCap, Palette, Repeat, Sparkles, UserRound, UserRoundCog, type LucideIcon } from 'lucide-react';
import type { Settings as SettingsT } from '@student-os/core';
import { cn } from '../components/ui';
import { AcademicSection, AccountSection, AISection, AppearanceSection, AttendanceSection, DataSection, NotificationsSection, ProfileSection, StudySection } from '../components/settings/sections';
import { useMedia, useSettings } from '../lib/hooks';
import { useApp, type User } from '../lib/store';
import { BackButton } from '../components/ui';

interface SectionDef {
  id: string;
  title: string;
  icon: LucideIcon;
  summary: (s: SettingsT, user: User | null) => string;
  Component: ComponentType<{ s: SettingsT }>;
}

const enabledCount = (s: SettingsT) => Object.values(s.notifications.categories).filter((c) => c.enabled).length;
const days = (n: number[]) => (n.length === 5 && [1, 2, 3, 4, 5].every((d) => n.includes(d)) ? 'Mon–Fri' : `${n.length} days a week`);

const GROUPS: Array<{ title: string; sections: SectionDef[] }> = [
  {
    title: 'You',
    sections: [
      { id: 'profile', title: 'Profile', icon: UserRound, summary: (s) => [s.profile.course, s.profile.college].filter(Boolean).join(' · ') || 'Name, college, course', Component: ProfileSection },
      { id: 'account', title: 'Account & sync', icon: UserRoundCog, summary: (_s, u) => (u ? (u.email ?? 'Signed in') : 'Not signed in — data stays on this device'), Component: () => <AccountSection /> },
    ],
  },
  {
    title: 'Academics',
    sections: [
      { id: 'academic', title: 'Semester & schedule', icon: CalendarRange, summary: (s) => [s.semesterEnd ? `Ends ${s.semesterEnd}` : 'Semester dates', days(s.workingDays)].join(' · '), Component: AcademicSection },
      { id: 'attendance', title: 'Attendance', icon: GraduationCap, summary: (s) => `Min ${s.minAttendance}% · target ${s.targetAttendance}%`, Component: AttendanceSection },
      { id: 'study', title: 'Study & revision', icon: Repeat, summary: (s) => `${Math.round((s.dailyStudyTargetMinutes / 60) * 10) / 10} h a day · revise on day ${s.revisionIntervals.join(', ')}`, Component: StudySection },
    ],
  },
  {
    title: 'App',
    sections: [
      { id: 'notifications', title: 'Notifications', icon: Bell, summary: (s) => `${enabledCount(s)} reminder types on · sound ${s.notifications.sound ? 'on' : 'off'}`, Component: NotificationsSection },
      { id: 'ai', title: 'AI Pilot', icon: Sparkles, summary: (s) => (!s.aiPermissions.enabled ? 'Off' : Object.values(s.aiPermissions.access).includes('full') ? `On · some full access · ${s.aiPower} power` : `On · you confirm every change · ${s.aiPower} power`), Component: AISection },
      { id: 'appearance', title: 'Appearance', icon: Palette, summary: (s) => `${{ system: 'Auto', light: 'Light', dark: 'Dark' }[s.theme]} theme · ${s.accent}`, Component: AppearanceSection },
      { id: 'data', title: 'Privacy & data', icon: Database, summary: () => 'Export or erase your data', Component: () => <DataSection /> },
    ],
  },
];
const ALL = GROUPS.flatMap((g) => g.sections);

function ProfileCard({ s, user }: { s: SettingsT; user: User | null }) {
  const name = s.profile.name || user?.name || 'Student';
  return (
    <Link to="/settings/profile" className="flex items-center gap-4 rounded-2xl border border-line bg-surface p-4 transition-colors hover:bg-surface-2">
      <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-accent text-xl font-semibold text-accent-ink">{name[0]!.toUpperCase()}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-base font-semibold">{name}</span>
        <span className="block truncate text-sm text-ink-2">{user?.email ?? 'Using this device only'}</span>
        {(s.profile.course || s.profile.semester) && (
          <span className="block truncate text-xs text-muted">{[s.profile.course, s.profile.semester && `Semester ${s.profile.semester}`].filter(Boolean).join(' · ')}</span>
        )}
      </span>
      <ChevronRight className="size-5 shrink-0 text-muted" />
    </Link>
  );
}

function Menu({ s, user, active, compact }: { s: SettingsT; user: User | null; active?: string; compact?: boolean }) {
  return (
    <nav aria-label="Settings sections" className="space-y-5">
      {GROUPS.map((g) => (
        <div key={g.title} className="space-y-1.5">
          <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted">{g.title}</h2>
          <ul className={cn('overflow-hidden rounded-2xl', compact ? 'space-y-0.5' : 'divide-y divide-line border border-line bg-surface')}>
            {g.sections.map(({ id, title, icon: Icon, summary }) => {
              const on = id === active;
              return (
                <li key={id}>
                  <Link
                    to={`/settings/${id}`}
                    aria-current={on ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-3 px-3 py-3 transition-colors',
                      compact ? cn('rounded-xl', on ? 'bg-accent-soft' : 'hover:bg-surface-2') : 'hover:bg-surface-2',
                    )}
                  >
                    <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-xl', on ? 'bg-accent text-accent-ink' : 'bg-surface-2 text-ink-2')}>
                      <Icon className="size-[18px]" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={cn('block text-sm', on ? 'font-semibold text-ink' : 'font-medium text-ink')}>{title}</span>
                      <span className="block truncate text-xs text-muted">{summary(s, user)}</span>
                    </span>
                    {!compact && <ChevronRight className="size-4 shrink-0 text-muted" />}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export default function Settings() {
  const s = useSettings();
  const user = useApp((x) => x.user);
  const { section } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const desktop = useMedia('(min-width: 768px)');

  // Old links like /settings#notifications open that section.
  useEffect(() => {
    const id = location.hash.slice(1);
    if (id && ALL.some((x) => x.id === id)) navigate(`/settings/${id}`, { replace: true });
  }, [location.hash, navigate]);

  const current = ALL.find((x) => x.id === section);
  if (section && !current) return <Navigate to="/settings" replace />;

  // Mobile: the menu is its own screen.
  if (!desktop && !current) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <BackButton fallback="/more" />
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        </div>
        <ProfileCard s={s} user={user} />
        <Menu s={s} user={user} />
      </div>
    );
  }

  const active = current ?? ALL[0]!;
  const { Component } = active;
  return (
    <div className="md:grid md:grid-cols-[17rem_1fr] md:gap-8">
      {desktop && (
        <aside className="sticky top-20 self-start">
          <div className="mb-4 flex items-center gap-2">
            <BackButton fallback="/" />
            <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          </div>
          <Menu s={s} user={user} active={active.id} compact />
        </aside>
      )}
      <section aria-labelledby="settings-title" className="min-w-0">
        <header className="mb-5 flex items-center gap-2">
          {!desktop && (
            <BackButton fallback="/settings" />
          )}
          <div>
            <h2 id="settings-title" className="text-xl font-semibold tracking-tight md:mt-12">
              {active.title}
            </h2>
            <p className="text-sm text-ink-2">{active.summary(s, user)}</p>
          </div>
        </header>
        <div className="max-w-2xl space-y-6">
          <Component s={s} />
        </div>
      </section>
    </div>
  );
}

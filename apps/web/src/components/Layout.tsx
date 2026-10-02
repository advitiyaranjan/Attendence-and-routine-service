import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  AlarmClock,
  Bell,
  BookOpen,
  Bot,
  CalendarClock,
  CalendarDays,
  CalendarPlus,
  ChartPie,
  CheckSquare,
  ClipboardCheck,
  ClipboardList,
  Cloud,
  CloudOff,
  FilePlus2,
  History,
  Home,
  LayoutGrid,
  ListChecks,
  Loader2,
  LogOut,
  NotebookPen,
  Plus,
  Repeat,
  Search,
  Settings as SettingsIcon,
  Sparkles,
  Table2,
  Timer,
  TrendingUp,
  TriangleAlert,
  X,
  type LucideIcon,
} from 'lucide-react';
import { db } from '../lib/db';
import { logout } from '../lib/auth';
import { useMedia, useSettings } from '../lib/hooks';
import { markAllRead } from '../lib/notifications';
import { useCopilot } from '../lib/copilot/store';
import { NotificationRow, useUnreadCount } from '../pages/Notifications';
import { ReminderForm } from '../pages/Reminders';
import { CopilotPanel } from './copilot/CopilotChat';
import { useApp } from '../lib/store';
import { syncNow } from '../lib/sync';
import { AssignmentForm, EventForm, ExamForm, ExtraClassForm, NoteForm, ScheduleForm, StudyLogForm, TaskForm, TopicForm } from './forms';
import { ErrorBoundary } from './ErrorBoundary';
import { AppLogo, cn, Modal } from './ui';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  key?: string;
}

/** Primary navigation, in the order of the information architecture. */
export const NAV: NavItem[] = [
  { to: '/', label: 'Home', icon: Home, key: 'g h' },
  { to: '/assistant', label: 'AI Pilot', icon: Bot, key: 'g i' },
  { to: '/todos', label: 'Todos', icon: ListChecks, key: 'g t' },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays, key: 'g c' },
  { to: '/revision', label: 'Revision', icon: Repeat, key: 'g r' },
  { to: '/attendance', label: 'Attendance', icon: ChartPie, key: 'g a' },
  { to: '/subjects', label: 'Subjects', icon: BookOpen, key: 'g s' },
  { to: '/notes', label: 'Notes', icon: NotebookPen, key: 'g n' },
  { to: '/deadlines', label: 'Exams', icon: ClipboardList, key: 'g e' },
  { to: '/analytics', label: 'Analytics', icon: TrendingUp },
];

/** Useful pages that aren't top-level sections. */
const NAV_MORE: NavItem[] = [
  { to: '/classes', label: 'Timetable', icon: Table2 },
  { to: '/tasks', label: 'All tasks', icon: CheckSquare },
  { to: '/reminders', label: 'Reminders', icon: AlarmClock },
  { to: '/review', label: 'Daily review', icon: ClipboardCheck },
  { to: '/ai-activity', label: 'AI activity', icon: History },
];

const MOBILE_NAV: NavItem[] = [
  { to: '/', label: 'Home', icon: Home },
  { to: '/assistant', label: 'AI', icon: Bot },
  { to: '/todos', label: 'Todos', icon: ListChecks },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays },
];

export function SyncBadge() {
  const { sync, user, online } = useApp();
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  let icon = <Cloud className="size-3.5" />;
  let text: string;
  if (!user) {
    icon = <CloudOff className="size-3.5" />;
    text = 'This device only';
  } else if (!online || sync.phase === 'offline') {
    icon = <span className="size-2 rounded-full bg-muted" />;
    text = sync.pending ? `Offline · ${sync.pending} to sync` : 'Offline';
  } else if (sync.phase === 'syncing') {
    icon = <Loader2 className="size-3.5 animate-spin" />;
    text = 'Syncing…';
  } else if (sync.phase === 'error') {
    icon = <TriangleAlert className="size-3.5" style={{ color: 'var(--color-warning)' }} />;
    text = 'Sync paused · retrying';
  } else if (sync.pending) {
    text = `${sync.pending} change${sync.pending === 1 ? '' : 's'} to sync`;
  } else {
    text = sync.lastSyncedAt ? `Synced ${relative(sync.lastSyncedAt)}` : 'Synced';
  }
  return (
    <button
      onClick={() => void syncNow()}
      title={user ? (online ? 'Sync now' : 'Changes will sync automatically when you reconnect') : 'Sign in from Settings to sync across devices'}
      className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-ink-2 hover:bg-surface-2"
    >
      {icon}
      <span className="whitespace-nowrap">{text}</span>
    </button>
  );
}

function relative(iso: string) {
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

/**
 * Dropdown on laptops, bottom sheet on phones. Overlays are portalled to <body>
 * so the sticky (backdrop-filtered) header can't trap `position: fixed`.
 */
function Popover({ open, onClose, title, children, width = 'md:w-96' }: { open: boolean; onClose: () => void; title: string; children: ReactNode; width?: string }) {
  const desktop = useMedia('(min-width: 768px)');
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  const overlay = createPortal(<div className={cn('fixed inset-0 z-40', !desktop && 'bg-black/35 backdrop-blur-[2px]')} onClick={onClose} />, document.body);
  if (desktop) {
    return (
      <>
        {overlay}
        <div role="dialog" aria-label={title} className={cn('absolute right-0 top-full z-50 mt-2 animate-rise overflow-hidden rounded-2xl border border-line bg-surface shadow-pop', width)}>
          {children}
        </div>
      </>
    );
  }
  return (
    <>
      {overlay}
      {createPortal(
        <div role="dialog" aria-label={title} className="safe-bottom fixed inset-x-0 bottom-0 z-50 max-h-[85dvh] animate-rise overflow-y-auto rounded-t-3xl border-t border-line bg-surface shadow-pop">
          <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-line" aria-hidden />
          {children}
        </div>,
        document.body,
      )}
    </>
  );
}

function IconButton({ label, onClick, children, badge }: { label: string; onClick: () => void; children: ReactNode; badge?: number }) {
  return (
    <button onClick={onClick} className="relative flex size-10 items-center justify-center rounded-xl text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink" aria-label={label}>
      {children}
      {!!badge && (
        <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-accent-ink">{badge > 9 ? '9+' : badge}</span>
      )}
    </button>
  );
}

function NotificationBell() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const unread = useUnreadCount();
  const items = useLiveQuery(() => db.notifications.orderBy('scheduledAt').reverse().filter((n) => n.status !== 'dismissed').limit(8).toArray(), []) ?? [];
  const close = () => setOpen(false);
  return (
    <div className="relative">
      <IconButton label={`Notifications${unread ? `, ${unread} unread` : ''}`} onClick={() => setOpen((o) => !o)} badge={unread}>
        <Bell className="size-[18px]" />
      </IconButton>
      <Popover open={open} onClose={close} title="Notifications">
        <div className="flex items-center justify-between border-b border-line px-4 py-3 text-sm font-semibold">
          Notifications
          {unread > 0 && (
            <button className="text-xs font-medium text-accent hover:underline" onClick={() => void markAllRead()}>
              Mark all read
            </button>
          )}
        </div>
        <div className="max-h-[60vh] divide-y divide-line overflow-y-auto">
          {items.length === 0 && <p className="p-4 text-sm text-ink-2">You're all caught up.</p>}
          {items.map((n) => (
            <NotificationRow
              key={n.id}
              n={n}
              onNavigate={(href) => {
                close();
                navigate(href);
              }}
            />
          ))}
        </div>
        <button
          className="block w-full border-t border-line px-4 py-3 text-center text-sm font-medium text-accent hover:bg-surface-2"
          onClick={() => {
            close();
            navigate('/notifications');
          }}
        >
          View all notifications
        </button>
      </Popover>
    </div>
  );
}

function initials(name: string | null | undefined, email: string | null | undefined) {
  const src = (name || email || '?').trim();
  const parts = src.split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (name && parts[1] ? parts[1][0] : '')).toUpperCase();
}

function Avatar({ size = 'size-8' }: { size?: string }) {
  const user = useApp((s) => s.user);
  const settings = useSettings();
  return (
    <span className={cn('flex shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent', size)} aria-hidden>
      {initials(settings.profile.name || user?.name, user?.email)}
    </span>
  );
}

/** Profile button: account details, every section (on phones), settings and sign out. */
function ProfileMenu() {
  const [open, setOpen] = useState(false);
  const user = useApp((s) => s.user);
  const settings = useSettings();
  const navigate = useNavigate();
  const go = (to: string) => {
    setOpen(false);
    navigate(to);
  };
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="flex size-10 items-center justify-center rounded-xl hover:bg-surface-2" aria-label="Profile and menu" aria-expanded={open}>
        <Avatar />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} title="Profile" width="md:w-72">
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          <Avatar size="size-10" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{settings.profile.name || user?.name || 'Student'}</div>
            <div className="truncate text-xs text-muted">{user?.email ?? 'Not signed in'}</div>
          </div>
          <SyncBadge />
        </div>
        <div className="grid grid-cols-3 gap-2 border-b border-line p-3 md:hidden">
          {[...NAV.slice(4), ...NAV_MORE].map(({ to, label, icon: Icon }) => (
            <button key={to} onClick={() => go(to)} className="flex flex-col items-center gap-1.5 rounded-2xl bg-surface-2 px-1 py-3 text-xs text-ink-2 active:scale-[0.98]">
              <Icon className="size-5 text-accent" />
              {label}
            </button>
          ))}
        </div>
        <div className="p-2">
          <MenuRow icon={SettingsIcon} onClick={() => go('/settings')}>
            Settings
          </MenuRow>
          <MenuRow icon={Search} onClick={() => go('/search')}>
            Search
          </MenuRow>
          {user && (
            <MenuRow
              icon={LogOut}
              onClick={() => {
                setOpen(false);
                void logout(false);
              }}
            >
              Sign out
            </MenuRow>
          )}
        </div>
      </Popover>
    </div>
  );
}

function MenuRow({ icon: Icon, onClick, children }: { icon: LucideIcon; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-surface-2">
      <Icon className="size-4 text-ink-2" /> {children}
    </button>
  );
}

const QUICK_ACTIONS: Array<{ kind: string; label: string; icon: LucideIcon }> = [
  { kind: 'task', label: 'Task', icon: CheckSquare },
  { kind: 'class', label: 'Class', icon: CalendarClock },
  { kind: 'event', label: 'Event', icon: CalendarPlus },
  { kind: 'topic', label: 'Topic learned', icon: Repeat },
  { kind: 'exam', label: 'Exam', icon: ClipboardList },
  { kind: 'assignment', label: 'Assignment', icon: FilePlus2 },
  { kind: 'note', label: 'Note', icon: NotebookPen },
  { kind: 'reminder', label: 'Reminder', icon: AlarmClock },
  { kind: 'study', label: 'Study session', icon: Timer },
  { kind: 'log', label: 'Log study time', icon: History },
  { kind: 'weekly', label: 'Weekly class', icon: Table2 },
];

const QUICK_TITLES: Record<string, string> = {
  task: 'New task',
  class: 'Extra class',
  event: 'New event',
  topic: 'Topic learned',
  exam: 'New exam',
  assignment: 'New assignment',
  note: 'New note',
  reminder: 'New reminder',
  study: 'Study session',
  log: 'Log study time',
  weekly: 'Add a weekly class',
};

/** The "+" menu (bottom bar on phones, floating button on laptops) and its forms. */
function QuickAdd() {
  const { quickAdd, openQuickAdd } = useApp();
  const [menu, setMenu] = useState(false);
  const navigate = useNavigate();
  const close = () => openQuickAdd(null);
  const pick = (kind: string) => {
    setMenu(false);
    openQuickAdd(kind);
  };

  useEffect(() => {
    const open = () => setMenu(true);
    window.addEventListener('sos-quick-add', open);
    return () => window.removeEventListener('sos-quick-add', open);
  }, []);

  return (
    <>
      <div className="fixed bottom-6 right-6 z-30 hidden md:block">
        <button
          onClick={() => setMenu((m) => !m)}
          aria-label="Add"
          aria-expanded={menu}
          title="Add (N for a task)"
          className="flex size-14 items-center justify-center rounded-2xl bg-accent text-accent-ink shadow-pop transition-transform hover:scale-105 active:scale-95"
        >
          {menu ? <X className="size-6" /> : <Plus className="size-6" />}
        </button>
      </div>

      <Modal open={menu} onClose={() => setMenu(false)} title="Add">
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {QUICK_ACTIONS.map(({ kind, label, icon: Icon }) => (
            <button key={kind} onClick={() => pick(kind)} className="flex flex-col items-center gap-2 rounded-2xl bg-surface-2 px-1 py-3.5 text-xs font-medium text-ink-2 transition-colors hover:bg-accent-soft hover:text-ink active:scale-[0.98]">
              <Icon className="size-5 text-accent" />
              {label}
            </button>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            onClick={() => {
              setMenu(false);
              navigate('/attendance');
            }}
            className="flex items-center justify-center gap-2 rounded-2xl border border-line py-3 text-sm font-medium hover:bg-surface-2"
          >
            <ChartPie className="size-4 text-accent" /> Mark attendance
          </button>
          <button
            onClick={() => {
              setMenu(false);
              useCopilot.getState().setOpen(true);
            }}
            className="flex items-center justify-center gap-2 rounded-2xl bg-accent-soft py-3 text-sm font-medium text-ink hover:opacity-90"
          >
            <Sparkles className="size-4 text-accent" /> Ask AI to add it
          </button>
        </div>
      </Modal>

      <Modal open={!!quickAdd} onClose={close} title={quickAdd ? (QUICK_TITLES[quickAdd] ?? 'Add') : ''}>
        {quickAdd === 'task' && <TaskForm onDone={close} />}
        {quickAdd === 'reminder' && <ReminderForm onDone={close} />}
        {quickAdd === 'topic' && <TopicForm onDone={close} />}
        {quickAdd === 'study' && <EventForm onDone={close} defaultType="study" />}
        {quickAdd === 'event' && <EventForm onDone={close} defaultType="personal" />}
        {quickAdd === 'log' && <StudyLogForm onDone={close} />}
        {quickAdd === 'exam' && <ExamForm onDone={close} />}
        {quickAdd === 'assignment' && <AssignmentForm onDone={close} />}
        {quickAdd === 'class' && <ExtraClassForm onDone={close} />}
        {quickAdd === 'weekly' && <ScheduleForm onDone={close} />}
        {quickAdd === 'note' && (
          <NoteForm
            onDone={(id) => {
              close();
              if (id) navigate(`/notes?open=${id}`);
            }}
          />
        )}
      </Modal>
    </>
  );
}

function Toasts() {
  const { toasts, dismissToast } = useApp();
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(5.5rem+var(--sab))] z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6" aria-live="polite">
      {toasts.slice(-3).map((t) => (
        <div key={t.id} className="pointer-events-auto flex max-w-md animate-rise items-center gap-3 rounded-2xl bg-ink px-4 py-2.5 text-sm text-page shadow-pop">
          {t.tone === 'error' && <TriangleAlert className="size-4 shrink-0" style={{ color: 'var(--color-warning)' }} />}
          <span>{t.message}</span>
          {t.action && (
            <button
              className="font-semibold underline-offset-2 hover:underline"
              onClick={() => {
                t.action!.run();
                dismissToast(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function useKeyboardShortcuts() {
  const navigate = useNavigate();
  const openQuickAdd = useApp((s) => s.openQuickAdd);
  useEffect(() => {
    let pendingG = false;
    let timer: ReturnType<typeof setTimeout>;
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || target.closest('input, textarea, select, [contenteditable], dialog[open]')) return;
      if (pendingG) {
        pendingG = false;
        const match = NAV.find((n) => n.key === `g ${e.key}`);
        if (match) navigate(match.to);
        return;
      }
      if (e.key === 'g') {
        pendingG = true;
        clearTimeout(timer);
        timer = setTimeout(() => (pendingG = false), 800);
      } else if (e.key === 'n') {
        e.preventDefault();
        openQuickAdd('task');
      } else if (e.key === '.') {
        e.preventDefault();
        useCopilot.getState().setOpen(true);
      } else if (e.key === '/') {
        e.preventDefault();
        navigate('/search');
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate, openQuickAdd]);
}

function SideLink({ item }: { item: NavItem }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      className={({ isActive }) =>
        cn(
          'flex h-9 items-center gap-3 rounded-xl px-3 text-sm transition-colors',
          isActive ? 'bg-accent-soft font-medium text-ink [&>svg]:text-accent' : 'text-ink-2 hover:bg-surface-2 hover:text-ink',
        )
      }
    >
      <Icon className="size-[18px]" /> {item.label}
    </NavLink>
  );
}

export function Layout() {
  const location = useLocation();
  const online = useApp((s) => s.online);
  const user = useApp((s) => s.user);
  const settings = useSettings();
  const openCopilot = useCopilot((s) => s.setOpen);
  const navigate = useNavigate();
  useKeyboardShortcuts();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  return (
    <div className="min-h-dvh md:flex">
      <aside className="safe-top sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-line bg-surface md:flex">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <AppLogo size="sm" />
          <span className="text-[15px] font-semibold tracking-tight">Student OS</span>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-3" aria-label="Main">
          {NAV.map((item) => (
            <SideLink key={item.to} item={item} />
          ))}
          <div className="px-3 pb-1 pt-5 text-[11px] font-semibold uppercase tracking-wider text-muted">More</div>
          {NAV_MORE.map((item) => (
            <SideLink key={item.to} item={item} />
          ))}
        </nav>
        <div className="space-y-1 border-t border-line p-3">
          <SideLink item={{ to: '/settings', label: 'Settings', icon: SettingsIcon }} />
          <NavLink to="/settings" className="flex items-center gap-3 rounded-xl px-3 py-2 hover:bg-surface-2">
            <Avatar />
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{settings.profile.name || user?.name || 'Student'}</div>
              <div className="truncate text-xs text-muted">{user?.email ?? 'This device only'}</div>
            </div>
          </NavLink>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="safe-top sticky top-0 z-30 border-b border-line bg-page/85 backdrop-blur-md">
          <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-3 md:h-16 md:px-8">
            <div className="flex min-w-0 items-center gap-2 md:hidden">
              <AppLogo size="sm" />
              <span className="truncate text-[15px] font-semibold tracking-tight">Student OS</span>
            </div>
            <button
              onClick={() => navigate('/search')}
              className="hidden h-10 w-full max-w-sm items-center gap-2 rounded-xl border border-line bg-surface px-3 text-sm text-muted shadow-card hover:text-ink-2 md:flex"
            >
              <Search className="size-4" /> Search everything…
              <kbd className="ml-auto rounded-md border border-line px-1.5 text-[11px]">/</kbd>
            </button>
            <div className="ml-auto flex items-center gap-0.5">
              <span className="hidden lg:block">
                <SyncBadge />
              </span>
              <NotificationBell />
              <button
                onClick={() => openCopilot(true)}
                className="flex h-10 items-center gap-1.5 rounded-xl px-2.5 text-sm font-medium text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
                aria-label="Ask AI Pilot"
                title="AI Pilot (.)"
              >
                <Sparkles className="size-[18px] text-accent" /> AI
              </button>
              <ProfileMenu />
            </div>
          </div>
        </header>
        {!online && (
          <div className="border-b border-line bg-surface-2 px-4 py-1.5 text-center text-xs text-ink-2">● Offline. Everything still works, and changes sync when you reconnect.</div>
        )}
        <main className="mx-auto max-w-6xl px-4 pb-32 pt-5 md:px-8 md:pb-16 md:pt-7">
          <ErrorBoundary resetKey={location.pathname}>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>

      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur-md md:hidden" aria-label="Main">
        <div className="flex">
          {MOBILE_NAV.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => cn('group flex flex-1 flex-col items-center gap-0.5 pb-1.5 pt-2 text-[11px] font-medium', isActive ? 'text-ink' : 'text-muted')}>
              {({ isActive }) => (
                <>
                  <span className={cn('flex h-7 w-12 items-center justify-center rounded-full transition-colors', isActive && 'bg-accent-soft text-accent')}>
                    <Icon className="size-5" />
                  </span>
                  {label}
                </>
              )}
            </NavLink>
          ))}
          <button onClick={() => window.dispatchEvent(new Event('sos-quick-add'))} className="flex flex-1 flex-col items-center justify-center" aria-label="Add">
            <span className="flex size-11 items-center justify-center rounded-2xl bg-accent text-accent-ink shadow-pop active:scale-95">
              <Plus className="size-5" />
            </span>
          </button>
        </div>
      </nav>

      <QuickAdd />
      <CopilotPanel />
      <Toasts />
    </div>
  );
}

/** Every section as a grid (kept for old links to /more). */
export function MorePage() {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {[...NAV, ...NAV_MORE, { to: '/settings', label: 'Settings', icon: SettingsIcon }].map(({ to, label, icon: Icon }) => (
        <NavLink key={to} to={to} className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-4 text-sm font-medium shadow-card hover:bg-surface-2">
          <Icon className="size-5 text-accent" /> {label}
        </NavLink>
      ))}
      <NavLink to="/search" className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-4 text-sm font-medium shadow-card hover:bg-surface-2">
        <LayoutGrid className="size-5 text-accent" /> Search
      </NavLink>
    </div>
  );
}

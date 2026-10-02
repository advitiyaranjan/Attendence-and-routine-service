import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  BarChart3,
  Bell,
  AlarmClock,
  History,
  BookOpen,
  Brain,
  CalendarDays,
  CheckSquare,
  ClipboardCheck,
  CloudOff,
  Cloud,
  FileText,
  GraduationCap,
  Home,
  LayoutGrid,
  Loader2,
  Plus,
  Repeat,
  Search,
  Settings as SettingsIcon,
  Sparkles,
  Table2,
  TriangleAlert,
  X,
} from 'lucide-react';
import { db } from '../lib/db';
import { markAllRead } from '../lib/notifications';
import { useCopilot } from '../lib/copilot/store';
import { NotificationRow, useUnreadCount } from '../pages/Notifications';
import { ReminderForm } from '../pages/Reminders';
import { CopilotPanel } from './copilot/CopilotChat';
import { useApp } from '../lib/store';
import { syncNow } from '../lib/sync';
import { AssignmentForm, EventForm, ExamForm, ExtraClassForm, NoteForm, StudyLogForm, TaskForm, TopicForm } from './forms';
import { ErrorBoundary } from './ErrorBoundary';
import { cn, Modal } from './ui';

const NAV = [
  { to: '/', label: 'Dashboard', icon: Home, key: 'g d' },
  { to: '/today', label: 'Today', icon: ClipboardCheck, key: 'g t' },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays, key: 'g c' },
  { to: '/classes', label: 'Timetable', icon: Table2, key: '' },
  { to: '/attendance', label: 'Attendance', icon: GraduationCap, key: 'g a' },
  { to: '/tasks', label: 'Tasks', icon: CheckSquare, key: '' },
  { to: '/revision', label: 'Revision', icon: Repeat, key: 'g r' },
  { to: '/deadlines', label: 'Exams & deadlines', icon: FileText, key: '' },
  { to: '/reminders', label: 'Reminders', icon: AlarmClock, key: '' },
  { to: '/subjects', label: 'Subjects', icon: BookOpen, key: '' },
  { to: '/notes', label: 'Notes', icon: LayoutGrid, key: '' },
  { to: '/analytics', label: 'Analytics', icon: BarChart3, key: '' },
  { to: '/assistant', label: 'Study Copilot', icon: Sparkles, key: '' },
  { to: '/ai-activity', label: 'AI activity', icon: History, key: '' },
  { to: '/settings', label: 'Settings', icon: SettingsIcon, key: '' },
];

const MOBILE_NAV = [
  { to: '/', label: 'Home', icon: Home },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays },
  { to: '/tasks', label: 'Tasks', icon: CheckSquare },
  { to: '/revision', label: 'Revision', icon: Repeat },
  { to: '/more', label: 'More', icon: LayoutGrid },
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
    text = 'Local only';
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
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-ink-2 hover:bg-surface-2"
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

function NotificationBell() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const unread = useUnreadCount();
  const items = useLiveQuery(() => db.notifications.orderBy('scheduledAt').reverse().filter((n) => n.status !== 'dismissed').limit(8).toArray(), []) ?? [];
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="relative rounded-md p-2 text-ink-2 hover:bg-surface-2" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} aria-expanded={open}>
        <Bell className="size-4" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-accent-ink">{unread > 9 ? '9+' : unread}</span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-40 mt-1 w-96 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-line bg-surface shadow-xl">
            <div className="flex items-center justify-between border-b border-line px-4 py-2 text-sm font-medium">
              Notifications
              {unread > 0 && (
                <button className="text-xs text-ink-2 hover:text-ink" onClick={() => void markAllRead()}>
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
                    setOpen(false);
                    navigate(href);
                  }}
                />
              ))}
            </div>
            <button
              className="block w-full border-t border-line px-4 py-2 text-center text-sm text-accent hover:bg-surface-2"
              onClick={() => {
                setOpen(false);
                navigate('/notifications');
              }}
            >
              View all notifications
            </button>
          </div>
        </>
      )}
    </div>
  );
}

const QUICK_ACTIONS: Array<{ kind: string; label: string }> = [
  { kind: 'task', label: 'Task' },
  { kind: 'reminder', label: 'Reminder' },
  { kind: 'topic', label: 'Topic learned' },
  { kind: 'study', label: 'Study session' },
  { kind: 'log', label: 'Log study time' },
  { kind: 'exam', label: 'Exam' },
  { kind: 'assignment', label: 'Assignment' },
  { kind: 'class', label: 'Extra class' },
  { kind: 'note', label: 'Note' },
];

function QuickAdd() {
  const { quickAdd, openQuickAdd } = useApp();
  const [menu, setMenu] = useState(false);
  const navigate = useNavigate();
  const close = () => openQuickAdd(null);
  const title = QUICK_ACTIONS.find((a) => a.kind === quickAdd)?.label;

  return (
    <>
      <div className="fixed bottom-[calc(5rem+var(--sab))] right-4 z-30 md:bottom-6 md:right-6">
        {menu && (
          <>
            <div className="fixed inset-0" onClick={() => setMenu(false)} />
            <div className="absolute bottom-14 right-0 w-52 rounded-xl border border-line bg-surface py-1 shadow-xl">
              {QUICK_ACTIONS.map((a) => (
                <button
                  key={a.kind}
                  onClick={() => {
                    setMenu(false);
                    openQuickAdd(a.kind);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-2"
                >
                  <Plus className="size-3.5 text-muted" /> {a.label}
                </button>
              ))}
              <button
                onClick={() => {
                  setMenu(false);
                  navigate('/attendance');
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-2"
              >
                <Plus className="size-3.5 text-muted" /> Attendance
              </button>
              <div className="my-1 border-t border-line" />
              <button
                onClick={() => {
                  setMenu(false);
                  useCopilot.getState().setOpen(true);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-2"
              >
                <Sparkles className="size-3.5 text-accent" /> Ask AI
              </button>
            </div>
          </>
        )}
        <button
          onClick={() => setMenu((m) => !m)}
          aria-label="Quick add"
          aria-expanded={menu}
          title="Quick add (N)"
          className="relative flex size-12 items-center justify-center rounded-full bg-accent text-accent-ink shadow-lg hover:opacity-90"
        >
          {menu ? <X className="size-5" /> : <Plus className="size-5" />}
        </button>
      </div>

      <Modal open={!!quickAdd} onClose={close} title={title ? `New ${title.toLowerCase()}` : ''}>
        {quickAdd === 'task' && <TaskForm onDone={close} />}
        {quickAdd === 'reminder' && <ReminderForm onDone={close} />}
        {quickAdd === 'topic' && <TopicForm onDone={close} />}
        {quickAdd === 'study' && <EventForm onDone={close} defaultType="study" />}
        {quickAdd === 'log' && <StudyLogForm onDone={close} />}
        {quickAdd === 'exam' && <ExamForm onDone={close} />}
        {quickAdd === 'assignment' && <AssignmentForm onDone={close} />}
        {quickAdd === 'class' && <ExtraClassForm onDone={close} />}
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
    <div className="pointer-events-none fixed inset-x-0 bottom-36 z-50 flex flex-col items-center gap-2 px-4 md:bottom-6" aria-live="polite">
      {toasts.slice(-3).map((t) => (
        <div
          key={t.id}
          className={cn(
            'pointer-events-auto flex max-w-md items-center gap-3 rounded-lg border border-line bg-ink px-4 py-2 text-sm text-page shadow-lg',
          )}
        >
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

function CopilotButton() {
  const setOpen = useCopilot((s) => s.setOpen);
  return (
    <button onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-ink-2 hover:bg-surface-2 hover:text-ink" title="Study Copilot (.)" aria-label="Open Study Copilot">
      <Sparkles className="size-4 text-accent" />
      <span className="hidden sm:inline">Copilot</span>
    </button>
  );
}

export function Layout() {
  const location = useLocation();
  const online = useApp((s) => s.online);
  useKeyboardShortcuts();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  return (
    <div className="min-h-dvh md:flex">
      <aside className="safe-top sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-line bg-surface md:flex">
        <div className="flex items-center gap-2 px-5 py-4">
          <Brain className="size-5 text-accent" />
          <span className="font-semibold">Student OS</span>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3" aria-label="Main">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                cn('flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm', isActive ? 'bg-accent-soft font-medium text-ink' : 'text-ink-2 hover:bg-surface-2 hover:text-ink')
              }
            >
              <Icon className="size-4" /> {label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-line p-3 text-xs text-muted">
          <kbd className="rounded border border-line px-1">n</kbd> task · <kbd className="rounded border border-line px-1">.</kbd> Copilot · <kbd className="rounded border border-line px-1">/</kbd> search
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="safe-top sticky top-0 z-20 flex min-h-12 items-center justify-between gap-2 border-b border-line bg-page/90 px-4 backdrop-blur md:px-6">
          <div className="flex items-center gap-2 md:hidden">
            <Brain className="size-5 text-accent" />
            <span className="font-semibold">Student OS</span>
          </div>
          <div className="hidden md:block" />
          <div className="flex items-center gap-1">
            <SyncBadge />
            <CopilotButton />
            <NavLink to="/search" className="rounded-md p-2 text-ink-2 hover:bg-surface-2" aria-label="Search">
              <Search className="size-4" />
            </NavLink>
            <NotificationBell />
          </div>
        </header>
        {!online && (
          <div className="border-b border-line bg-surface-2 px-4 py-1.5 text-center text-xs text-ink-2">
            ● Offline — everything still works. Changes will sync automatically.
          </div>
        )}
        <main className="mx-auto max-w-5xl px-4 pb-28 pt-5 md:px-6 md:pb-12">
          <ErrorBoundary resetKey={location.pathname}>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-20 flex border-t border-line bg-surface safe-bottom md:hidden" aria-label="Main">
        {MOBILE_NAV.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) => cn('flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px]', isActive ? 'text-accent' : 'text-ink-2')}
          >
            <Icon className="size-5" />
            {label}
          </NavLink>
        ))}
      </nav>

      <QuickAdd />
      <CopilotPanel />
      <Toasts />
    </div>
  );
}

export function MorePage() {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {NAV.filter((n) => !MOBILE_NAV.some((m) => m.to === n.to)).map(({ to, label, icon: Icon }) => (
        <NavLink key={to} to={to} className="flex items-center gap-2 rounded-xl border border-line bg-surface p-4 text-sm hover:bg-surface-2">
          <Icon className="size-4 text-accent" /> {label}
        </NavLink>
      ))}
      <NavLink to="/review" className="flex items-center gap-2 rounded-xl border border-line bg-surface p-4 text-sm hover:bg-surface-2">
        <ClipboardCheck className="size-4 text-accent" /> Daily review
      </NavLink>
    </div>
  );
}

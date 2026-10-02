import { lazy, Suspense, useEffect, useState } from 'react';
import { Route, Routes, useNavigate, useSearchParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import type { NotificationActionId } from '@student-os/core';
import { Layout, MorePage } from './components/Layout';
import { Spinner, Splash } from './components/ui';
import { performNotificationAction, type ActionPayload } from './lib/notifications';
import { db } from './lib/db';
import { SETTINGS_ID } from './lib/repo';
import { useApp } from './lib/store';
import { applyTheme } from './lib/theme';
import { refreshAiStatus } from './lib/ai';
import { Dashboard } from './pages/Dashboard';
import { LoginPage } from './pages/Login';
import { Setup } from './pages/setup/Setup';

const Today = lazy(() => import('./pages/Today'));
const CalendarPage = lazy(() => import('./pages/Calendar'));
const Classes = lazy(() => import('./pages/Classes'));
const Attendance = lazy(() => import('./pages/Attendance'));
const Tasks = lazy(() => import('./pages/Tasks'));
const Todos = lazy(() => import('./pages/Todos'));
const Revision = lazy(() => import('./pages/Revision'));
const Deadlines = lazy(() => import('./pages/Deadlines'));
const Subjects = lazy(() => import('./pages/Subjects'));
const Notes = lazy(() => import('./pages/Notes'));
const Analytics = lazy(() => import('./pages/Analytics'));
const Assistant = lazy(() => import('./pages/Assistant'));
const SettingsPage = lazy(() => import('./pages/Settings'));
const Review = lazy(() => import('./pages/Review'));
const Search = lazy(() => import('./pages/Search'));
const Notifications = lazy(() => import('./pages/Notifications'));
const Reminders = lazy(() => import('./pages/Reminders'));
const AIActivity = lazy(() => import('./pages/AIActivity'));

/**
 * Notification quick actions reaching the page:
 * - from the service worker while the app is open (postMessage)
 * - via ?nact= when the SW had to open the app to finish an action
 */
function useNotificationActions() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  useEffect(() => {
    const raw = params.get('nact');
    if (!raw) return;
    params.delete('nact');
    setParams(params, { replace: true });
    try {
      const { action, payload } = JSON.parse(raw) as { action: NotificationActionId; payload: ActionPayload };
      void performNotificationAction(action, payload).then((href) => href && navigate(href));
    } catch {
      // ignore malformed links
    }
  }, [params, setParams, navigate]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === 'navigate' && typeof e.data.url === 'string') navigate(e.data.url);
      if (e.data?.type === 'notification-action') {
        void performNotificationAction(e.data.action, e.data.payload).then((href) => href && navigate(href));
      }
    };
    const onNavigate = (e: Event) => navigate((e as CustomEvent<string>).detail);
    navigator.serviceWorker?.addEventListener('message', onMessage);
    window.addEventListener('sos-navigate', onNavigate);
    return () => {
      navigator.serviceWorker?.removeEventListener('message', onMessage);
      window.removeEventListener('sos-navigate', onNavigate);
    };
  }, [navigate]);
}

export function App() {
  const settings = useLiveQuery(async () => (await db.entity('settings').get(SETTINGS_ID)) ?? null, []);
  const online = useApp((s) => s.online);
  const user = useApp((s) => s.user);
  const authChecked = useApp((s) => s.authChecked);
  const localMode = useApp((s) => s.localMode);
  const firstSyncDone = useApp((s) => s.firstSyncDone);
  const serverIssue = useApp((s) => s.serverIssue);
  const [gaveUpWaiting, setGaveUpWaiting] = useState(false);
  useNotificationActions();

  // A returning student signing in on a new device: their settings arrive with the
  // first sync, so wait for it before deciding they're new (but never forever).
  const waitingForAccount = !!user && !settings?.onboarded && !firstSyncDone && online && !serverIssue && !gaveUpWaiting;
  useEffect(() => {
    if (!waitingForAccount) return;
    const t = setTimeout(() => setGaveUpWaiting(true), 10_000);
    return () => clearTimeout(t);
  }, [waitingForAccount]);

  useEffect(() => {
    if (settings !== undefined) applyTheme(settings?.theme ?? 'system', settings?.accent ?? 'indigo');
  }, [settings]);

  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme(settings?.theme ?? 'system', settings?.accent ?? 'indigo');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [settings]);

  useEffect(() => {
    if (!online) return;
    void refreshAiStatus();
  }, [online]);

  if (settings === undefined) return <Splash />;
  if (!user && !localMode) return authChecked ? <LoginPage /> : <Splash />;
  if (waitingForAccount) return <Splash label="Loading your workspace" />;
  if (!settings?.onboarded) return <Setup />;

  return (
    <Suspense fallback={<Spinner />}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="today" element={<Today />} />
          <Route path="calendar" element={<CalendarPage />} />
          <Route path="classes" element={<Classes />} />
          <Route path="attendance" element={<Attendance />} />
          <Route path="todos" element={<Todos />} />
          <Route path="tasks" element={<Tasks />} />
          <Route path="revision" element={<Revision />} />
          <Route path="deadlines" element={<Deadlines />} />
          <Route path="subjects" element={<Subjects />} />
          <Route path="notes" element={<Notes />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="assistant" element={<Assistant />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="settings/:section" element={<SettingsPage />} />
          <Route path="review" element={<Review />} />
          <Route path="search" element={<Search />} />
          <Route path="notifications" element={<Notifications />} />
          <Route path="reminders" element={<Reminders />} />
          <Route path="ai-activity" element={<AIActivity />} />
          <Route path="more" element={<MorePage />} />
          <Route path="*" element={<Dashboard />} />
        </Route>
      </Routes>
    </Suspense>
  );
}

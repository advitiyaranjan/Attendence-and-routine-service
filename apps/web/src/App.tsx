import { lazy, Suspense, useEffect } from 'react';
import { Route, Routes, useNavigate, useSearchParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import type { NotificationActionId } from '@student-os/core';
import { Layout, MorePage } from './components/Layout';
import { Spinner } from './components/ui';
import { performNotificationAction, type ActionPayload } from './lib/notifications';
import { db } from './lib/db';
import { SETTINGS_ID } from './lib/repo';
import { useApp } from './lib/store';
import { applyTheme } from './lib/theme';
import { aiStatus } from './lib/ai';
import { Dashboard } from './pages/Dashboard';
import { Onboarding } from './pages/Onboarding';

const Today = lazy(() => import('./pages/Today'));
const CalendarPage = lazy(() => import('./pages/Calendar'));
const Classes = lazy(() => import('./pages/Classes'));
const Attendance = lazy(() => import('./pages/Attendance'));
const Tasks = lazy(() => import('./pages/Tasks'));
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
  useNotificationActions();

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
    aiStatus()
      .then((s) => useApp.setState({ aiAvailable: s.available }))
      .catch(() => useApp.setState({ aiAvailable: false }));
  }, [online]);

  if (settings === undefined) return <Spinner />;
  if (!settings?.onboarded) return <Onboarding />;

  return (
    <Suspense fallback={<Spinner />}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="today" element={<Today />} />
          <Route path="calendar" element={<CalendarPage />} />
          <Route path="classes" element={<Classes />} />
          <Route path="attendance" element={<Attendance />} />
          <Route path="tasks" element={<Tasks />} />
          <Route path="revision" element={<Revision />} />
          <Route path="deadlines" element={<Deadlines />} />
          <Route path="subjects" element={<Subjects />} />
          <Route path="notes" element={<Notes />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="assistant" element={<Assistant />} />
          <Route path="settings" element={<SettingsPage />} />
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

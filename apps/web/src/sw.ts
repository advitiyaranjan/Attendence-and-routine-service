/// <reference lib="webworker" />
/**
 * Service worker:
 * - precaches the app shell so it opens offline (API calls are never cached)
 * - shows Web Push notifications from the server
 * - checks local data for due reminders on periodic background sync (offline-capable)
 * - routes notification quick actions:
 *     app open            → message the page (local-first write, synced later)
 *     app closed, online  → authenticated server action (push notifications only)
 *     otherwise           → snooze locally, or open the app to finish the action
 */
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { db, kvGet } from './lib/db';
import { computeDue, osOptions, recordDelivered, snoozeLocal, type NotifyItem } from './lib/notify-core';
import { loadSettings } from './lib/queries';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision: string | null }> };

self.skipWaiting();
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

try {
  registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html'), { denylist: [/^\/api\//] }));
} catch {
  // index.html not precached in dev
}

const MAX_ACTIONS = 2;
const SERVER_ACTIONS = new Set(['present', 'absent', 'cancelled', 'complete', 'done', 'snooze', 'skip']);

// --- Push from the server ----------------------------------------------------------
self.addEventListener('push', (event) => {
  event.waitUntil(
    (async () => {
      let item: NotifyItem & { silent?: boolean };
      try {
        item = event.data?.json();
      } catch {
        return;
      }
      if (!item?.id || !item.title) return;
      const settings = await loadSettings();
      const already = await db.notifications.get(item.id);
      if (!already) await recordDelivered(item, 'push');
      // Browsers require a visible notification per push. If this device already showed it,
      // reuse the same tag silently so it replaces rather than duplicates.
      await self.registration.showNotification(item.title, {
        ...osOptions(item, settings, MAX_ACTIONS, !already),
        ...(already ? { silent: true } : {}),
      });
    })(),
  );
});

// --- Offline reminders while the app is closed (installed PWA, Chromium) ----------------
self.addEventListener('periodicsync' as keyof ServiceWorkerGlobalScopeEventMap, (event) => {
  const e = event as ExtendableEvent & { tag?: string };
  if (e.tag !== 'sos-notify') return;
  e.waitUntil(
    (async () => {
      const { items, settings } = await computeDue();
      if (!settings.onboarded) return;
      for (const item of items) {
        await recordDelivered(item, 'local');
        await self.registration.showNotification(item.title, osOptions(item, settings, MAX_ACTIONS));
      }
    })(),
  );
});

// --- Quick actions --------------------------------------------------------------------
async function serverAction(item: NotifyItem, action: string): Promise<boolean> {
  if (!item.token || !SERVER_ACTIONS.has(action)) return false;
  try {
    const res = await fetch('/api/notifications/action', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'student-os' },
      body: JSON.stringify({ token: item.token, action }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

const CONFIRM: Record<string, string> = {
  present: '✓ Attendance recorded: present',
  absent: '✓ Attendance recorded: absent',
  cancelled: '✓ Class marked as cancelled',
  complete: '✓ Task completed',
  done: '✓ Done',
  snooze: '⏰ Snoozed for 10 minutes',
};

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const item = (event.notification.data ?? {}) as NotifyItem;
  const action = event.action || 'open';

  event.waitUntil(
    (async () => {
      await db.notifications.update(item.id, { readAt: new Date().toISOString() }).catch(() => undefined);
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const payload = { ...item, ...(item.data ?? {}) };

      // 1. App open: let the page apply it locally (works offline, syncs later).
      if (windows.length) {
        const client = windows[0]!;
        client.postMessage({ type: 'notification-action', action, payload });
        if (action === 'open' || action === 'start') await (client as WindowClient).focus().catch(() => undefined);
        return;
      }

      // 2. App closed and online: authenticated server-side action (push notifications carry a token).
      if (action !== 'open' && action !== 'start' && (await serverAction(item, action))) {
        if (CONFIRM[action]) {
          await self.registration.showNotification(CONFIRM[action]!, { body: item.title, tag: `${item.id}-ok`, silent: true, icon: '/icon-192.png' });
        }
        return;
      }

      // 3. Offline / local notification: snooze can be handled right here.
      if (action === 'snooze') {
        await snoozeLocal({ ...item, data: item.data });
        return;
      }
      if (action === 'skip') return;

      // 4. Otherwise open the app to finish (it applies ?nact= on load).
      const nact = action === 'open' || action === 'start' ? '' : `?nact=${encodeURIComponent(JSON.stringify({ action, payload }))}`;
      await self.clients.openWindow(`${item.href || '/'}${nact}`);
    })(),
  );
});

// --- Keep the push subscription alive if the browser rotates it -------------------------
self.addEventListener('pushsubscriptionchange', (event) => {
  const e = event as ExtendableEvent & { oldSubscription?: PushSubscription };
  e.waitUntil(
    (async () => {
      try {
        const config = await (await fetch('/api/push/config', { credentials: 'include' })).json();
        if (!config.enabled || !config.publicKey) return;
        const key = config.publicKey as string;
        const padding = '='.repeat((4 - (key.length % 4)) % 4);
        const raw = atob((key + padding).replace(/-/g, '+').replace(/_/g, '/'));
        const sub = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: Uint8Array.from([...raw].map((c) => c.charCodeAt(0))),
        });
        const deviceId = (await kvGet<string>('deviceId')) ?? 'unknown';
        await fetch('/api/push/subscribe', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'student-os' },
          body: JSON.stringify({ deviceId, subscription: sub.toJSON() }),
        });
      } catch {
        // re-subscribed next time the app opens
      }
    })(),
  );
});

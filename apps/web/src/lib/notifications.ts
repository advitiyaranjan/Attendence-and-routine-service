/**
 * Page-side notification system.
 *
 * Delivery paths (all share the planner in @student-os/core and de-duplicate by id):
 *   1. This scheduler — every 30 s while the app/PWA is open. Works offline.
 *   2. Service worker periodic sync — best effort while closed (installed PWAs, Chromium).
 *   3. Server Web Push — while the app/browser is closed and the device is online.
 *
 * Each notification shown here is reported to the server so it is never pushed
 * again to this device.
 */
import { v4 as uuid } from 'uuid';
import { todayISO, type ClassOccurrence, type NotificationActionId, type NotificationCategory } from '@student-os/core';
import { completeRevision, markAttendance } from './actions';
import { api } from './api';
import { db, kvGet, kvSet } from './db';
import { deviceId } from './device';
import { computeDue, osOptions, recordDelivered, snoozeLocal, type NotifyItem } from './notify-core';
import { loadSettings } from './queries';
import { update } from './repo';
import { toast, useApp } from './store';
import { isNative } from './platform';
import { isNativelyScheduled, requestNativePermission, showNativeNow, snoozeNative } from './native';

export function notificationsSupported() {
  return isNative || (typeof window !== 'undefined' && 'Notification' in window);
}

export function pushSupported() {
  return !isNative && typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window;
}

export async function requestNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (isNative) {
    const p = await requestNativePermission();
    return p === 'prompt' ? 'default' : p;
  }
  if (!notificationsSupported()) return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;
  const result = await Notification.requestPermission();
  if (result === 'granted') void ensurePushSubscription();
  return result;
}

function maxActions(): number {
  const n = (Notification as unknown as { maxActions?: number }).maxActions;
  return typeof n === 'number' ? n : 2;
}

let audioCtx: AudioContext | null = null;
/** Short two-tone chime, only while the app is visible (OS sound is controlled by the system). */
function playChime() {
  try {
    audioCtx ??= new AudioContext();
    const t = audioCtx.currentTime;
    for (const [i, f] of [880, 1320].entries()) {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.frequency.value = f;
      gain.gain.setValueAtTime(0.0001, t + i * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.08, t + i * 0.12 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.12 + 0.25);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t + i * 0.12);
      osc.stop(t + i * 0.12 + 0.3);
    }
  } catch {
    // audio unavailable
  }
}

async function show(item: NotifyItem) {
  const settings = await loadSettings();
  await recordDelivered(item, 'local');
  if (isNative) {
    // Android already has an exact alarm for planned items; only show the rest (snoozes, alerts, tests).
    if (!(await isNativelyScheduled(item.id))) await showNativeNow(item);
    return;
  }
  if (settings.notifications.soundType === 'chime' && settings.notifications.sound && document.visibilityState === 'visible') playChime();
  if (!notificationsSupported() || Notification.permission !== 'granted') return;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) await reg.showNotification(item.title, osOptions(item, settings, maxActions()));
    else new Notification(item.title, { body: item.body, tag: item.id, silent: !settings.notifications.sound, icon: '/icon-192.png' });
  } catch {
    // OS notification failed; the notification center still has it
  }
}

async function tick() {
  const { items, settings } = await computeDue();
  if (!settings.onboarded) return;
  for (const item of items) await show(item);
  if (items.length) void flushDeliveryReports();
}

/** Show an event-driven notification (e.g. "All changes synchronized"). */
export async function notifyNow(category: NotificationCategory, title: string, body: string, href = '/') {
  const settings = await loadSettings();
  if (!settings.notifications.categories[category].enabled) return;
  const id = uuid();
  await show({ id, key: `${category}:${id}`, type: category, category, title, body, entityType: null, entityId: null, href, actions: [] });
}

// ---------------------------------------------------------------------------
// Delivery reports → server (prevents duplicate pushes)

let flushing = false;
export async function flushDeliveryReports() {
  if (flushing || !useApp.getState().user || !navigator.onLine) return;
  flushing = true;
  try {
    const pending = (await db.notifications.filter((n) => !n.reported).limit(100).toArray()).filter((n) => !n.key.startsWith('sync:'));
    if (!pending.length) return;
    await api('/api/notifications/delivered', {
      body: {
        deviceId: deviceId(),
        items: pending.map((n) => ({
          key: n.key,
          type: n.type,
          title: n.title.slice(0, 300),
          body: n.body.slice(0, 2000),
          entityType: n.entityType,
          entityId: n.entityId,
          scheduledAt: n.scheduledAt,
          read: !!n.readAt,
        })),
      },
    });
    await db.notifications.bulkUpdate(pending.map((n) => ({ key: n.id, changes: { reported: true } })));
  } catch {
    // retried on the next tick
  } finally {
    flushing = false;
  }
}

// ---------------------------------------------------------------------------
// Quick actions (from OS notifications, the notification center, or ?nact= links)

export interface ActionPayload {
  id?: string;
  key?: string;
  type?: string;
  entityType?: string | null;
  entityId?: string | null;
  href?: string;
  occurrence?: ClassOccurrence;
  date?: string;
  title?: string;
  body?: string;
  actions?: NotifyItem['actions'];
  category?: string;
}

/**
 * Apply a notification action to local data (local-first, then synced).
 * Returns the route to open, if the action needs the app.
 */
export async function performNotificationAction(action: NotificationActionId, p: ActionPayload): Promise<string | null> {
  if (p.id) await markRead([p.id]);
  switch (action) {
    case 'present':
    case 'absent':
    case 'cancelled': {
      if (!p.occurrence?.id || !p.occurrence.subjectId) return p.href ?? '/attendance';
      await markAttendance({ ...p.occurrence, type: p.occurrence.type ?? 'lecture', status: p.occurrence.status ?? null, materialized: true }, action);
      toast(`Attendance recorded: ${action}`, 'success');
      return null;
    }
    case 'complete': {
      if (p.entityType !== 'task' || !p.entityId) return p.href ?? '/tasks';
      const task = await db.entity('task').get(p.entityId);
      if (task && !task.deletedAt) await update('task', task.id, { status: 'done', completedAt: new Date().toISOString() });
      toast('Task completed', 'success');
      return null;
    }
    case 'done': {
      if (p.entityType === 'reminder' && p.entityId) {
        const r = await db.entity('reminder').get(p.entityId);
        const date = p.date ?? todayISO();
        if (r) await update('reminder', r.id, { doneDates: [...new Set([...r.doneDates, date])].slice(-400) });
        return null;
      }
      if (p.entityType === 'revision' && p.entityId) {
        const rev = await db.entity('revisionSchedule').get(p.entityId);
        if (rev && rev.status === 'pending') toast(await completeRevision(rev, 'remembered'), 'success');
        return null;
      }
      if (p.entityType === 'task' && p.entityId) return performNotificationAction('complete', p);
      return p.href ?? '/';
    }
    case 'snooze':
      if (isNative) {
        await snoozeNative(
          {
            id: p.id ?? uuid(),
            key: p.key ?? `snooze:${uuid()}`,
            type: p.type ?? 'reminder',
            category: p.category ?? 'reminders',
            title: p.title ?? 'Reminder',
            body: p.body ?? '',
            entityType: p.entityType ?? null,
            entityId: p.entityId ?? null,
            href: p.href ?? '/',
            actions: p.actions ?? [],
            data: { occurrence: p.occurrence, date: p.date },
          },
          10,
        );
        toast('Snoozed for 10 minutes', 'info');
        return null;
      }
      await snoozeLocal({
        id: p.id ?? uuid(),
        key: p.key ?? `snooze:${uuid()}`,
        type: p.type ?? 'reminder',
        category: p.category ?? 'reminders',
        title: p.title ?? 'Reminder',
        body: p.body ?? '',
        entityType: p.entityType ?? null,
        entityId: p.entityId ?? null,
        href: p.href ?? '/',
        actions: p.actions ?? [],
        data: { occurrence: p.occurrence, date: p.date },
      });
      toast('Snoozed for 10 minutes', 'info');
      return null;
    case 'skip':
      return null;
    case 'start':
    case 'open':
    default:
      return p.href ?? '/';
  }
}

// ---------------------------------------------------------------------------
// Notification center

export async function markRead(ids: string[]) {
  const now = new Date().toISOString();
  const rows = await db.notifications.where('id').anyOf(ids).toArray();
  const unread = rows.filter((r) => !r.readAt);
  if (!unread.length) return;
  await db.notifications.bulkUpdate(unread.map((r) => ({ key: r.id, changes: { readAt: now } })));
  if (useApp.getState().user && navigator.onLine) {
    api('/api/notifications/read', { body: { keys: unread.map((r) => r.key) } }).catch(() => undefined);
  }
}

/** Bring read state from the server, so a notification opened on one device shows as read on the others. */
export async function pullReadState() {
  if (!useApp.getState().user || !navigator.onLine) return;
  try {
    const { notifications } = await api<{ notifications: Array<{ key: string; readAt: string | null }> }>('/api/notifications');
    const read = new Map(notifications.filter((r) => r.readAt).map((r) => [r.key, r.readAt!]));
    if (!read.size) return;
    const local = await db.notifications.where('key').anyOf([...read.keys()]).toArray();
    const changes = local.filter((r) => !r.readAt).map((r) => ({ key: r.id, changes: { readAt: read.get(r.key)! } }));
    if (changes.length) await db.notifications.bulkUpdate(changes);
  } catch {
    // offline or signed out: try again next time
  }
}

export async function markAllRead() {
  const unread = await db.notifications.filter((n) => !n.readAt).toArray();
  await markRead(unread.map((n) => n.id));
}

export async function deleteNotification(id: string) {
  // Keep a tombstone so the scheduler doesn't re-deliver it.
  await db.notifications.update(id, { status: 'dismissed', readAt: new Date().toISOString() });
}

// ---------------------------------------------------------------------------
// Web Push subscription (this device)

function urlBase64ToUint8Array(base64: string) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export type PushState = 'native' | 'unsupported' | 'disabled-server' | 'signed-out' | 'permission-needed' | 'denied' | 'off' | 'on';

export async function pushState(): Promise<PushState> {
  if (isNative) return 'native';
  if (!pushSupported()) return 'unsupported';
  if (!useApp.getState().user) return 'signed-out';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission !== 'granted') return 'permission-needed';
  try {
    const config = await api<{ enabled: boolean }>('/api/push/config');
    if (!config.enabled) return 'disabled-server';
  } catch {
    return 'off';
  }
  const reg = await navigator.serviceWorker.ready;
  return (await reg.pushManager.getSubscription()) ? 'on' : 'off';
}

export async function ensurePushSubscription(): Promise<boolean> {
  if (!pushSupported() || !useApp.getState().user || Notification.permission !== 'granted' || !navigator.onLine) return false;
  if ((await kvGet<boolean>('push.optOut')) === true) return false;
  try {
    const config = await api<{ enabled: boolean; publicKey: string | null }>('/api/push/config');
    if (!config.enabled || !config.publicKey) return false;
    const reg = await navigator.serviceWorker.ready;
    const sub =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(config.publicKey) }));
    await api('/api/push/subscribe', { body: { deviceId: deviceId(), subscription: sub.toJSON() } });
    return true;
  } catch {
    return false;
  }
}

export async function enablePush() {
  await kvSet('push.optOut', false);
  const perm = await requestNotificationPermission();
  if (perm !== 'granted') return false;
  return ensurePushSubscription();
}

export async function disablePush() {
  await kvSet('push.optOut', true);
  const reg = await navigator.serviceWorker?.ready;
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await api('/api/push/unsubscribe', { body: { endpoint: sub.endpoint } }).catch(() => undefined);
    await sub.unsubscribe();
  }
}

export async function sendTestNotification() {
  await notifyNow('reminders', '🔔 Test notification', 'Notifications are working on this device.', '/notifications');
}

// ---------------------------------------------------------------------------

async function registerPeriodicSync() {
  try {
    const reg = (await navigator.serviceWorker?.ready) as ServiceWorkerRegistration & {
      periodicSync?: { register(tag: string, opts: { minInterval: number }): Promise<void> };
    };
    if (!reg?.periodicSync) return;
    const status = await navigator.permissions.query({ name: 'periodic-background-sync' as PermissionName });
    if (status.state === 'granted') await reg.periodicSync.register('sos-notify', { minInterval: 15 * 60_000 });
  } catch {
    // unsupported
  }
}

let started = false;
export function startNotificationScheduler() {
  if (started) return;
  started = true;
  // The service worker can't read localStorage; give it the device id.
  void kvSet('deviceId', deviceId());
  const run = () => void tick().catch((e) => console.warn('notification tick failed', e));
  run();
  setInterval(run, 30_000);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && (run(), void pullReadState()));
  void pullReadState();
  window.addEventListener('online', () => void flushDeliveryReports());
  if (!isNative) void registerPeriodicSync();
}

/** Keep the user's timezone in settings so server-sent reminders arrive at local wall-clock times. */
export async function syncTimezone() {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const s = await loadSettings();
  if (tz && s.onboarded && s.timezone !== tz) {
    const { saveSettings } = await import('./repo');
    await saveSettings({ timezone: tz });
  }
}

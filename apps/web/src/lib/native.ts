/**
 * Android-specific runtime (Capacitor).
 *
 * Reminders: the same planner that drives web notifications is used to
 * schedule real Android alarms (exact, allowed while idle) for the next few
 * days. They fire with the app closed, the phone offline, or after a reboot,
 * and are re-planned whenever local data changes, a sync brings in changes,
 * or the app comes back to the foreground.
 */
import { App } from '@capacitor/app';
import { LocalNotifications, type LocalNotificationSchema } from '@capacitor/local-notifications';
import { localMomentNow, planNotifications, type NotificationActionId, type PlannedNotification } from '@student-os/core';
import { db, kvGet, kvSet } from './db';
import { recordDelivered, toItem, type NotifyItem } from './notify-core';
import { isNative } from './platform';
import { loadPlannerData, loadSettings } from './queries';
import { addDataListener } from './repo';

const HORIZON_HOURS = 72;
/** Android allows ~500 alarms per app; stay well below and re-plan often. */
const MAX_SCHEDULED = 60;
const SCHEDULED_KEY = 'native.scheduled';

interface ScheduledEntry {
  nid: number;
  at: string;
  item: NotifyItem;
}

/** Stable positive 31-bit id for an Android notification, from our uuid. */
export function nativeId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) & 0x7fffffff || 1;
}

const ACTION_TYPES: Array<{ id: string; actions: Array<{ id: NotificationActionId; title: string }> }> = [
  { id: 'attendance', actions: [{ id: 'present', title: '✓ Present' }, { id: 'absent', title: '✕ Absent' }, { id: 'cancelled', title: '⚠ Cancelled' }] },
  { id: 'class', actions: [{ id: 'present', title: 'Mark present' }] },
  { id: 'task', actions: [{ id: 'complete', title: 'Complete' }, { id: 'snooze', title: 'Snooze 10 min' }] },
  { id: 'revision', actions: [{ id: 'done', title: 'Done' }, { id: 'snooze', title: 'Snooze 10 min' }] },
  { id: 'reminder', actions: [{ id: 'done', title: 'Done' }, { id: 'snooze', title: 'Snooze 10 min' }] },
  { id: 'study', actions: [{ id: 'skip', title: 'Skip' }] },
];

function actionTypeFor(item: NotifyItem): string | undefined {
  switch (item.type) {
    case 'attendance_prompt':
      return 'attendance';
    case 'class_reminder':
      return 'class';
    case 'task_due':
      return 'task';
    case 'revision_due':
      return item.entityId ? 'revision' : undefined;
    case 'reminder':
      return 'reminder';
    case 'study_session':
      return 'study';
    default:
      return undefined;
  }
}

/** Android channels can't change sound/vibration after creation, so each combination gets its own. */
const CHANNELS = [
  { id: 'sos-alerts', name: 'Reminders', description: 'Classes, attendance, revisions and deadlines', importance: 4 as const, vibration: true },
  { id: 'sos-alerts-novibrate', name: 'Reminders (no vibration)', description: 'Reminders with sound but no vibration', importance: 4 as const, vibration: false },
  { id: 'sos-silent', name: 'Reminders (silent)', description: 'Reminders without sound', importance: 2 as const, vibration: false },
];

async function channelFor(): Promise<string> {
  const n = (await loadSettings()).notifications;
  if (!n.sound) return 'sos-silent';
  return n.vibration ? 'sos-alerts' : 'sos-alerts-novibrate';
}

function toNative(item: NotifyItem, at: Date, channelId: string): LocalNotificationSchema {
  return {
    id: nativeId(item.id),
    title: item.title,
    body: item.body,
    largeBody: item.body,
    schedule: { at, allowWhileIdle: true },
    channelId,
    actionTypeId: actionTypeFor(item),
    autoCancel: true,
    group: item.category,
    extra: item,
  };
}

const plannedAt = (n: Pick<PlannedNotification, 'date' | 'time'>) => new Date(`${n.date}T${n.time}:00`);

// ---------------------------------------------------------------------------

export async function nativePermission(): Promise<'granted' | 'denied' | 'prompt'> {
  const p = await LocalNotifications.checkPermissions();
  return p.display === 'granted' ? 'granted' : p.display === 'denied' ? 'denied' : 'prompt';
}

export async function requestNativePermission(): Promise<'granted' | 'denied' | 'prompt'> {
  const p = await LocalNotifications.requestPermissions();
  if (p.display === 'granted') void reschedule();
  return p.display === 'granted' ? 'granted' : p.display === 'denied' ? 'denied' : 'prompt';
}

/** Android 12+: exact alarms need a separate "Alarms & reminders" permission. */
export async function exactAlarmStatus(): Promise<'granted' | 'denied' | 'prompt'> {
  try {
    const s = await LocalNotifications.checkExactNotificationSetting();
    return s.exact_alarm === 'granted' ? 'granted' : s.exact_alarm === 'denied' ? 'denied' : 'prompt';
  } catch {
    return 'granted';
  }
}

export async function openExactAlarmSettings() {
  await LocalNotifications.changeExactNotificationSetting();
}

let rescheduling: Promise<number> | null = null;
let again = false;

/** Re-plan and (re)register Android alarms for the next few days. Returns how many are scheduled. */
export function reschedule(): Promise<number> {
  if (!isNative) return Promise.resolve(0);
  if (rescheduling) {
    again = true;
    return rescheduling;
  }
  rescheduling = doReschedule().finally(() => {
    rescheduling = null;
    if (again) {
      again = false;
      void reschedule();
    }
  });
  return rescheduling;
}

async function doReschedule(): Promise<number> {
  if ((await nativePermission()) !== 'granted') return 0;
  await recordFired();
  const data = await loadPlannerData();
  const pending = await LocalNotifications.getPending();
  if (pending.notifications.length) await LocalNotifications.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) });
  if (!data.settings.onboarded) {
    await kvSet(SCHEDULED_KEY, []);
    return 0;
  }
  const now = new Date();
  const planned = planNotifications(data, localMomentNow(now), 0, HORIZON_HOURS * 60)
    .filter((n) => n.category !== 'sync' && n.type !== 'attendance_risk' && plannedAt(n).getTime() > now.getTime() + 5000);
  const shown = new Set((await db.notifications.where('id').anyOf(planned.map((n) => n.id)).toArray()).map((n) => n.id));
  const toSchedule = planned.filter((n) => !shown.has(n.id)).slice(0, MAX_SCHEDULED);

  // Snoozes scheduled earlier survive re-planning.
  const previous = ((await kvGet<ScheduledEntry[]>(SCHEDULED_KEY)) ?? []).filter((e) => e.item.key.includes(':snooze:') && Date.parse(e.at) > now.getTime());
  const channelId = await channelFor();
  const entries: ScheduledEntry[] = [
    ...toSchedule.map((n) => ({ nid: nativeId(n.id), at: plannedAt(n).toISOString(), item: toItem(n) })),
    ...previous,
  ];
  if (entries.length) {
    await LocalNotifications.schedule({ notifications: entries.map((e) => toNative(e.item, new Date(e.at), channelId)) });
  }
  await kvSet(SCHEDULED_KEY, entries);
  return entries.length;
}

/** Notifications Android showed while the app was closed → notification center. */
async function recordFired() {
  const entries = (await kvGet<ScheduledEntry[]>(SCHEDULED_KEY)) ?? [];
  const now = Date.now();
  for (const e of entries) {
    if (Date.parse(e.at) > now) continue;
    if (!(await db.notifications.get(e.item.id))) await recordDelivered(e.item, 'local', new Date(e.at));
  }
}

/** True when Android already has (or showed) this notification, so the in-app scheduler must not repeat it. */
export async function isNativelyScheduled(id: string): Promise<boolean> {
  const entries = (await kvGet<ScheduledEntry[]>(SCHEDULED_KEY)) ?? [];
  return entries.some((e) => e.item.id === id);
}

/** Show a notification right away (state-based alerts, test notifications). */
export async function showNativeNow(item: NotifyItem) {
  if ((await nativePermission()) !== 'granted') return;
  await LocalNotifications.schedule({ notifications: [toNative(item, new Date(Date.now() + 1000), await channelFor())] });
}

export async function snoozeNative(item: NotifyItem, minutes: number) {
  const at = new Date(Date.now() + minutes * 60_000);
  const snoozed: NotifyItem = { ...item, id: `${item.id.slice(0, 24)}-${at.getTime().toString(36)}`, key: `${item.key}:snooze:${at.getTime()}` };
  await LocalNotifications.schedule({ notifications: [toNative(snoozed, at, await channelFor())] });
  const entries = (await kvGet<ScheduledEntry[]>(SCHEDULED_KEY)) ?? [];
  await kvSet(SCHEDULED_KEY, [...entries, { nid: nativeId(snoozed.id), at: at.toISOString(), item: snoozed }]);
}

export interface NativeHandlers {
  onAction(action: NotificationActionId, payload: NotifyItem & Record<string, unknown>): Promise<string | null>;
  onResume(): void;
}

/** Wire notifications, lifecycle and the hardware back button. Call once at startup. */
export async function initNative(handlers: NativeHandlers) {
  if (!isNative) return;
  try {
    await LocalNotifications.registerActionTypes({ types: ACTION_TYPES });
    for (const c of CHANNELS) {
      await LocalNotifications.createChannel({ ...c, visibility: 1, lights: true, lightColor: '#4f46e5' });
    }
  } catch (e) {
    console.warn('notification setup failed', e);
  }

  await LocalNotifications.addListener('localNotificationActionPerformed', async ({ actionId, notification }) => {
    const item = (notification.extra ?? {}) as NotifyItem & Record<string, unknown>;
    if (!item.id) return;
    // It may have fired while the app was closed: record it before marking it read.
    if (!(await db.notifications.get(item.id))) await recordDelivered(item, 'local');
    await db.notifications.update(item.id, { readAt: new Date().toISOString() });
    const action = (actionId === 'tap' ? 'open' : actionId) as NotificationActionId;
    const href = await handlers.onAction(action, { ...item, ...(item.data ?? {}) });
    if (href) window.dispatchEvent(new CustomEvent('sos-navigate', { detail: href }));
  });
  await LocalNotifications.addListener('localNotificationReceived', (n) => {
    const item = n.extra as NotifyItem | undefined;
    if (item?.id) {
      void db.notifications.get(item.id).then((x) => {
        if (!x) void recordDelivered(item, 'local');
      });
    }
  });

  await App.addListener('appStateChange', ({ isActive }) => {
    if (isActive) handlers.onResume();
    void reschedule();
  });
  await App.addListener('backButton', ({ canGoBack }) => {
    if (document.querySelector('dialog[open]')) {
      (document.querySelector('dialog[open]') as HTMLDialogElement).close();
    } else if (canGoBack) {
      window.history.back();
    } else {
      void App.minimizeApp();
    }
  });

  // Re-plan whenever data changes (local edits or synced changes), debounced.
  let timer: ReturnType<typeof setTimeout> | null = null;
  addDataListener(() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void reschedule(), 2000);
  });
  // And periodically while open, so the 3-day window keeps rolling forward.
  setInterval(() => void reschedule(), 30 * 60_000);
  void reschedule();
}

/**
 * Notification logic that runs both in the page and in the service worker
 * (no DOM, no React). Plans from local data, so reminders never need the network.
 */
import { dueNow, localMomentNow, planNotifications, type NotificationAction, type PlannedNotification, type Settings } from '@student-os/core';
import { db, kvGet, kvSet, type AppNotification } from './db';
import { loadPlannerData } from './queries';

/** The subset of a planned notification needed to show it and act on it. */
export interface NotifyItem {
  id: string;
  key: string;
  type: string;
  category: string;
  title: string;
  body: string;
  entityType: string | null;
  entityId: string | null;
  href: string;
  actions: NotificationAction[];
  data?: Record<string, unknown>;
  /** Present on push notifications: signed token for server-side quick actions. */
  token?: string;
}

interface Snoozed {
  until: string;
  item: NotifyItem;
}

const SNOOZE_KEY = 'notify.snoozed';
export const DEFAULT_SNOOZE_MINUTES = 10;

export function toItem(n: PlannedNotification): NotifyItem {
  return {
    id: n.id,
    key: n.key,
    type: n.type,
    category: n.category,
    title: n.title,
    body: n.body,
    entityType: n.entityType,
    entityId: n.entityId,
    href: n.href,
    actions: n.actions,
    data: n.data,
  };
}

/** Planned notifications that are due now and haven't been shown on this device, plus due snoozes. */
export async function computeDue(now: Date = new Date()): Promise<{ items: NotifyItem[]; settings: Settings }> {
  const data = await loadPlannerData();
  const moment = localMomentNow(now);
  const due = dueNow(planNotifications(data, moment, 180), moment).filter((n) => n.category !== 'sync');
  const seen = new Set((await db.notifications.where('id').anyOf(due.map((n) => n.id)).toArray()).map((n) => n.id));
  const items = due.filter((n) => !seen.has(n.id)).map(toItem);
  items.push(...(await takeDueSnoozes(now)));
  return { items, settings: data.settings };
}

/** What's coming up (for the notification center's "Scheduled" view). */
export async function upcoming(hours = 24, now: Date = new Date()): Promise<PlannedNotification[]> {
  const data = await loadPlannerData();
  const moment = localMomentNow(now);
  return planNotifications(data, moment, 0, hours * 60).filter((n) => n.category !== 'sync' && n.type !== 'attendance_risk');
}

export async function recordDelivered(item: NotifyItem, channel: 'local' | 'push', at: Date = new Date()): Promise<AppNotification> {
  const record: AppNotification = {
    id: item.id,
    key: item.key,
    type: item.type,
    category: item.category,
    title: item.title,
    body: item.body,
    entityType: item.entityType,
    entityId: item.entityId,
    scheduledAt: at.toISOString(),
    status: 'delivered',
    deliveredAt: at.toISOString(),
    readAt: null,
    actionable: item.actions.some((a) => a.action !== 'open'),
    channel,
    href: item.href,
    data: { ...(item.data ?? {}), actions: item.actions, token: item.token },
    reported: channel === 'push',
  };
  await db.notifications.put(record);
  return record;
}

export async function snoozeLocal(item: NotifyItem, minutes = DEFAULT_SNOOZE_MINUTES, now: Date = new Date()) {
  const list = (await kvGet<Snoozed[]>(SNOOZE_KEY)) ?? [];
  const id = `${item.id.slice(0, 24)}-${now.getTime().toString(36)}`;
  list.push({ until: new Date(now.getTime() + minutes * 60_000).toISOString(), item: { ...item, id, key: `${item.key}:snooze:${now.getTime()}` } });
  await kvSet(SNOOZE_KEY, list.slice(-50));
}

async function takeDueSnoozes(now: Date): Promise<NotifyItem[]> {
  const list = (await kvGet<Snoozed[]>(SNOOZE_KEY)) ?? [];
  const due = list.filter((s) => Date.parse(s.until) <= now.getTime());
  if (due.length) await kvSet(SNOOZE_KEY, list.filter((s) => Date.parse(s.until) > now.getTime()));
  return due.map((s) => s.item);
}

/** OS notification options. Sound/vibration follow the student's settings; the OS has the final say. */
export function osOptions(item: NotifyItem, settings: Settings, maxActions: number, renotify = true): NotificationOptions & Record<string, unknown> {
  const n = settings.notifications;
  return {
    body: item.body,
    tag: item.id,
    renotify,
    silent: !n.sound,
    vibrate: n.vibration ? [180, 80, 180] : [],
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    timestamp: Date.now(),
    requireInteraction: item.type === 'attendance_prompt',
    actions: item.actions.slice(0, Math.max(0, maxActions)),
    data: { ...item },
  };
}

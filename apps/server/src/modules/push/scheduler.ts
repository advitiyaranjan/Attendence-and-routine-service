/**
 * Server push scheduler — delivers reminders while the app (or browser) is closed.
 *
 * Every minute, for each user with a push subscription:
 *   1. load their synced data and compute local wall-clock time in their timezone
 *   2. run the shared planner (same code as the app) for what's due now
 *   3. push to each subscribed device that hasn't already shown it
 *
 * Devices report notifications they showed locally (POST /api/notifications/delivered),
 * and pushes wait a short grace period after the due time, so a device with the
 * app open isn't notified twice. A unique (userId, key) row per notification plus a
 * (notification, device) delivery row make duplicates impossible across restarts
 * and multiple server instances.
 */
import type { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import {
  dueNow,
  localMomentIn,
  planNotifications,
  toStamp,
  type PlannedNotification,
  type PlannerData,
  type Settings,
} from '@student-os/core';
import { env } from '../../env';
import { storeFor, type Tx } from '../sync/store';
import type { PushSender } from './sender';

/** Minutes after the due time before the server pushes (gives open apps time to deliver locally). */
export const PUSH_GRACE_MINUTES = 1;
const ACTION_TOKEN_TTL = '3d';

export interface ActionTokenClaims {
  sub: string;
  key: string;
  type: string;
  entityType: string | null;
  entityId: string | null;
  occurrence?: Record<string, unknown>;
  date?: string;
  payload: Record<string, unknown>;
}

export function signActionToken(userId: string, n: Pick<PlannedNotification, 'key' | 'type' | 'entityType' | 'entityId' | 'data'>, payload: Record<string, unknown>): string {
  const claims: ActionTokenClaims = {
    sub: userId,
    key: n.key,
    type: n.type,
    entityType: n.entityType,
    entityId: n.entityId,
    occurrence: n.data?.occurrence as Record<string, unknown> | undefined,
    date: n.data?.date as string | undefined,
    payload,
  };
  return jwt.sign(claims, env.JWT_SECRET, { expiresIn: ACTION_TOKEN_TTL, audience: 'notification-action', algorithm: 'HS256' });
}

export function verifyActionToken(token: string): ActionTokenClaims | null {
  try {
    return jwt.verify(token, env.JWT_SECRET, { audience: 'notification-action', algorithms: ['HS256'] }) as ActionTokenClaims;
  } catch {
    return null;
  }
}

export async function loadPlannerData(prisma: PrismaClient, userId: string, today: string): Promise<PlannerData | null> {
  const tx = prisma as unknown as Tx;
  const [settings] = await storeFor('settings').findAll(tx, userId);
  if (!settings) return null;
  const all = (entity: Parameters<typeof storeFor>[0], where?: Record<string, unknown>) => storeFor(entity).findAll(tx, userId, where);
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - 400 * 86_400_000).toISOString().slice(0, 10);
  const [subjects, schedules, instances, tasks, revisions, topics, exams, assignments, events, reminders, baskets] = await Promise.all([
    all('subject'),
    all('classSchedule'),
    all('classInstance', { date: { gte: since } }),
    all('task', { status: { not: 'done' } }),
    all('revisionSchedule', { status: 'pending' }),
    all('topic'),
    all('exam'),
    all('assignment'),
    all('calendarEvent'),
    all('reminder'),
    all('basket'),
  ]);
  return { settings, subjects, schedules, instances, tasks, revisions, topics, exams, assignments, events, reminders, baskets } as unknown as PlannerData;
}

export interface PushPayload {
  id: string;
  key: string;
  type: string;
  category: string;
  title: string;
  body: string;
  href: string;
  actions: PlannedNotification['actions'];
  data: Record<string, unknown>;
  token: string;
  silent: boolean;
  vibrate: boolean;
}

export class PushScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private prisma: PrismaClient,
    private sender: PushSender,
    private clock: () => Date = () => new Date(),
  ) {}

  start(intervalMs = 60_000) {
    if (!this.sender.enabled || this.timer) return;
    this.timer = setInterval(() => void this.tick().catch((e) => console.error('push tick failed', e)), intervalMs);
    void this.tick().catch((e) => console.error('push tick failed', e));
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One scheduling pass. Returns the number of pushes sent. */
  async tick(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const users = await this.prisma.pushSubscription.findMany({ distinct: ['userId'], select: { userId: true } });
      let sent = 0;
      for (const { userId } of users) sent += await this.tickUser(userId);
      sent += await this.sendSnoozed();
      return sent;
    } finally {
      this.running = false;
    }
  }

  async tickUser(userId: string): Promise<number> {
    const now = this.clock();
    const [settingsRow] = await storeFor('settings').findAll(this.prisma as unknown as Tx, userId);
    const tz = (settingsRow as Settings | undefined)?.timezone ?? 'UTC';
    const moment = localMomentIn(tz, now);
    const data = await loadPlannerData(this.prisma, userId, moment.date);
    if (!data) return 0;
    const nowStamp = toStamp(moment.date, moment.minutes);
    const due = dueNow(planNotifications(data, moment, 180), moment).filter((n) => n.stamp <= nowStamp - PUSH_GRACE_MINUTES && n.category !== 'sync');
    let sent = 0;
    for (const n of due) {
      const scheduledAt = new Date(now.getTime() - (nowStamp - n.stamp) * 60_000);
      sent += await this.deliver(userId, n, scheduledAt, data.settings);
    }
    return sent;
  }

  /** Push one notification to every device of the user that hasn't shown it yet. */
  async deliver(userId: string, n: PlannedNotification, scheduledAt: Date, settings: Settings): Promise<number> {
    const row = await this.prisma.notification.upsert({
      where: { userId_key: { userId, key: n.key } },
      create: {
        userId,
        key: n.key,
        type: n.type,
        title: n.title,
        body: n.body,
        entityType: n.entityType,
        entityId: n.entityId,
        scheduledAt,
        status: 'delivered',
        deliveredAt: new Date(),
        actionable: n.actions.some((a) => a.action !== 'open'),
      },
      update: {},
      include: { deliveries: true },
    });
    const delivered = new Set(row.deliveries.map((d) => d.deviceId));
    const subs = await this.prisma.pushSubscription.findMany({ where: { userId } });
    const targets = subs.filter((s) => !delivered.has(s.deviceId));
    if (!targets.length) return 0;

    const payload: PushPayload = {
      id: n.id,
      key: n.key,
      type: n.type,
      category: n.category,
      title: n.title,
      body: n.body,
      href: n.href,
      actions: n.actions,
      data: n.data ?? {},
      token: '',
      silent: !settings.notifications.sound,
      vibrate: settings.notifications.vibration,
    };
    payload.token = signActionToken(userId, n, { ...payload, token: undefined });
    const ttl = Math.max(60, Math.min(86_400, (n.expiresAt - n.stamp) * 60));
    return this.sendTo(row.id, targets, payload, ttl);
  }

  private async sendTo(notificationId: string, targets: Array<{ id: string; deviceId: string; endpoint: string; p256dh: string; auth: string }>, payload: PushPayload, ttl: number) {
    let sent = 0;
    for (const sub of targets) {
      // Claim the delivery first; a concurrent scheduler instance loses the race and skips.
      try {
        await this.prisma.notificationDelivery.create({ data: { notificationId, deviceId: sub.deviceId, channel: 'push' } });
      } catch {
        continue;
      }
      const result = await this.sender.send(sub, payload, ttl);
      if (result === 'ok') {
        sent++;
        await this.prisma.pushSubscription.update({ where: { id: sub.id }, data: { lastSuccessAt: new Date(), failures: 0 } });
      } else if (result === 'gone') {
        await this.prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => undefined);
      } else {
        const updated = await this.prisma.pushSubscription.update({ where: { id: sub.id }, data: { failures: { increment: 1 } } });
        if (updated.failures >= 10) await this.prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => undefined);
        // Release the claim so the next tick retries.
        await this.prisma.notificationDelivery.delete({ where: { notificationId_deviceId: { notificationId, deviceId: sub.deviceId } } }).catch(() => undefined);
      }
    }
    return sent;
  }

  /** Snoozed notifications are stored with status "scheduled" and a future scheduledAt. */
  private async sendSnoozed(): Promise<number> {
    const due = await this.prisma.notification.findMany({ where: { status: 'scheduled', scheduledAt: { lte: this.clock() } }, take: 200 });
    let sent = 0;
    for (const row of due) {
      await this.prisma.notification.update({ where: { id: row.id }, data: { status: 'delivered', deliveredAt: new Date() } });
      const subs = await this.prisma.pushSubscription.findMany({ where: { userId: row.userId } });
      const payload = { ...(row.payload as unknown as PushPayload) };
      sent += await this.sendTo(row.id, subs, payload, 3600);
    }
    return sent;
  }
}

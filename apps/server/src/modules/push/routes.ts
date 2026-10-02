import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { instanceIdFor, isoDate } from '@student-os/core';
import { prisma } from '../../db';
import { HttpError, parseBody } from '../../lib/http';
import { requireAuth } from '../../middleware/auth';
import { SyncService } from '../sync/service';
import { verifyActionToken, type PushPayload } from './scheduler';
import type { PushSender } from './sender';

const sync = new SyncService(prisma);

export function pushRouter(sender: PushSender) {
  const router = Router();

  router.get('/push/config', (_req, res) => {
    res.json({ enabled: sender.enabled, publicKey: sender.publicKey });
  });

  router.post('/push/subscribe', requireAuth, async (req, res) => {
    if (!sender.enabled) throw new HttpError(501, 'push_disabled', 'Push notifications are not configured on this server.');
    const body = parseBody(
      z.object({
        deviceId: z.string().min(1).max(64),
        subscription: z.object({ endpoint: z.string().url().max(2000), keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }) }),
      }),
      req.body,
    );
    const data = {
      userId: req.userId!,
      deviceId: body.deviceId,
      p256dh: body.subscription.keys.p256dh,
      auth: body.subscription.keys.auth,
      userAgent: req.get('user-agent')?.slice(0, 300) ?? null,
      failures: 0,
    };
    await prisma.pushSubscription.upsert({ where: { endpoint: body.subscription.endpoint }, create: { endpoint: body.subscription.endpoint, ...data }, update: data });
    res.json({ ok: true });
  });

  router.post('/push/unsubscribe', requireAuth, async (req, res) => {
    const { endpoint } = parseBody(z.object({ endpoint: z.string().max(2000) }), req.body);
    await prisma.pushSubscription.deleteMany({ where: { endpoint, userId: req.userId! } });
    res.json({ ok: true });
  });

  /** Devices report what they showed locally, so the server never pushes it to them again. */
  router.post('/notifications/delivered', requireAuth, async (req, res) => {
    const body = parseBody(
      z.object({
        deviceId: z.string().min(1).max(64),
        items: z
          .array(
            z.object({
              key: z.string().min(1).max(300),
              type: z.string().max(40),
              title: z.string().max(300),
              body: z.string().max(2000),
              entityType: z.string().max(40).nullable(),
              entityId: z.string().max(64).nullable(),
              scheduledAt: z.string().max(40),
              read: z.boolean().optional(),
            }),
          )
          .max(100),
      }),
      req.body,
    );
    for (const item of body.items) {
      const scheduledAt = Number.isNaN(Date.parse(item.scheduledAt)) ? new Date() : new Date(item.scheduledAt);
      const row = await prisma.notification.upsert({
        where: { userId_key: { userId: req.userId!, key: item.key } },
        create: {
          userId: req.userId!,
          key: item.key,
          type: item.type,
          title: item.title,
          body: item.body,
          entityType: item.entityType,
          entityId: item.entityId,
          scheduledAt,
          status: 'delivered',
          deliveredAt: new Date(),
          readAt: item.read ? new Date() : null,
        },
        update: item.read ? { readAt: new Date() } : {},
      });
      await prisma.notificationDelivery
        .create({ data: { notificationId: row.id, deviceId: body.deviceId, channel: 'local' } })
        .catch(() => undefined); // already recorded
    }
    res.json({ ok: true });
  });

  router.get('/notifications', requireAuth, async (req, res) => {
    const rows = await prisma.notification.findMany({
      where: { userId: req.userId!, status: 'delivered' },
      orderBy: { scheduledAt: 'desc' },
      take: 100,
      select: { key: true, type: true, title: true, body: true, entityType: true, entityId: true, scheduledAt: true, readAt: true },
    });
    res.json({ notifications: rows });
  });

  router.post('/notifications/read', requireAuth, async (req, res) => {
    const { keys } = parseBody(z.object({ keys: z.array(z.string().max(300)).max(500) }), req.body);
    await prisma.notification.updateMany({ where: { userId: req.userId!, key: { in: keys }, readAt: null }, data: { readAt: new Date() } });
    res.json({ ok: true });
  });

  /**
   * Quick action tapped on a push notification (Present / Absent / Complete / Done / Snooze).
   * Requires both a valid session cookie and a signed action token for the same user,
   * then applies the change through the normal sync path so every device receives it.
   */
  router.post('/notifications/action', requireAuth, async (req, res) => {
    const body = parseBody(
      z.object({
        token: z.string().min(10).max(8000),
        action: z.enum(['present', 'absent', 'cancelled', 'complete', 'done', 'snooze', 'skip', 'open']),
        minutes: z.number().int().min(5).max(24 * 60).optional(),
      }),
      req.body,
    );
    const claims = verifyActionToken(body.token);
    if (!claims || claims.sub !== req.userId) throw new HttpError(403, 'invalid_action', 'This notification action has expired. Open the app instead.');
    const userId = req.userId!;
    const markedAt = new Date().toISOString();

    switch (body.action) {
      case 'present':
      case 'absent':
      case 'cancelled': {
        const occ = claims.occurrence as
          | { id: string; scheduleId: string | null; subjectId: string; date: string; startTime: string; endTime: string; room: string | null; isExtra: boolean; rescheduledFromId: string | null; rescheduledToId: string | null }
          | undefined;
        if (!occ || claims.entityType !== 'class_instance') throw new HttpError(400, 'invalid_action', 'This notification is not about a class.');
        // Re-derive the deterministic id rather than trusting the payload blindly.
        if (occ.scheduleId && !occ.isExtra && instanceIdFor(occ.scheduleId, occ.date) !== occ.id) throw new HttpError(400, 'invalid_action', 'Unknown class.');
        parseBody(z.object({ date: isoDate }), { date: occ.date });
        const result = await sync.serverWrite(userId, 'classInstance', occ.id, (current) => ({
          ...(current ?? {}),
          scheduleId: occ.scheduleId,
          subjectId: occ.subjectId,
          date: occ.date,
          startTime: occ.startTime,
          endTime: occ.endTime,
          room: occ.room,
          isExtra: occ.isExtra,
          rescheduledFromId: occ.rescheduledFromId,
          rescheduledToId: occ.rescheduledToId,
          status: body.action,
        }));
        if (result?.status === 'rejected') throw new HttpError(400, 'invalid_action', result.error ?? 'Could not record attendance.');
        await sync.serverWrite(userId, 'attendanceRecord', randomUUID(), () => ({
          instanceId: occ.id,
          subjectId: occ.subjectId,
          date: occ.date,
          status: body.action,
          markedAt,
        }));
        break;
      }
      case 'complete': {
        if (claims.entityType !== 'task' || !claims.entityId) throw new HttpError(400, 'invalid_action', 'Not a task.');
        const result = await sync.serverWrite(userId, 'task', claims.entityId, (current) => (current && !current.deletedAt ? { ...current, status: 'done', completedAt: markedAt } : null));
        if (!result) throw new HttpError(404, 'not_found', 'That task no longer exists.');
        break;
      }
      case 'done': {
        if (claims.entityType === 'reminder' && claims.entityId && claims.date) {
          await sync.serverWrite(userId, 'reminder', claims.entityId, (current) =>
            current ? { ...current, doneDates: [...new Set([...((current.doneDates as string[]) ?? []), claims.date!])].slice(-400) } : null,
          );
        } else if (claims.entityType === 'task' && claims.entityId) {
          await sync.serverWrite(userId, 'task', claims.entityId, (current) => (current ? { ...current, status: 'done', completedAt: markedAt } : null));
        } else {
          throw new HttpError(400, 'needs_app', 'Open the app to finish this.');
        }
        break;
      }
      case 'snooze': {
        const minutes = body.minutes ?? 10;
        const payload = claims.payload as unknown as PushPayload;
        await prisma.notification.create({
          data: {
            userId,
            key: `${claims.key}:snooze:${Date.now()}`,
            type: claims.type,
            title: payload.title,
            body: payload.body,
            entityType: claims.entityType,
            entityId: claims.entityId,
            scheduledAt: new Date(Date.now() + minutes * 60_000),
            status: 'scheduled',
            payload: { ...payload, token: body.token } as object,
          },
        });
        break;
      }
      case 'skip':
      case 'open': // tapped: just mark it read
        break;
    }
    await prisma.notification.updateMany({ where: { userId, key: claims.key }, data: { readAt: new Date() } });
    res.json({ ok: true });
  });

  return router;
}

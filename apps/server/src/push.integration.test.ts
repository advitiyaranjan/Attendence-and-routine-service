/**
 * Push scheduler + notification actions against a real Postgres.
 * Runs only when TEST_DATABASE_URL is set (e.g. a throwaway local database).
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { SyncOperation } from '@student-os/core';

const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;

if (!url) it.skip('push scheduler (database): set TEST_DATABASE_URL to run', () => {});
else describe('push scheduler (database)', async () => {
  const { prisma } = await import('./db');
  const { SyncService } = await import('./modules/sync/service');
  const { PushScheduler } = await import('./modules/push/scheduler');
  const { createApp } = await import('./app');
  const { env } = await import('./env');
  const { instanceIdFor } = await import('@student-os/core');

  const sent: Array<{ endpoint: string; payload: { key: string; type: string; token: string; title: string } }> = [];
  const sender = {
    enabled: true,
    publicKey: 'test',
    async send(target: { endpoint: string }, payload: unknown) {
      if (target.endpoint.includes('gone')) return 'gone' as const;
      sent.push({ endpoint: target.endpoint, payload: payload as never });
      return 'ok' as const;
    },
  };
  // Friday 2 Oct 2026, 09:46 UTC: the 15-minute reminder for a 10:00 class is due (plus 1 min grace).
  let now = new Date('2026-10-02T09:46:00Z');
  const scheduler = new PushScheduler(prisma, sender, () => now);
  const sync = new SyncService(prisma);

  const user = await prisma.user.create({ data: { email: `push-${Date.now()}@example.com` } });
  const meta = (id: string) => ({ id, createdAt: now.toISOString(), updatedAt: now.toISOString(), deletedAt: null, version: 0, deviceId: 'dev-A', syncStatus: 'pending' });
  const op = (entity: SyncOperation['entity'], payload: Record<string, unknown>): SyncOperation => ({
    operationId: randomUUID(), entity, entityId: payload.id as string, operation: 'upsert', payload, baseVersion: 0, timestamp: now.toISOString(), deviceId: 'dev-A',
  });
  const subjectId = randomUUID();
  const scheduleId = randomUUID();
  for (const o of [
    op('settings', { ...meta('settings'), onboarded: true, timezone: 'UTC', semesterStart: '2026-09-07', notifications: { categories: { aiSuggestions: { enabled: false }, revision: { enabled: false } } } }),
    op('subject', { ...meta(subjectId), name: 'Operating Systems' }),
    op('classSchedule', { ...meta(scheduleId), subjectId, weekday: 5, startTime: '10:00', endTime: '11:00', room: 'B-204' }),
  ]) {
    expect((await sync.applyOperation(user.id, o)).status).toBe('applied');
  }
  await prisma.pushSubscription.createMany({
    data: [
      { userId: user.id, deviceId: 'dev-A', endpoint: `https://push.test/A-${user.id}`, p256dh: 'k', auth: 'a' },
      { userId: user.id, deviceId: 'dev-B', endpoint: `https://push.test/B-${user.id}`, p256dh: 'k', auth: 'a' },
      { userId: user.id, deviceId: 'dev-C', endpoint: `https://push.test/gone-${user.id}`, p256dh: 'k', auth: 'a' },
    ],
  });

  it('pushes only to devices that have not shown the notification locally', async () => {
    // Device A had the app open and already showed the reminder.
    const occId = instanceIdFor(scheduleId, '2026-10-02');
    const key = `class:${occId}:2026-10-02:10:00:15`;
    const n = await prisma.notification.create({
      data: { userId: user.id, key, type: 'class_reminder', title: 't', body: 'b', scheduledAt: now, status: 'delivered' },
    });
    await prisma.notificationDelivery.create({ data: { notificationId: n.id, deviceId: 'dev-A', channel: 'local' } });

    expect(await scheduler.tickUser(user.id)).toBe(1);
    expect(sent.map((s) => s.endpoint)).toEqual([`https://push.test/B-${user.id}`]);
    expect(sent[0]!.payload.type).toBe('class_reminder');
    // Expired subscription was cleaned up.
    expect(await prisma.pushSubscription.count({ where: { userId: user.id } })).toBe(2);
    // Running again (or on another server instance) sends nothing new.
    expect(await scheduler.tickUser(user.id)).toBe(0);
  });

  it('asks about attendance after class and applies "Present" from the notification', async () => {
    sent.length = 0;
    now = new Date('2026-10-02T11:02:00Z');
    expect(await scheduler.tickUser(user.id)).toBe(2);
    const prompt = sent.find((s) => s.payload.type === 'attendance_prompt')!;
    expect(prompt.payload.title).toBe('Did you attend Operating Systems?');

    const app = createApp({ pushSender: sender });
    const session = jwt.sign({ sub: user.id }, env.JWT_SECRET, { algorithm: 'HS256' });
    const res = await request(app)
      .post('/api/notifications/action')
      .set('X-Requested-With', 'student-os')
      .set('Cookie', `sos_session=${session}`)
      .send({ token: prompt.payload.token, action: 'present' });
    expect(res.status).toBe(200);
    const inst = await prisma.classInstance.findUnique({ where: { id: instanceIdFor(scheduleId, '2026-10-02') } });
    expect(inst?.status).toBe('present');
    expect(await prisma.attendanceRecord.count({ where: { userId: user.id, status: 'present' } })).toBe(1);
    // The change is in the feed so every device pulls it.
    expect(await prisma.changeLog.count({ where: { userId: user.id, entity: 'classInstance' } })).toBeGreaterThan(0);

    // Another account cannot use this token.
    const other = await prisma.user.create({ data: { email: `other-${Date.now()}@example.com` } });
    const forged = await request(app)
      .post('/api/notifications/action')
      .set('X-Requested-With', 'student-os')
      .set('Cookie', `sos_session=${jwt.sign({ sub: other.id }, env.JWT_SECRET, { algorithm: 'HS256' })}`)
      .send({ token: prompt.payload.token, action: 'absent' });
    expect(forged.status).toBe(403);
  });

  it('re-sends snoozed notifications when they come due', async () => {
    sent.length = 0;
    const app = createApp({ pushSender: sender });
    const session = jwt.sign({ sub: user.id }, env.JWT_SECRET, { algorithm: 'HS256' });
    const token = jwt.sign(
      { sub: user.id, key: 'rem:x:2026-10-02:12:00', type: 'reminder', entityType: 'reminder', entityId: 'x', payload: { title: 'Call professor', body: 'b' } },
      env.JWT_SECRET,
      { audience: 'notification-action', algorithm: 'HS256' },
    );
    const res = await request(app).post('/api/notifications/action').set('X-Requested-With', 'student-os').set('Cookie', `sos_session=${session}`).send({ token, action: 'snooze', minutes: 10 });
    expect(res.status).toBe(200);
    now = new Date(); // the snooze route uses the real clock
    expect(await scheduler.tick()).toBe(0); // not due for another 10 minutes
    await prisma.notification.updateMany({ where: { userId: user.id, status: 'scheduled' }, data: { scheduledAt: new Date(Date.now() - 1000) } });
    now = new Date();
    await scheduler.tick();
    expect(sent.some((s) => s.payload.title === 'Call professor')).toBe(true);
  });
});

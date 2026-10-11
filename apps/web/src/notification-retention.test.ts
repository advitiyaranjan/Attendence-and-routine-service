import 'fake-indexeddb/auto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, type AppNotification } from './lib/db';

vi.stubGlobal('navigator', { onLine: true });
const { computeDue, expireReadNotifications, markReadOnDevice } = await import('./lib/notify-core');

const NOW = new Date('2026-10-12T12:00:00.000Z');

function notification(id: string, readAt: string | null, status: AppNotification['status'] = 'delivered'): AppNotification {
  return {
    id, key: `reminder:${id}`, type: 'reminder', category: 'reminders', title: id, body: 'Test reminder',
    entityType: null, entityId: null, scheduledAt: '2026-10-01T00:00:00.000Z', deliveredAt: '2026-10-01T00:00:00.000Z',
    readAt, status, actionable: false, channel: 'local', reported: false,
  };
}

beforeEach(async () => {
  await db.notifications.clear();
});
afterAll(async () => {
  await db.delete();
  vi.unstubAllGlobals();
});

describe('read notification retention', () => {
  it('expires at 24 hours after reading, preserving unread and recently read notifications', async () => {
    await db.notifications.bulkPut([
      notification('at-cutoff', '2026-10-11T12:00:00.000Z'),
      notification('older', '2026-10-10T12:00:00.000Z'),
      notification('recent', '2026-10-11T12:00:00.001Z'),
      notification('unread', null),
      notification('future', '2026-10-13T12:00:00.000Z'),
      notification('invalid', 'invalid'),
      notification('already-deleted', '2026-10-10T12:00:00.000Z', 'dismissed'),
    ]);

    expect(await expireReadNotifications(NOW)).toBe(2);
    const visible = await db.notifications.filter((n) => n.status !== 'dismissed').toArray();
    expect(visible.map((n) => n.id).sort()).toEqual(['future', 'invalid', 'recent', 'unread']);
    // Delivery deduplication and offline reporting still have the original record.
    expect(await db.notifications.get('at-cutoff')).toEqual({ ...notification('at-cutoff', '2026-10-11T12:00:00.000Z'), status: 'dismissed' });
    expect(await expireReadNotifications(NOW)).toBe(0);
  });

  it('does not restart the countdown when a read notification is opened again', async () => {
    await db.notifications.put(notification('read-again', null));
    const firstRead = new Date('2026-10-11T12:00:00.000Z');
    expect(await markReadOnDevice(['read-again'], firstRead)).toHaveLength(1);
    expect(await markReadOnDevice(['read-again'], NOW)).toHaveLength(0);
    expect(await markReadOnDevice([], NOW)).toHaveLength(0);
    expect((await db.notifications.get('read-again'))?.readAt).toBe(firstRead.toISOString());
    expect(await expireReadNotifications(NOW)).toBe(1);
  });

  it('cleans up saved notifications during the shared foreground/background scheduler tick', async () => {
    await db.notifications.bulkPut([
      notification('expired-while-closed', '2026-10-10T12:00:00.000Z'),
      notification('still-unread', null),
    ]);
    await computeDue(NOW);
    expect((await db.notifications.get('expired-while-closed'))?.status).toBe('dismissed');
    expect((await db.notifications.get('still-unread'))?.status).toBe('delivered');
  });
});

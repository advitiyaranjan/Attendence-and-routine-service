/**
 * Local-first database (IndexedDB via Dexie). The UI reads and writes only
 * here; the sync engine moves changes to and from the server in the background.
 * Table names equal entity names so the repository can stay generic.
 */
import Dexie, { type Table } from 'dexie';
import type { EntityMap, EntityName } from '@student-os/core';

export interface OutboxItem {
  seq?: number;
  operationId: string;
  entity: EntityName;
  entityId: string;
  operation: 'upsert' | 'delete';
  timestamp: string;
}

export interface KV {
  key: string;
  value: unknown;
}

/** A notification shown (or due) on this device. Mirrors the server's Notification model. */
export interface AppNotification {
  /** Deterministic id from the planner (uuid v5 of key), or random for ad-hoc ones. */
  id: string;
  key: string;
  type: string;
  category: string;
  title: string;
  body: string;
  entityType: string | null;
  entityId: string | null;
  scheduledAt: string;
  status: 'delivered' | 'dismissed';
  deliveredAt: string;
  readAt: string | null;
  actionable: boolean;
  channel: 'local' | 'push';
  /** In-app route to open. */
  href?: string;
  data?: Record<string, unknown>;
  /** Reported to the server so it won't push this to this device. */
  reported?: boolean;
}

type EntityTables = { [K in EntityName]: Table<EntityMap[K], string> };

class StudentDB extends Dexie {
  outbox!: Table<OutboxItem, number>;
  kv!: Table<KV, string>;
  notifications!: Table<AppNotification, string>;

  constructor() {
    super('student-os');
    this.version(1).stores({
      settings: 'id',
      subject: 'id',
      classSchedule: 'id, subjectId',
      classInstance: 'id, subjectId, date',
      attendanceRecord: 'id, instanceId, date',
      topic: 'id, subjectId, parentId',
      revisionSchedule: 'id, topicId, dueDate, status',
      task: 'id, status, dueDate, plannedDate',
      calendarEvent: 'id, date',
      studySession: 'id, date',
      exam: 'id, date',
      assignment: 'id, deadline',
      note: 'id, subjectId, topicId',
      flashcard: 'id, topicId, dueDate',
      quizAttempt: 'id, takenAt',
      dailyReview: 'id, date',
      outbox: '++seq, entityId',
      kv: 'key',
      notifications: 'id, createdAt',
    });
    this.version(2)
      .stores({
        reminder: 'id, date',
        aiActionLog: 'id, createdAt',
        notifications: 'id, scheduledAt, key',
      })
      .upgrade((tx) => tx.table('notifications').clear());
  }

  entity<E extends EntityName>(name: E): EntityTables[E] {
    return this.table(name) as unknown as EntityTables[E];
  }
}

export const db = new StudentDB();

export async function kvGet<T>(key: string): Promise<T | undefined> {
  return (await db.kv.get(key))?.value as T | undefined;
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  await db.kv.put({ key, value });
}

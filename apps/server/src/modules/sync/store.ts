/**
 * Maps synced entities onto Prisma models. Every model shares the same sync
 * columns, so one generic adapter handles them all; settings are special-cased
 * as a single JSON document per user.
 */
import type { Prisma } from '@prisma/client';
import type { EntityName } from '@student-os/core';
import { HttpError } from '../../lib/http';

export type Tx = Prisma.TransactionClient;
export type RecordData = Record<string, unknown>;

/** Columns stored as DateTime; everything else is passed through as-is. */
const TIMESTAMP_FIELDS = new Set(['createdAt', 'updatedAt', 'deletedAt', 'completedAt', 'markedAt', 'takenAt', 'executedAt', 'undoneAt']);
const META_FIELDS = ['id', 'createdAt', 'updatedAt', 'deletedAt', 'version', 'deviceId', 'syncStatus'] as const;

interface GenericDelegate {
  findUnique(args: { where: { id: string } }): Promise<RecordData | null>;
  findMany(args: { where: Record<string, unknown>; take?: number }): Promise<RecordData[]>;
  upsert(args: { where: { id: string }; create: RecordData; update: RecordData }): Promise<unknown>;
}

function delegate(tx: Tx, entity: Exclude<EntityName, 'settings'>): GenericDelegate {
  // Prisma delegate names match entity names (subject → tx.subject, classSchedule → tx.classSchedule, …).
  return (tx as unknown as Record<string, GenericDelegate>)[entity]!;
}

function toDb(record: RecordData): RecordData {
  const out: RecordData = {};
  for (const [key, value] of Object.entries(record)) {
    if (key === 'syncStatus') continue;
    out[key] = TIMESTAMP_FIELDS.has(key) && typeof value === 'string' ? new Date(value) : value;
  }
  return out;
}

function fromDb(row: RecordData): RecordData {
  const out: RecordData = {};
  for (const [key, value] of Object.entries(row)) {
    if (key === 'userId') continue;
    out[key] = value instanceof Date ? value.toISOString() : value;
  }
  out.syncStatus = 'synced';
  return out;
}

export interface EntityStore {
  /** Every live record of this entity for a user (optionally filtered). */
  findAll(tx: Tx, userId: string, where?: Record<string, unknown>): Promise<RecordData[]>;
  find(tx: Tx, userId: string, id: string): Promise<RecordData | null>;
  write(tx: Tx, userId: string, record: RecordData, version: number): Promise<void>;
  findMany(tx: Tx, userId: string, ids: string[]): Promise<RecordData[]>;
}

const genericStore = (entity: Exclude<EntityName, 'settings'>): EntityStore => ({
  async findAll(tx, userId, where = {}) {
    const rows = await delegate(tx, entity).findMany({ where: { userId, deletedAt: null, ...where }, take: 5000 });
    return rows.map(fromDb);
  },
  async find(tx, userId, id) {
    const row = await delegate(tx, entity).findUnique({ where: { id } });
    if (!row) return null;
    if (row.userId !== userId) throw new HttpError(403, 'forbidden', 'Record belongs to another account.');
    return fromDb(row);
  },
  async write(tx, userId, record, version) {
    const data: RecordData = { ...toDb(record), userId, version };
    const { id, ...update } = data;
    await delegate(tx, entity).upsert({ where: { id: id as string }, create: data, update });
  },
  async findMany(tx, userId, ids) {
    if (ids.length === 0) return [];
    const rows = await delegate(tx, entity).findMany({ where: { userId, id: { in: ids } } });
    return rows.map(fromDb);
  },
});

export const SETTINGS_ID = 'settings';

const settingsStore: EntityStore = {
  async findAll(tx, userId) {
    const one = await settingsStore.find(tx, userId, SETTINGS_ID);
    return one ? [one] : [];
  },
  async find(tx, userId) {
    const row = await tx.userSettings.findUnique({ where: { userId } });
    if (!row) return null;
    return {
      ...(row.data as RecordData),
      id: SETTINGS_ID,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      deletedAt: row.deletedAt?.toISOString() ?? null,
      version: row.version,
      deviceId: row.deviceId,
      syncStatus: 'synced',
    };
  },
  async write(tx, userId, record, version) {
    const data: RecordData = { ...record };
    for (const key of META_FIELDS) delete data[key];
    const meta = {
      createdAt: new Date(record.createdAt as string),
      updatedAt: new Date(record.updatedAt as string),
      deletedAt: record.deletedAt ? new Date(record.deletedAt as string) : null,
      deviceId: record.deviceId as string,
      version,
    };
    await tx.userSettings.upsert({
      where: { userId },
      create: { userId, data: data as Prisma.InputJsonObject, ...meta },
      update: { data: data as Prisma.InputJsonObject, ...meta },
    });
  },
  async findMany(tx, userId) {
    const one = await settingsStore.find(tx, userId, SETTINGS_ID);
    return one ? [one] : [];
  },
};

export function storeFor(entity: EntityName): EntityStore {
  return entity === 'settings' ? settingsStore : genericStore(entity);
}

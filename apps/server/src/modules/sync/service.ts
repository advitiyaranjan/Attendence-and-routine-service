import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import {
  ENTITY_NAMES,
  ENTITY_SCHEMAS,
  resolveWrite,
  type EntityName,
  type SyncOperation,
  type SyncOperationResult,
  type SyncRequest,
  type SyncResponse,
} from '@student-os/core';
import { HttpError } from '../../lib/http';
import { SETTINGS_ID, storeFor, type RecordData } from './store';
export type { RecordData };

const PULL_PAGE = 500;
/** Client clocks further ahead than this are clamped, so a skewed device can't always win LWW. */
const MAX_CLOCK_SKEW_MS = 5 * 60_000;

const entityOrder = new Map(ENTITY_NAMES.map((e, i) => [e, i]));

type ValidatedRecord = RecordData & { id: string; updatedAt: string; deviceId: string; version: number };

export function validateOperation(op: SyncOperation, now = Date.now()): ValidatedRecord {
  const id = op.entity === 'settings' ? SETTINGS_ID : op.entityId;
  // syncStatus is device-local bookkeeping: clients don't send it and the server doesn't store it.
  const payload: RecordData = { ...op.payload, id, syncStatus: 'synced' };
  if (op.operation === 'delete' && !payload.deletedAt) payload.deletedAt = op.timestamp;

  const parsed = ENTITY_SCHEMAS[op.entity].safeParse(payload);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new HttpError(400, 'invalid_record', `${op.entity}.${issue?.path.join('.') ?? ''}: ${issue?.message ?? 'invalid'}`);
  }
  const record = parsed.data as ValidatedRecord;
  for (const key of ['createdAt', 'updatedAt', 'deletedAt'] as const) {
    const v = record[key];
    if (typeof v === 'string' && Number.isNaN(Date.parse(v))) throw new HttpError(400, 'invalid_record', `${key} is not a valid timestamp`);
  }
  if (Date.parse(record.updatedAt) > now + MAX_CLOCK_SKEW_MS) record.updatedAt = new Date(now).toISOString();
  return record;
}

export class SyncService {
  constructor(private prisma: PrismaClient) {}

  async sync(userId: string, req: SyncRequest, userAgent?: string): Promise<SyncResponse> {
    await this.prisma.device.upsert({
      where: { id: req.deviceId },
      create: { id: req.deviceId, userId, userAgent: userAgent?.slice(0, 300) ?? null, lastSyncAt: new Date() },
      update: { lastSyncAt: new Date() },
    });

    // Parents before children so foreign keys resolve; stable within an entity.
    const ops = [...req.operations].sort((a, b) => entityOrder.get(a.entity)! - entityOrder.get(b.entity)!);
    const results: SyncOperationResult[] = [];
    for (const op of ops) results.push(await this.applyOperation(userId, op));

    const pull = await this.pull(userId, req.cursor);
    return { results, ...pull, serverTime: new Date().toISOString() };
  }

  async applyOperation(userId: string, op: SyncOperation): Promise<SyncOperationResult> {
    const done = await this.prisma.syncOperation.findUnique({ where: { operationId: op.operationId } });
    if (done) {
      if (done.userId !== userId) return { operationId: op.operationId, status: 'rejected', error: 'Operation id in use' };
      return done.result as unknown as SyncOperationResult;
    }

    let incoming: ValidatedRecord;
    try {
      incoming = validateOperation(op);
    } catch (err) {
      return { operationId: op.operationId, status: 'rejected', error: err instanceof Error ? err.message : 'Invalid record' };
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const store = storeFor(op.entity);
        const stored = (await store.find(tx, userId, incoming.id)) as ValidatedRecord | null;
        const resolution = resolveWrite(stored, incoming, op.baseVersion);
        const storedVersion = stored?.version ?? 0;

        let result: SyncOperationResult;
        if (resolution.kind === 'conflict') {
          await tx.conflictLog.create({
            data: {
              userId,
              entity: op.entity,
              entityId: incoming.id,
              winner: resolution.winner as Prisma.InputJsonObject,
              loser: resolution.loser as Prisma.InputJsonObject,
            },
          });
          if (resolution.incomingWon) {
            await store.write(tx, userId, incoming, storedVersion + 1);
            result = { operationId: op.operationId, status: 'conflict_won', version: storedVersion + 1 };
          } else {
            result = { operationId: op.operationId, status: 'conflict_lost', version: storedVersion };
          }
        } else {
          await store.write(tx, userId, incoming, storedVersion + 1);
          result = { operationId: op.operationId, status: 'applied', version: storedVersion + 1 };
        }

        // Always log a change so the device pulls the authoritative record (including when it lost).
        await tx.changeLog.create({ data: { userId, entity: op.entity, entityId: incoming.id } });
        await tx.syncOperation.create({
          data: {
            operationId: op.operationId,
            userId,
            entity: op.entity,
            entityId: incoming.id,
            deviceId: op.deviceId,
            result: result as unknown as Prisma.InputJsonObject,
          },
        });
        return result;
      });
    } catch (err) {
      if (err instanceof HttpError) return { operationId: op.operationId, status: 'rejected', error: err.message };
      console.error('sync operation failed', op.entity, op.entityId, err);
      return { operationId: op.operationId, status: 'rejected', error: 'Could not save this change' };
    }
  }

  /**
   * Server-originated write (e.g. a notification action). Goes through the same
   * validation, conflict resolution and change feed as a device's write.
   */
  async serverWrite(
    userId: string,
    entity: EntityName,
    id: string,
    build: (current: RecordData | null, now: string) => RecordData | null,
  ): Promise<SyncOperationResult | null> {
    const current = await storeFor(entity).find(this.prisma as unknown as Prisma.TransactionClient, userId, id);
    const now = new Date().toISOString();
    const record = build(current, now);
    if (!record) return null;
    return this.applyOperation(userId, {
      operationId: randomUUID(),
      entity,
      entityId: id,
      operation: record.deletedAt ? 'delete' : 'upsert',
      payload: { createdAt: now, deletedAt: null, ...record, id, updatedAt: now, deviceId: 'server', version: current?.version ?? 0, syncStatus: 'pending' },
      baseVersion: (current?.version as number | undefined) ?? 0,
      timestamp: now,
      deviceId: 'server',
    });
  }

  async pull(userId: string, cursor: string | null): Promise<Pick<SyncResponse, 'changes' | 'cursor' | 'hasMore'>> {
    let after = 0n;
    if (cursor) {
      try {
        after = BigInt(cursor);
      } catch {
        throw new HttpError(400, 'invalid_cursor', 'Invalid sync cursor');
      }
    }
    const log = await this.prisma.changeLog.findMany({
      where: { userId, seq: { gt: after } },
      orderBy: { seq: 'asc' },
      take: PULL_PAGE,
    });
    const byEntity = new Map<EntityName, Set<string>>();
    for (const entry of log) {
      const entity = entry.entity as EntityName;
      if (!entityOrder.has(entity)) continue;
      if (!byEntity.has(entity)) byEntity.set(entity, new Set());
      byEntity.get(entity)!.add(entry.entityId);
    }

    const changes: SyncResponse['changes'] = [];
    for (const entity of ENTITY_NAMES) {
      const ids = byEntity.get(entity);
      if (!ids) continue;
      const records = await storeFor(entity).findMany(this.prisma as unknown as Prisma.TransactionClient, userId, [...ids]);
      for (const record of records) changes.push({ entity, record });
    }

    const last = log.at(-1);
    return {
      changes,
      cursor: last ? last.seq.toString() : cursor,
      hasMore: log.length === PULL_PAGE,
    };
  }
}

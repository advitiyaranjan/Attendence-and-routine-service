/**
 * Sync engine.
 *
 *   Local DB → outbox → POST /api/sync → conflict resolution → cloud
 *   cloud changes since cursor → local DB
 *
 * - Push and pull happen in one request; the server applies operations then
 *   returns everything changed after our cursor (including our own writes with
 *   their new server version).
 * - Multiple queued edits to one record are coalesced into a single snapshot.
 * - Network failures retry with exponential backoff; invalid records are
 *   marked "failed" instead of retrying forever.
 * - Incoming changes never overwrite a record that has unsent local edits;
 *   those edits are pushed next and the server resolves the conflict.
 */
import { v4 as uuid } from 'uuid';
import { ENTITY_NAMES, type EntityName, type SyncOperation, type SyncResponse } from '@student-os/core';
import { api, ApiError } from './api';
import type { Table } from 'dexie';
import { db, kvGet, kvSet, type OutboxItem } from './db';
import { deviceId } from './device';
import { emitDataChanged, setLocalWriteListener } from './repo';
import { useApp } from './store';

const BATCH = 200;
const BACKOFF = [5_000, 15_000, 60_000, 300_000];
const CURSOR_KEY = 'sync.cursor';
const LAST_SYNC_KEY = 'sync.lastSyncedAt';

let running: Promise<void> | null = null;
let rerun = false;
let failures = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

async function refreshPending() {
  const pending = await db.outbox.count();
  useApp.getState().setSync({ pending });
}

/** Build one operation per record from the oldest outbox items. */
async function buildOperations(): Promise<{ ops: SyncOperation[]; seqs: number[]; latestSeq: Map<string, number> }> {
  const items = await db.outbox.orderBy('seq').limit(BATCH).toArray();
  const latest = new Map<string, OutboxItem>();
  for (const item of items) latest.set(`${item.entity}:${item.entityId}`, item);

  const ops: SyncOperation[] = [];
  const latestSeq = new Map<string, number>();
  for (const [key, item] of latest) {
    const record = await db.entity(item.entity).get(item.entityId);
    latestSeq.set(key, item.seq!);
    if (!record) continue;
    const { syncStatus: _s, ...payload } = record as unknown as Record<string, unknown>;
    ops.push({
      operationId: item.operationId,
      entity: item.entity,
      entityId: item.entityId,
      operation: record.deletedAt ? 'delete' : 'upsert',
      payload,
      baseVersion: record.version,
      timestamp: item.timestamp,
      deviceId: deviceId(),
    });
  }
  return { ops, seqs: items.map((i) => i.seq!), latestSeq };
}

async function applyResponse(res: SyncResponse, ops: SyncOperation[], seqs: number[]) {
  const opById = new Map(ops.map((o) => [o.operationId, o]));
  let conflicts = 0;
  const failed: Array<{ entity: EntityName; id: string; error: string }> = [];

  await db.transaction('rw', db.tables, async () => {
    if (seqs.length) await db.outbox.bulkDelete(seqs);

    for (const result of res.results) {
      const op = opById.get(result.operationId);
      if (!op) continue;
      const table = db.table(op.entity) as Table<{ id: string }, string>;
      const local = await table.get(op.entityId);
      if (!local) continue;
      const stillPending = (await db.outbox.where('entityId').equals(op.entityId).count()) > 0;
      if (result.status === 'applied' || result.status === 'conflict_won') {
        await table.update(op.entityId, { version: result.version, ...(stillPending ? {} : { syncStatus: 'synced' }) } as never);
      } else if (result.status === 'rejected') {
        failed.push({ entity: op.entity, id: op.entityId, error: result.error ?? 'Rejected' });
        await table.update(op.entityId, { syncStatus: 'failed' } as never);
      }
      if (result.status.startsWith('conflict')) conflicts++;
    }

    for (const { entity, record } of res.changes) {
      const id = record.id as string;
      const pending = (await db.outbox.where('entityId').equals(id).count()) > 0;
      if (pending) continue;
      await db.entity(entity).put({ ...record, syncStatus: 'synced' } as never);
    }
    if (res.cursor) await db.kv.put({ key: CURSOR_KEY, value: res.cursor });
  });

  if (res.changes.length) emitDataChanged();
  if (failed.length) {
    const prev = (await kvGet<typeof failed>('sync.failed')) ?? [];
    await kvSet('sync.failed', [...prev, ...failed].slice(-50));
  }
  return conflicts;
}

async function runSync(): Promise<void> {
  const app = useApp.getState();
  if (!app.user) {
    app.setSync({ phase: 'local' });
    useApp.setState({ firstSyncDone: true });
    return;
  }
  if (!navigator.onLine) {
    app.setSync({ phase: 'offline' });
    return;
  }
  const recovering = (app.sync.phase === 'offline' || app.sync.phase === 'error') && (await db.outbox.count()) > 0;
  app.setSync({ phase: 'syncing', error: null });
  let conflicts = 0;
  try {
    // A brand-new device pulls first, so account data arrives before any local edits are compared.
    let cursor = (await kvGet<string>(CURSOR_KEY)) ?? null;
    if (cursor === null) {
      let more = true;
      while (more) {
        const res: SyncResponse = await api<SyncResponse>('/api/sync', { body: { deviceId: deviceId(), cursor, operations: [] } });
        await applyResponse(res, [], []);
        cursor = res.cursor;
        more = res.hasMore;
        if (cursor === null) break;
      }
    }

    for (let guard = 0; guard < 50; guard++) {
      const { ops, seqs } = await buildOperations();
      cursor = (await kvGet<string>(CURSOR_KEY)) ?? null;
      const res: SyncResponse = await api<SyncResponse>('/api/sync', { body: { deviceId: deviceId(), cursor, operations: ops } });
      conflicts += await applyResponse(res, ops, seqs);
      const remaining = await db.outbox.count();
      if (remaining === 0 && !res.hasMore) break;
    }

    failures = 0;
    const now = new Date().toISOString();
    await kvSet(LAST_SYNC_KEY, now);
    app.setSync({ phase: 'idle', lastSyncedAt: now, conflicts: app.sync.conflicts + conflicts });
    if (recovering) {
      const { notifyNow } = await import('./notifications');
      void notifyNow('sync', '✓ All changes synchronized', conflicts ? `${conflicts} conflicting edit(s) were resolved by keeping the latest change.` : 'Your offline changes are now on every device.', '/settings');
    }
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      app.setUser(null);
      app.setSync({ phase: 'local' });
      return;
    }
    failures++;
    const message = err instanceof ApiError ? err.message : 'Sync failed';
    app.setSync({ phase: navigator.onLine ? 'error' : 'offline', error: message });
    scheduleRetry();
  } finally {
    useApp.setState({ firstSyncDone: true });
    await refreshPending();
  }
}

function scheduleRetry() {
  if (retryTimer) clearTimeout(retryTimer);
  const delay = BACKOFF[Math.min(failures - 1, BACKOFF.length - 1)]!;
  retryTimer = setTimeout(() => void syncNow(), delay);
}

/** Run a sync now (coalesces concurrent calls). */
export function syncNow(): Promise<void> {
  if (running) {
    rerun = true;
    return running;
  }
  running = runSync().finally(() => {
    running = null;
    if (rerun) {
      rerun = false;
      void syncNow();
    }
  });
  return running;
}

function scheduleSoon() {
  void refreshPending();
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => void syncNow(), 1500);
}

/** Forget sync position, e.g. when signing into a different account. */
export async function resetSyncCursor() {
  await db.kv.delete(CURSOR_KEY);
}

/**
 * Records the server rejected earlier are marked "failed" and dropped from the
 * outbox. Re-queue them on start-up so they retry after a fix or a schema update.
 */
export async function requeueFailed(): Promise<number> {
  let count = 0;
  const now = new Date().toISOString();
  for (const name of ENTITY_NAMES) {
    const failed = await db.table(name).filter((r: { syncStatus?: string }) => r.syncStatus === 'failed').toArray();
    for (const r of failed as Array<{ id: string; deletedAt: string | null }>) {
      await db.outbox.add({ operationId: uuid(), entity: name, entityId: r.id, operation: r.deletedAt ? 'delete' : 'upsert', timestamp: now });
      await db.table(name).update(r.id, { syncStatus: 'pending' });
      count++;
    }
  }
  if (count) await kvSet('sync.failed', []);
  return count;
}

export function startSyncEngine() {
  void requeueFailed().then((n) => n && scheduleSoon());
  setLocalWriteListener(scheduleSoon);
  void kvGet<string>(LAST_SYNC_KEY).then((v) => v && useApp.getState().setSync({ lastSyncedAt: v }));
  void refreshPending();

  window.addEventListener('online', () => {
    useApp.getState().setOnline(true);
    failures = 0;
    void syncNow();
  });
  window.addEventListener('offline', () => {
    useApp.getState().setOnline(false);
    useApp.getState().setSync({ phase: 'offline' });
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void syncNow();
  });
  // Periodic pull for changes made on other devices.
  setInterval(() => {
    if (document.visibilityState === 'visible') void syncNow();
  }, 60_000);
}

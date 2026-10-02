/**
 * The only write path for synced data. Every mutation stamps sync metadata,
 * validates against the shared schema and appends an outbox entry in the same
 * IndexedDB transaction, so no local change can be lost before it syncs.
 */
import { v4 as uuid } from 'uuid';
import { ENTITY_SCHEMAS, settingsSchema, type EntityMap, type EntityName, type RecordChange, type Settings } from '@student-os/core';
import { db } from './db';
import { deviceId } from './device';

type Meta = 'id' | 'createdAt' | 'updatedAt' | 'deletedAt' | 'version' | 'deviceId' | 'syncStatus';
export type NewRecord<E extends EntityName> = Partial<EntityMap[E]> & Omit<Partial<EntityMap[E]>, Meta> & { id?: string };

let onLocalWrite: (() => void) | null = null;
/** The sync engine registers here to be nudged after local writes. */
export function setLocalWriteListener(fn: () => void) {
  onLocalWrite = fn;
}

let recording: RecordChange[] | null = null;

/**
 * Run a set of writes and capture every record they create, update or delete
 * (with before/after snapshots), so they can be audited and undone.
 */
export async function recordChanges(fn: () => Promise<void>): Promise<RecordChange[]> {
  if (recording) throw new Error('Nested recording is not supported');
  recording = [];
  try {
    await fn();
    return recording;
  } finally {
    recording = null;
  }
}

function track(entity: EntityName, op: RecordChange['op'], before: unknown, after: unknown) {
  if (!recording) return;
  recording.push({
    entity,
    id: ((after ?? before) as { id: string }).id,
    op,
    before: (before as Record<string, unknown>) ?? null,
    after: (after as Record<string, unknown>) ?? null,
  });
}

function validate<E extends EntityName>(entity: E, record: unknown): EntityMap[E] {
  return ENTITY_SCHEMAS[entity].parse(record) as EntityMap[E];
}

async function writeWithOutbox<E extends EntityName>(entity: E, records: EntityMap[E][], operation: 'upsert' | 'delete') {
  const now = new Date().toISOString();
  await db.transaction('rw', [db.table(entity), db.outbox], async () => {
    for (const record of records) {
      await db.entity(entity).put(record as never);
      await db.outbox.add({ operationId: uuid(), entity, entityId: record.id, operation, timestamp: now });
    }
  });
  onLocalWrite?.();
}

export async function createMany<E extends EntityName>(entity: E, items: NewRecord<E>[]): Promise<EntityMap[E][]> {
  const now = new Date().toISOString();
  const records = items.map((data) =>
    validate(entity, {
      ...data,
      id: data.id ?? uuid(),
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      version: 0,
      deviceId: deviceId(),
      syncStatus: 'pending',
    }),
  );
  await writeWithOutbox(entity, records, 'upsert');
  for (const rec of records) track(entity, 'create', null, rec);
  return records;
}

export async function create<E extends EntityName>(entity: E, data: NewRecord<E>): Promise<EntityMap[E]> {
  const [record] = await createMany(entity, [data]);
  return record!;
}

export async function update<E extends EntityName>(entity: E, id: string, patch: Partial<EntityMap[E]>): Promise<EntityMap[E]> {
  const existing = await db.entity(entity).get(id);
  if (!existing) throw new Error(`${entity} ${id} not found`);
  const record = validate(entity, {
    ...existing,
    ...patch,
    id,
    updatedAt: new Date().toISOString(),
    deviceId: deviceId(),
    syncStatus: 'pending',
  });
  await writeWithOutbox(entity, [record], 'upsert');
  track(entity, 'update', existing, record);
  return record;
}

/** Create with a known id, or update if it already exists (used for deterministic class instances). */
export async function upsert<E extends EntityName>(entity: E, id: string, data: NewRecord<E>): Promise<EntityMap[E]> {
  const existing = await db.entity(entity).get(id);
  if (existing && !existing.deletedAt) return update(entity, id, data as Partial<EntityMap[E]>);
  if (existing) return update(entity, id, { ...data, deletedAt: null } as Partial<EntityMap[E]>);
  return create(entity, { ...data, id });
}

/** Soft delete so the deletion can propagate to other devices. */
export async function remove<E extends EntityName>(entity: E, id: string): Promise<void> {
  await removeMany(entity, [id]);
}

export async function removeMany<E extends EntityName>(entity: E, ids: string[]): Promise<void> {
  const now = new Date().toISOString();
  const records: EntityMap[E][] = [];
  const befores: EntityMap[E][] = [];
  for (const id of ids) {
    const existing = await db.entity(entity).get(id);
    if (!existing || existing.deletedAt) continue;
    befores.push(existing);
    records.push({ ...existing, deletedAt: now, updatedAt: now, deviceId: deviceId(), syncStatus: 'pending' });
  }
  if (records.length) await writeWithOutbox(entity, records, 'delete');
  records.forEach((rec, i) => track(entity, 'delete', befores[i], rec));
}

// ---------------------------------------------------------------------------
// Settings singleton

export const SETTINGS_ID = 'settings';

export function defaultSettings(): Settings {
  const now = new Date().toISOString();
  return settingsSchema.parse({
    id: SETTINGS_ID,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    version: 0,
    deviceId: deviceId(),
    syncStatus: 'synced',
  });
}

export async function getSettings(): Promise<Settings> {
  return (await db.entity('settings').get(SETTINGS_ID)) ?? defaultSettings();
}

/**
 * Settings are created lazily on first edit. Untouched defaults are never
 * uploaded, so signing in on a new device can't overwrite real settings.
 */
export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const existing = await db.entity('settings').get(SETTINGS_ID);
  if (!existing) {
    const base = defaultSettings();
    return create('settings', { ...base, ...patch, id: SETTINGS_ID });
  }
  return update('settings', SETTINGS_ID, patch);
}


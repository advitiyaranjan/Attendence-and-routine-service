/**
 * Executes confirmed proposals, records exactly what changed (before/after
 * snapshots) in the synced AI action log, and undoes them on request.
 */
import { ENTITY_NAMES, type AIActionLog, type EntityName, type RecordChange } from '@student-os/core';
import { db } from '../db';
import { create, recordChanges, remove, update } from '../repo';
import { executeProposal, type Proposal } from './registry';

const META = new Set(['id', 'createdAt', 'updatedAt', 'deletedAt', 'version', 'deviceId', 'syncStatus']);

function summaryOf(p: Proposal) {
  return [p.title, p.heading].filter(Boolean).join(' — ').slice(0, 500);
}

function detailsOf(p: Proposal) {
  return [...p.lines, ...(p.items ?? []).filter((i) => i.selected).map((i) => `• ${i.label}`)].slice(0, 100).map((l) => l.slice(0, 500));
}

export async function confirmProposal(p: Proposal): Promise<Proposal> {
  let message = '';
  try {
    const changes = await recordChanges(async () => {
      message = await executeProposal(p);
    });
    const log = await create('aiActionLog', {
      action: p.action,
      summary: summaryOf(p),
      details: detailsOf(p),
      params: p.params,
      status: 'confirmed',
      changes,
      executedAt: new Date().toISOString(),
    });
    return { ...p, status: 'confirmed', result: message, logId: log.id };
  } catch (e) {
    console.error('AI action failed', e);
    const error = "Couldn't apply this change. Nothing was modified.";
    await create('aiActionLog', { action: p.action, summary: summaryOf(p), details: detailsOf(p), params: p.params, status: 'failed', error });
    return { ...p, status: 'failed', error };
  }
}

export async function cancelProposal(p: Proposal): Promise<Proposal> {
  await create('aiActionLog', { action: p.action, summary: summaryOf(p), details: detailsOf(p), params: p.params, status: 'cancelled' });
  return { ...p, status: 'cancelled' };
}

export interface UndoResult {
  undone: number;
  skipped: string[];
}

/**
 * Reverse a confirmed action. Records changed since (by the student or
 * another device) are left alone and reported, never overwritten.
 */
export async function undoLog(logId: string): Promise<UndoResult> {
  const log = (await db.entity('aiActionLog').get(logId)) as AIActionLog | undefined;
  if (!log || log.status !== 'confirmed') throw new Error('Nothing to undo');
  const result: UndoResult = { undone: 0, skipped: [] };

  for (const change of [...log.changes].reverse() as RecordChange[]) {
    if (!(ENTITY_NAMES as string[]).includes(change.entity)) continue;
    const entity = change.entity as EntityName;
    const current = (await db.entity(entity).get(change.id)) as Record<string, unknown> | undefined;
    const after = change.after as Record<string, unknown> | null;
    if (current && after && current.updatedAt !== after.updatedAt) {
      result.skipped.push(`${entity} changed since — left as is`);
      continue;
    }
    if (change.op === 'create') {
      if (current && !current.deletedAt) await remove(entity, change.id);
    } else if (change.op === 'update' && change.before) {
      const restore = Object.fromEntries(Object.entries(change.before).filter(([k]) => !META.has(k)));
      await update(entity, change.id, restore as never);
    } else if (change.op === 'delete') {
      await update(entity, change.id, { deletedAt: null } as never);
    }
    result.undone++;
  }
  await update('aiActionLog', logId, { status: 'undone', undoneAt: new Date().toISOString() });
  return result;
}

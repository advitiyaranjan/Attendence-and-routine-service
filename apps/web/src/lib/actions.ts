/** Domain actions that touch several records at once. */
import { v4 as uuid } from 'uuid';
import {
  applyRating,
  initialRevisions,
  todayISO,
  type AttendanceStatus,
  type ClassOccurrence,
  type ISODate,
  type RecallRating,
  type RevisionSchedule,
} from '@student-os/core';
import { db } from './db';
import { occurrencesBetween } from './queries';
import { create, createMany, getSettings, removeMany, update, upsert } from './repo';

export const SUBJECT_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];

export async function nextSubjectColor(): Promise<string> {
  const count = (await db.entity('subject').toArray()).filter((s) => !s.deletedAt).length;
  return SUBJECT_COLORS[count % SUBJECT_COLORS.length]!;
}

// ---------------------------------------------------------------------------
// Attendance

export async function markAttendance(occ: ClassOccurrence, status: AttendanceStatus | null) {
  const markedAt = new Date().toISOString();
  await upsert('classInstance', occ.id, {
    scheduleId: occ.scheduleId,
    subjectId: occ.subjectId,
    date: occ.date,
    startTime: occ.startTime,
    endTime: occ.endTime,
    room: occ.room,
    status,
    isExtra: occ.isExtra,
    rescheduledFromId: occ.rescheduledFromId,
    rescheduledToId: occ.rescheduledToId,
  });
  if (status) {
    await create('attendanceRecord', { instanceId: occ.id, subjectId: occ.subjectId, date: occ.date, status, markedAt });
  }
}

export interface LostMark {
  occ: ClassOccurrence;
  status: AttendanceStatus;
  markedAt: string;
}

/**
 * Past classes that show as unmarked although the attendance history (append-only, never
 * cleared) has a mark for them. Used to restore marks after a class's status was lost.
 */
export async function findLostMarks(today: ISODate = todayISO()): Promise<LostMark[]> {
  const records = (await db.entity('attendanceRecord').toArray()).filter((r) => !r.deletedAt && r.date <= today);
  if (!records.length) return [];
  const latest = new Map<string, (typeof records)[number]>();
  for (const r of records) {
    const prev = latest.get(r.instanceId);
    if (!prev || r.markedAt > prev.markedAt) latest.set(r.instanceId, r);
  }
  const dates = [...latest.values()].map((r) => r.date).sort();
  const settings = await getSettings();
  const occs = await occurrencesBetween(dates[0]!, dates.at(-1)!, settings);
  const out: LostMark[] = [];
  for (const occ of occs) {
    if (occ.status !== null) continue;
    const r = latest.get(occ.id);
    if (r && r.status !== 'unsure') out.push({ occ, status: r.status, markedAt: r.markedAt });
  }
  return out.sort((a, b) => a.occ.date.localeCompare(b.occ.date) || a.occ.startTime.localeCompare(b.occ.startTime));
}

/** Puts lost marks back on their classes. The history already has them, so no new history rows. */
export async function restoreLostMarks(marks: LostMark[]): Promise<number> {
  for (const { occ, status } of marks) {
    await upsert('classInstance', occ.id, {
      scheduleId: occ.scheduleId,
      subjectId: occ.subjectId,
      date: occ.date,
      startTime: occ.startTime,
      endTime: occ.endTime,
      room: occ.room,
      status,
      isExtra: occ.isExtra,
      rescheduledFromId: occ.rescheduledFromId,
      rescheduledToId: occ.rescheduledToId,
    });
  }
  return marks.length;
}

/** Move a class: the original stops counting, a replacement is created on the new slot. */
export async function rescheduleClass(occ: ClassOccurrence, date: ISODate, startTime: string, endTime: string, room: string | null) {
  const newId = uuid();
  await create('classInstance', {
    id: newId,
    scheduleId: occ.scheduleId,
    subjectId: occ.subjectId,
    date,
    startTime,
    endTime,
    room: room ?? occ.room,
    status: null,
    isExtra: true,
    rescheduledFromId: occ.id,
  });
  await upsert('classInstance', occ.id, {
    scheduleId: occ.scheduleId,
    subjectId: occ.subjectId,
    date: occ.date,
    startTime: occ.startTime,
    endTime: occ.endTime,
    room: occ.room,
    status: 'rescheduled',
    rescheduledToId: newId,
    isExtra: occ.isExtra,
  });
  await create('attendanceRecord', {
    instanceId: occ.id,
    subjectId: occ.subjectId,
    date: occ.date,
    status: 'rescheduled',
    markedAt: new Date().toISOString(),
  });
}

export async function addExtraClass(subjectId: string, date: ISODate, startTime: string, endTime: string, room: string | null) {
  return create('classInstance', { scheduleId: null, subjectId, date, startTime, endTime, room, status: null, isExtra: true });
}

// ---------------------------------------------------------------------------
// Revision

export async function learnTopic(input: { title: string; subjectId: string | null; learnedOn: ISODate; parentId?: string | null; notes?: string | null }) {
  const settings = await getSettings();
  const topic = await create('topic', {
    title: input.title,
    subjectId: input.subjectId,
    parentId: input.parentId ?? null,
    learnedOn: input.learnedOn,
    notes: input.notes ?? null,
    stage: 0,
    ease: 1,
  });
  const plan = initialRevisions(input.learnedOn, settings.revisionIntervals);
  await createMany(
    'revisionSchedule',
    plan.map((p) => ({ topicId: topic.id, subjectId: input.subjectId, stage: p.stage, dueDate: p.dueDate, status: 'pending' as const })),
  );
  return { topic, plan };
}

/** Complete a revision with a recall rating and re-plan the rest adaptively. Returns an explanation. */
export async function completeRevision(rev: RevisionSchedule, rating: RecallRating): Promise<string> {
  const settings = await getSettings();
  const topic = await db.entity('topic').get(rev.topicId);
  if (!topic) throw new Error('Topic not found');
  const today = todayISO();
  const outcome = applyRating({ stage: topic.stage, ease: topic.ease }, rev.stage, rating, today, settings.revisionIntervals);

  await update('revisionSchedule', rev.id, { status: 'done', completedAt: new Date().toISOString(), rating });
  const others = (await db.entity('revisionSchedule').where('topicId').equals(topic.id).toArray()).filter(
    (r) => r.id !== rev.id && r.status === 'pending' && !r.deletedAt,
  );
  await removeMany(
    'revisionSchedule',
    others.map((r) => r.id),
  );
  if (outcome.upcoming.length) {
    await createMany(
      'revisionSchedule',
      outcome.upcoming.map((p) => ({ topicId: topic.id, subjectId: topic.subjectId, stage: p.stage, dueDate: p.dueDate, status: 'pending' as const })),
    );
  }
  await update('topic', topic.id, { stage: outcome.state.stage, ease: outcome.state.ease, mastered: outcome.mastered });
  return outcome.explanation;
}


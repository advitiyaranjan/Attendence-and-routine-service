/** Home "Up next" card: which of today's items it cycles through, and in what order. */
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { calendarEventSchema, reminderSchema, taskSchema, type ClassOccurrence } from '@student-os/core';
import { upNextItems } from './components/UpNext';

const today = '2026-10-05';
const meta = { createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', deletedAt: null, version: 1, deviceId: 'd1', syncStatus: 'synced' as const };
const cls = (id: string, start: string, end: string, status: ClassOccurrence['status'] = null) => ({ id, subjectId: 's1', date: today, startTime: start, endTime: end, room: null, status }) as ClassOccurrence;
const task = (id: string, extra: object) => taskSchema.parse({ ...meta, id, title: id, ...extra });

describe('upNextItems', () => {
  const classes = [cls('dbms', '10:00', '11:00'), cls('os', '12:00', '13:00'), cls('cn', '09:00', '10:00', 'cancelled')];
  const tasks = [
    task('report', { dueDate: today, dueTime: '09:30' }),
    task('quiz', { dueDate: today, dueTime: '12:00' }),
    task('untimed', { dueDate: today }),
    task('tomorrow', { dueDate: '2026-10-06', dueTime: '08:00' }),
    task('finished', { dueDate: today, dueTime: '11:30', status: 'done' }),
  ];
  const events = [calendarEventSchema.parse({ ...meta, id: 'gym', title: 'Gym', type: 'personal', date: today, startTime: '18:00', endTime: '19:00' })];
  const reminders = [reminderSchema.parse({ ...meta, id: 'call', title: 'Call home', date: today, time: '20:00' })];

  it('puts a task before the class when it is due first, and skips untimed/done/other-day tasks and cancelled classes', () => {
    const items = upNextItems(today, { classes, tasks, events, reminders }, { tasks: true, events: true, reminders: false });
    expect(items.map((i) => i.key)).toEqual(['treport', 'cdbms', 'tquiz', 'cos', 'egym']);
  });

  it('respects what the student chose to include', () => {
    const items = upNextItems(today, { classes, tasks, events, reminders }, { tasks: false, events: false, reminders: true });
    expect(items.map((i) => i.key)).toEqual(['cdbms', 'cos', 'mcall']);
  });
});

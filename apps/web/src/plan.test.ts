import { describe, expect, it } from 'vitest';
import type { CalendarEvent, RevisionSchedule, Task } from '@student-os/core';
import { copiesOf, normTitle, scheduledKeys, selfStudyMinutes } from './lib/plan';

const TODAY = '2026-10-03';
const task = (id: string, title: string, plannedDate: string | null, status: Task['status'] = 'todo') =>
  ({ id, title, plannedDate, dueDate: null, status, deletedAt: null }) as Task;
const rev = (id: string, topicId: string, dueDate: string) => ({ id, topicId, dueDate, status: 'pending' }) as RevisionSchedule;
const topics: Record<string, string> = { geo: 'Geography' };
const data = (tasks: Task[], revisions: RevisionSchedule[] = []) => ({ tasks, revisions, topicTitle: (id: string) => topics[id] ?? 'Topic' });

describe('duplicate work', () => {
  it('treats revision/catch-up prefixes and punctuation as the same title', () => {
    expect(normTitle('Revision: Geography')).toBe(normTitle('Revise Geography'));
    expect(normTitle('UPSC Catch-up Session 1')).toBe('upsc catch up session 1');
  });

  it("finds today's and overdue copies, not tomorrow's or finished ones", () => {
    const tasks = [
      task('a', 'UPSC Catch-up Session 1', TODAY),
      task('b', 'UPSC Catch-up Session 1', '2026-10-02'),
      task('c', 'UPSC Catch-up Session 1', '2026-10-04'),
      task('d', 'UPSC Catch-up Session 1', TODAY, 'done'),
      task('e', 'Something else', TODAY),
    ];
    const ids = copiesOf('UPSC Catch-up Session 1', TODAY, data(tasks), TODAY).map((t) => (t.kind === 'task' ? t.task.id : ''));
    expect(ids).toEqual(['a', 'b']);
  });

  it('matches a scheduled revision session to the spaced-repetition revision', () => {
    const copies = copiesOf('Revision: Geography', TODAY, data([], [rev('r1', 'geo', TODAY), rev('r2', 'geo', '2026-10-09')]), TODAY);
    expect(copies.map((c) => (c.kind === 'revision' ? c.revision.id : ''))).toEqual(['r1']);
  });

  it("collects today's scheduled titles only", () => {
    const ev = (title: string, date: string) => ({ title, date, deletedAt: null }) as CalendarEvent;
    const keys = scheduledKeys([ev('UPSC Catch-up Session 1', TODAY), ev('UPSC Catch-up Session 3', '2026-10-04')], TODAY);
    expect(keys.has(normTitle('UPSC Catch-up Session 1'))).toBe(true);
    expect(keys.has(normTitle('UPSC Catch-up Session 3'))).toBe(false);
  });
});

describe('self study time', () => {
  const ev = (date: string, start: string, end: string, extra: Partial<CalendarEvent> = {}) =>
    ({ date, startTime: start, endTime: end, type: 'study', completedAt: `${date}T20:00:00Z`, deletedAt: null, ...extra }) as CalendarEvent;
  const data = {
    sessions: [{ date: TODAY, durationMinutes: 30 }],
    events: [
      ev(TODAY, '09:00', '12:00'), // completed catch-up session: counts
      ev(TODAY, '14:00', '17:00'),
      ev(TODAY, '18:00', '19:00', { completedAt: null }), // not done: doesn't count
      ev(TODAY, '19:00', '20:00', { type: 'personal' }), // not study: doesn't count
    ],
  };

  it('counts logged time and completed study sessions, not other events', () => {
    expect(selfStudyMinutes(TODAY, TODAY, data)).toBe(30 + 180 + 180);
  });

  it('gives the week at least today’s total', () => {
    expect(selfStudyMinutes('2026-09-27', TODAY, data)).toBe(selfStudyMinutes(TODAY, TODAY, data));
  });
});

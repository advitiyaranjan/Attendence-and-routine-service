import 'fake-indexeddb/auto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { addDays, todayISO, weekdayOf } from '@student-os/core';

vi.stubGlobal('navigator', { onLine: true });
const { db } = await import('./lib/db');
const { create, update, remove } = await import('./lib/repo');
const { findLostMarks, markAttendance, restoreLostMarks } = await import('./lib/actions');
const { occurrencesBetween } = await import('./lib/queries');
const { getSettings } = await import('./lib/repo');

afterAll(async () => {
  await db.delete();
  vi.unstubAllGlobals();
});

describe('restoring lost attendance marks', () => {
  it('finds classes whose status was lost and puts the marks back from history', async () => {
    const today = todayISO();
    const d1 = addDays(today, -7);
    const d2 = addDays(today, -14);
    const subject = await create('subject', { name: 'DBMS' });
    await create('classSchedule', { subjectId: subject.id, weekday: weekdayOf(d1), startTime: '10:00', endTime: '11:00' });
    const settings = await getSettings();
    const [o1] = await occurrencesBetween(d1, d1, settings);
    const [o2] = await occurrencesBetween(d2, d2, settings);
    await markAttendance(o1!, 'absent');
    await markAttendance({ ...o1!, status: 'absent' }, 'present'); // changed mind: latest mark wins
    await markAttendance(o2!, 'absent');
    expect(await findLostMarks(today)).toEqual([]);

    // Lose them: one status cleared, one class record deleted outright.
    await update('classInstance', o1!.id, { status: null });
    await remove('classInstance', o2!.id);
    const history = await db.entity('attendanceRecord').count();

    const lost = await findLostMarks(today);
    expect(lost.map((l) => [l.occ.date, l.status])).toEqual([
      [d2, 'absent'],
      [d1, 'present'],
    ]);
    expect(await restoreLostMarks(lost)).toBe(2);
    expect((await db.entity('classInstance').get(o1!.id))!).toMatchObject({ status: 'present', deletedAt: null });
    expect((await db.entity('classInstance').get(o2!.id))!).toMatchObject({ status: 'absent', deletedAt: null });
    expect(await db.entity('attendanceRecord').count()).toBe(history);
    expect(await findLostMarks(today)).toEqual([]);
  });
});

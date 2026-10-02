/**
 * Integration test of the local-first data layer (IndexedDB via fake-indexeddb):
 * timetable → generated classes → attendance → topic → adaptive revision →
 * offline outbox → sync round-trip.
 */
import 'fake-indexeddb/auto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { addDays, instanceIdFor, todayISO, type SyncResponse } from '@student-os/core';

vi.stubGlobal('navigator', { onLine: true });

const { db } = await import('./lib/db');
const { create, getSettings, saveSettings, update } = await import('./lib/repo');
const { markAttendance, rescheduleClass, learnTopic, completeRevision } = await import('./lib/actions');
const { computeAttendance, occurrencesBetween } = await import('./lib/hooks');
const { syncNow } = await import('./lib/sync');
const { useApp } = await import('./lib/store');
const { parseTimetableCsv } = await import('./components/TimetableImport');

const TODAY = '2026-10-02'; // Friday

beforeAll(async () => {
  await db.open();
});
afterAll(async () => {
  await db.delete();
});

describe('timetable → attendance', () => {
  let subjectId = '';

  it('parses a CSV timetable offline', () => {
    const rows = parseTimetableCsv('Day,Start,End,Subject,Room\nMonday,10:00,11:00,Operating Systems,B-204\nTue,2 PM,3 PM,DBMS,B-101\nFunday,1,2,Bad,');
    expect(rows.map((r) => [r.day, r.start, r.end, r.name])).toEqual([
      [1, '10:00', '11:00', 'Operating Systems'],
      [2, '14:00', '15:00', 'DBMS'],
    ]);
  });

  it('generates recurring classes from a confirmed schedule', async () => {
    await saveSettings({ semesterStart: '2026-09-07', semesterEnd: '2026-10-31', onboarded: true });
    const subject = await create('subject', { name: 'Operating Systems', color: '#2a78d6' });
    subjectId = subject.id;
    await create('classSchedule', { subjectId, weekday: 1, startTime: '10:00', endTime: '11:00', room: 'B-204' });
    const settings = await getSettings();
    const past = await occurrencesBetween('2026-09-07', TODAY, settings);
    expect(past.map((o) => o.date)).toEqual(['2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28']);
  });

  it('calculates attendance excluding cancelled and rescheduled classes', async () => {
    const settings = await getSettings();
    const [a, b, c, d] = await occurrencesBetween('2026-09-07', TODAY, settings);
    await markAttendance(a!, 'present');
    await markAttendance(b!, 'present');
    await markAttendance(c!, 'cancelled');
    await rescheduleClass(d!, '2026-09-30', '14:00', '15:00', null);

    let overview = await computeAttendance(settings, TODAY);
    let os = overview.subjects[0]!.summary;
    expect([os.present, os.conducted, os.cancelled, os.unmarked]).toEqual([2, 2, 1, 1]); // the replacement class awaits marking
    expect(overview.unmarked[0]!.date).toBe('2026-09-30');

    await markAttendance(overview.unmarked[0]!, 'absent');
    overview = await computeAttendance(settings, TODAY);
    os = overview.subjects[0]!.summary;
    expect([os.present, os.conducted]).toEqual([2, 3]);
    expect(os.percent).toBeCloseTo(66.67, 1);
    expect(os.risk).toBe('below_min');
    // Remaining Mondays to Oct 31: 5, 12, 19, 26 → (2+4)/(3+4) = 85.7% max, so 75% is still reachable.
    expect(os.projection).toMatchObject({ remaining: 4, maxMissable: 0 });
    expect(os.neededForMin).toBe(1);
  });

  it('keeps an append-only attendance history', async () => {
    const history = await db.entity('attendanceRecord').toArray();
    expect(history.map((h) => h.status).sort()).toEqual(['absent', 'cancelled', 'present', 'present', 'rescheduled']);
    const id = instanceIdFor((await db.entity('classSchedule').toArray())[0]!.id, '2026-09-07');
    expect((await db.entity('classInstance').get(id))?.status).toBe('present');
  });
});

describe('topic → adaptive revision', () => {
  it('schedules revisions and re-plans them after a rating', async () => {
    const { topic, plan } = await learnTopic({ title: 'Process Scheduling', subjectId: null, learnedOn: '2026-10-02' });
    expect(plan.map((p) => p.dueDate)).toEqual(['2026-10-03', '2026-10-05', '2026-10-09', '2026-11-01', '2026-12-31', '2027-03-31']);

    const first = (await db.entity('revisionSchedule').where('topicId').equals(topic.id).toArray()).find((r) => r.stage === 1)!;
    const explanation = await completeRevision(first, 'forgot');
    expect(explanation).toMatch(/tomorrow/);

    const revs = await db.entity('revisionSchedule').where('topicId').equals(topic.id).toArray();
    const pending = revs.filter((r) => r.status === 'pending' && !r.deletedAt).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const replaced = revs.filter((r) => r.deletedAt);
    expect(replaced).toHaveLength(5); // old plan soft-deleted so the deletion syncs
    expect(pending[0]).toMatchObject({ stage: 1, dueDate: addDays(todayISO(), 1) });
    const t = await db.entity('topic').get(topic.id);
    expect(t?.ease).toBeLessThan(1);
  });
});

describe('offline queue → sync', () => {
  it('queues every change while signed out and uploads it after sign-in', async () => {
    const queued = await db.outbox.count();
    expect(queued).toBeGreaterThan(10);

    // Fake server: accept every operation with version 1.
    const bodies: Array<{ operations: Array<{ operationId: string; entityId: string; baseVersion: number }> }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string);
        bodies.push(body);
        const res: SyncResponse = {
          results: body.operations.map((o: { operationId: string }) => ({ operationId: o.operationId, status: 'applied', version: 1 })),
          changes: [],
          cursor: body.operations.length ? String(bodies.length) : null,
          hasMore: false,
          serverTime: new Date().toISOString(),
        };
        return new Response(JSON.stringify(res), { status: 200 });
      }),
    );
    useApp.setState({ user: { id: 'u1', email: 'a@b.co', name: null, hasGoogle: false } });
    await syncNow();

    expect(await db.outbox.count()).toBe(0);
    const ops = bodies.flatMap((b) => b.operations);
    // Multiple edits to one record are coalesced into a single snapshot.
    expect(new Set(ops.map((o) => o.entityId)).size).toBe(ops.length);
    const subject = (await db.entity('subject').toArray())[0]!;
    expect(subject).toMatchObject({ version: 1, syncStatus: 'synced' });
    expect(useApp.getState().sync.phase).toBe('idle');
  });

  it('never lets an incoming change overwrite an unsynced local edit', async () => {
    const subject = (await db.entity('subject').toArray())[0]!;
    await update('subject', subject.id, { name: 'OS (local edit)' });
    const remote = { ...subject, name: 'Operating Systems (other device)', version: 2, updatedAt: new Date(Date.now() + 60_000).toISOString() };
    const seenBySecondRequest: string[] = [];
    let call = 0;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string);
        call++;
        if (call === 1) {
          // The student edits again while the first upload is in flight.
          await update('subject', subject.id, { name: 'OS (newer local edit)' });
        } else {
          seenBySecondRequest.push((await db.entity('subject').get(subject.id))!.name);
        }
        // The server says another device's newer edit won last-write-wins.
        const res: SyncResponse = {
          results: body.operations.map((o: { operationId: string }) => ({ operationId: o.operationId, status: 'conflict_lost', version: 2 })),
          changes: [{ entity: 'subject', record: remote }],
          cursor: String(100 + call),
          hasMore: false,
          serverTime: new Date().toISOString(),
        };
        return new Response(JSON.stringify(res), { status: 200 });
      }),
    );

    await syncNow();
    // After the first response the newer local edit was still intact and got pushed …
    expect(seenBySecondRequest[0]).toBe('OS (newer local edit)');
    // … and once nothing is pending, the server's resolved winner is applied locally.
    expect(await db.outbox.count()).toBe(0);
    expect(await db.entity('subject').get(subject.id)).toMatchObject({ name: 'Operating Systems (other device)', version: 2, syncStatus: 'synced' });
  });
});

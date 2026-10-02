/**
 * AI control system + notification runtime, against a fake IndexedDB.
 * Clock is fixed to Friday 2 Oct 2026, 12:00 local time.
 */
import 'fake-indexeddb/auto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { instanceIdFor, refOf, validateIntents } from '@student-os/core';

vi.useFakeTimers({ toFake: ['Date'] });
vi.setSystemTime(new Date(2026, 9, 2, 12, 0));
vi.stubGlobal('navigator', { onLine: true });

const { db } = await import('./lib/db');
const { create, saveSettings, getSettings } = await import('./lib/repo');
const { prepareAction } = await import('./lib/copilot/registry');
const { confirmProposal, undoLog } = await import('./lib/copilot/run');
const { useCopilot } = await import('./lib/copilot/store');
const { learnTopic } = await import('./lib/actions');
const { computeDue, recordDelivered, snoozeLocal } = await import('./lib/notify-core');
const { computeAttendance } = await import('./lib/queries');

let dbms = '';
let morning = '';
let afternoon = '';

beforeAll(async () => {
  await db.open();
  await saveSettings({ onboarded: true, semesterStart: '2026-09-07', semesterEnd: '2026-12-18' });
  dbms = (await create('subject', { name: 'Database Management Systems', color: '#2a78d6' })).id;
  await create('subject', { name: 'Operating Systems', color: '#eb6834' });
  // Two DBMS classes every Friday.
  morning = (await create('classSchedule', { subjectId: dbms, weekday: 5, startTime: '10:00', endTime: '11:00' })).id;
  afternoon = (await create('classSchedule', { subjectId: dbms, weekday: 5, startTime: '14:00', endTime: '15:00' })).id;
});
afterAll(async () => {
  await db.delete();
  vi.useRealTimers();
});

describe('Copilot actions', () => {
  it('asks which class instead of guessing when two match', async () => {
    const r = await prepareAction('mark_attendance', { target: { ref: null, subject: 'DBMS', date: '2026-10-02', time: null }, status: 'present' });
    expect(r.kind).toBe('clarify');
    if (r.kind !== 'clarify') return;
    expect(r.options.map((o) => o.label)).toEqual(['Database Management Systems — 10:00 AM – 11:00 AM', 'Database Management Systems — 2:00 PM – 3:00 PM']);
  });

  it('refuses to record attendance for a class that has not happened yet', async () => {
    const r = await prepareAction('mark_attendance', { target: { ref: null, subject: 'DBMS', date: '2026-10-02', time: '14:00' }, status: 'present' });
    expect(r).toEqual({ kind: 'error', message: "That class hasn't started yet, so I can't record attendance for it." });
  });

  it('refuses unknown subjects rather than inventing them', async () => {
    const r = await prepareAction('create_class', { subject: 'Quantum Basket Weaving', recurring: false, date: '2026-10-03', weekday: null, startTime: '10:00', endTime: '11:00', room: null });
    expect(r.kind).toBe('error');
  });

  it('marks attendance after confirmation, logs it, and undoes it', async () => {
    const ref = refOf('c', instanceIdFor(morning, '2026-10-02'));
    const r = await prepareAction('mark_attendance', { target: { ref, subject: null, date: '2026-10-02', time: null }, status: 'present' });
    expect(r.kind).toBe('proposal');
    if (r.kind !== 'proposal') return;
    expect(r.proposal.title).toBe('Mark attendance as PRESENT?');
    // Nothing is written before confirmation.
    expect(await db.entity('classInstance').count()).toBe(0);

    const done = await confirmProposal(r.proposal);
    expect(done.status).toBe('confirmed');
    expect(done.result).toBe("✓ Attendance recorded · Database Management Systems: 100%");
    const settings = await getSettings();
    expect((await computeAttendance(settings, '2026-10-02')).subjects.find((s) => s.subject.id === dbms)!.summary.present).toBe(1);

    const log = await db.entity('aiActionLog').get(done.logId!);
    expect(log).toMatchObject({ action: 'mark_attendance', status: 'confirmed' });
    expect(log!.changes.map((c) => `${c.op}:${c.entity}`)).toEqual(['create:classInstance', 'create:attendanceRecord']);

    const undo = await undoLog(done.logId!);
    expect(undo).toEqual({ undone: 2, skipped: [] });
    expect((await computeAttendance(settings, '2026-10-02')).subjects.find((s) => s.subject.id === dbms)!.summary.present).toBe(0);
    expect((await db.entity('aiActionLog').get(done.logId!))!.status).toBe('undone');
  });

  it('proposes bulk revision moves with every affected item, and undo restores dates', async () => {
    await learnTopic({ title: 'Normalization', subjectId: dbms, learnedOn: '2026-10-01' }); // revision 1 due 10-02
    await learnTopic({ title: 'Transactions', subjectId: dbms, learnedOn: '2026-10-01' });
    const r = await prepareAction('move_revisions', { fromDate: '2026-10-02', toDate: '2026-10-03', subject: null });
    expect(r.kind).toBe('proposal');
    if (r.kind !== 'proposal') return;
    expect(r.proposal.bulk).toBe(true);
    expect(r.proposal.title).toBe('2 revision sessions will be moved');
    expect(r.proposal.items!.map((i) => i.label)).toEqual([
      'Database Management Systems — Normalization (2026-10-02)',
      'Database Management Systems — Transactions (2026-10-02)',
    ]);
    // Student unticks one in Review.
    const p = { ...r.proposal, items: r.proposal.items!.map((i, n) => ({ ...i, selected: n === 0 })) };
    const done = await confirmProposal(p);
    expect(done.result).toBe('✓ Moved 1 revision session');
    const due = async (d: string) => (await db.entity('revisionSchedule').where('dueDate').equals(d).toArray()).filter((x) => !x.deletedAt).length;
    expect(await due('2026-10-03')).toBe(1);
    await undoLog(done.logId!);
    expect(await due('2026-10-03')).toBe(0);
    expect(await due('2026-10-02')).toBe(2);
  });

  it('flags clashes in a proposed plan and leaves those sessions unticked', async () => {
    const r = await prepareAction('create_events', {
      summary: 'Evening plan',
      events: [
        { title: 'OS revision', type: 'revision', date: '2026-10-02', startTime: '14:30', endTime: '15:30', subject: 'OS' },
        { title: 'DSA practice', type: 'practice', date: '2026-10-02', startTime: '18:00', endTime: '19:00', subject: null },
      ],
    });
    expect(r.kind).toBe('proposal');
    if (r.kind !== 'proposal') return;
    expect(r.proposal.items!.map((i) => [i.selected, i.warning ?? null])).toEqual([
      [false, 'Clashes with your Database Management Systems class 2:00 PM – 3:00 PM'],
      [true, null],
    ]);
    const done = await confirmProposal(r.proposal);
    expect(done.result).toMatch(/Plan added \(1 session\)/);
  });
});

describe('Copilot command flow', () => {
  it('turns validated intents into proposals and blocks unpermitted ones', async () => {
    const intents = [
      { action: 'create_task', params: { title: 'Complete OS Assignment', dueDate: '2026-10-03', priority: 'high', estimatedMinutes: 120 } },
      { action: 'delete_task', params: { target: { title: 'anything' } } },
    ];
    const settings = await getSettings();
    // What the server would return after validateIntents with the student's permissions.
    const { intents: ok, rejected } = validateIntents(intents, settings.aiPermissions);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ reply: 'Here is the task.', intents: ok, rejected, clarification: null }), { status: 200 })),
    );
    await useCopilot.getState().send('I need to finish OS assignment by tomorrow');
    const last = useCopilot.getState().messages.at(-1)!;
    expect(last.proposals).toHaveLength(1);
    expect(last.proposals![0]).toMatchObject({ action: 'create_task', status: 'pending', heading: 'Complete OS Assignment' });
    expect(last.proposals![0]!.lines).toContain('Priority: high');
    expect(last.notices?.[0]).toMatch(/Delete data.*AI permissions/);
    expect(await db.entity('task').count()).toBe(0);

    await useCopilot.getState().confirm(last.id, last.proposals![0]!.id);
    const confirmed = useCopilot.getState().messages.at(-1)!.proposals![0]!;
    expect(confirmed.status).toBe('confirmed');
    expect(confirmed.result).toMatch(/✓ Task created · Reminder: tomorrow at 5:00 PM/);
    expect((await db.entity('task').toArray())[0]).toMatchObject({ title: 'Complete OS Assignment', source: 'ai' });
  });
});

describe('notification runtime', () => {
  it('computes due notifications from local data and never delivers one twice', async () => {
    vi.setSystemTime(new Date(2026, 9, 2, 13, 47));
    const { items } = await computeDue();
    const reminder = items.find((i) => i.type === 'class_reminder')!;
    expect(reminder.title).toBe('Database Management Systems starts in 15 min');
    await recordDelivered(reminder, 'local');
    expect((await computeDue()).items.some((i) => i.id === reminder.id)).toBe(false);
  });

  it('brings back snoozed notifications after the snooze period', async () => {
    const item = { id: 'n1', key: 'rem:x', type: 'reminder', category: 'reminders', title: 'Call professor', body: '', entityType: null, entityId: null, href: '/', actions: [] };
    await snoozeLocal(item, 10);
    expect((await computeDue()).items.some((i) => i.title === 'Call professor')).toBe(false);
    vi.setSystemTime(new Date(2026, 9, 2, 13, 58));
    expect((await computeDue()).items.filter((i) => i.title === 'Call professor')).toHaveLength(1);
    expect((await computeDue()).items.some((i) => i.title === 'Call professor')).toBe(false);
  });
});

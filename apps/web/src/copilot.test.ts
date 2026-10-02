/**
 * AI control system + notification runtime, against a fake IndexedDB.
 * Clock is fixed to Friday 2 Oct 2026, 12:00 local time.
 */
import 'fake-indexeddb/auto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ACTIONS, instanceIdFor, refOf, validateIntents } from '@student-os/core';

vi.useFakeTimers({ toFake: ['Date'] });
vi.setSystemTime(new Date(2026, 9, 2, 12, 0));
vi.stubGlobal('navigator', { onLine: true });

const { db } = await import('./lib/db');
const { asAiWrite, create, saveSettings, getSettings } = await import('./lib/repo');
const { prepareAction } = await import('./lib/copilot/registry');
const { confirmProposal, undoLog } = await import('./lib/copilot/run');
const { useCopilot } = await import('./lib/copilot/store');
const { learnTopic } = await import('./lib/actions');
const { computeDue, recordDelivered, snoozeLocal } = await import('./lib/notify-core');
const { computeAttendance, occurrencesBetween } = await import('./lib/queries');

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

  it('adds a missing subject with the class (shown on the card) only when allowed', async () => {
    const params = { subject: 'Quantum Basket Weaving', recurring: true, date: '2026-10-04', weekday: 0, startTime: '10:00', endTime: '11:00', room: null };
    const perms = (await getSettings()).aiPermissions;
    await saveSettings({ aiPermissions: { ...perms, manageSubjects: false } });
    expect((await prepareAction('create_class', params)).kind).toBe('error');
    await saveSettings({ aiPermissions: { ...perms, manageSubjects: true } });
    const r = await prepareAction('create_class', params);
    expect(r).toMatchObject({ kind: 'proposal', proposal: { warnings: ['Also adds the new subject “Quantum Basket Weaving”'] } });
    if (r.kind !== 'proposal') return;
    const done = await confirmProposal(r.proposal);
    expect((await db.entity('subject').toArray()).some((s) => s.name === 'Quantum Basket Weaving' && !s.deletedAt)).toBe(true);
    await undoLog(done.logId!);
    expect((await db.entity('subject').toArray()).some((s) => s.name === 'Quantum Basket Weaving' && !s.deletedAt)).toBe(false);
    await saveSettings({ aiPermissions: perms });
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

describe('subjects and settings', () => {
  it('creates, updates and deletes subjects with confirmation and undo', async () => {
    const add = await prepareAction('create_subject', { name: 'Computer Networks', code: 'CS303', faculty: 'Dr. Mehta', credits: 4, minAttendance: 80, targetAttendance: null });
    expect(add.kind).toBe('proposal');
    if (add.kind !== 'proposal') return;
    expect(add.proposal.lines).toEqual(['Code: CS303', 'Faculty: Dr. Mehta', 'Credits: 4', 'Minimum attendance: 80%']);
    expect((await db.entity('subject').toArray()).some((s) => s.name === 'Computer Networks')).toBe(false);
    const done = await confirmProposal(add.proposal);
    expect(done.result).toBe('✓ Subject "Computer Networks" added');
    const cn = (await db.entity('subject').toArray()).find((s) => s.name === 'Computer Networks')!;
    expect(cn).toMatchObject({ code: 'CS303', minAttendance: 80 });

    expect(await prepareAction('create_subject', { name: 'computer networks', code: null, faculty: null, credits: null, minAttendance: null, targetAttendance: null })).toMatchObject({ kind: 'error' });

    const upd = await prepareAction('update_subject', { target: { ref: null, name: 'CN' }, changes: { name: null, code: null, faculty: null, credits: null, minAttendance: 75, targetAttendance: null } });
    expect(upd).toMatchObject({ kind: 'proposal', proposal: { lines: ['Minimum attendance: 80% → 75%'] } });
    if (upd.kind === 'proposal') await confirmProposal(upd.proposal);
    expect((await db.entity('subject').get(cn.id))!.minAttendance).toBe(75);

    const del = await prepareAction('delete_subject', { target: { ref: null, name: 'Computer Networks' } });
    expect(del.kind).toBe('proposal');
    if (del.kind !== 'proposal') return;
    const gone = await confirmProposal(del.proposal);
    expect((await db.entity('subject').get(cn.id))!.deletedAt).not.toBeNull();
    await undoLog(gone.logId!);
    expect((await db.entity('subject').get(cn.id))!.deletedAt).toBeNull();
  });

  it('changes a weekly class from today on, keeping history', async () => {
    const r = await prepareAction('update_weekly_class', { target: { ref: null, subject: 'DBMS', weekday: 5, time: '14:00' }, changes: { weekday: null, startTime: '15:00', endTime: null, room: 'Lab 2' } });
    expect(r.kind).toBe('proposal');
    if (r.kind !== 'proposal') return;
    expect(r.proposal.lines).toContain('2:00 PM – 3:00 PM → 3:00 PM – 4:00 PM');
    const changed = await confirmProposal(r.proposal);
    const slots = (await db.entity('classSchedule').where('subjectId').equals(dbms).toArray()).filter((s) => s.startTime === '15:00' || s.startTime === '14:00');
    expect(slots.find((s) => s.startTime === '14:00')!.validUntil).toBe('2026-10-01');
    expect(slots.find((s) => s.startTime === '15:00')).toMatchObject({ validFrom: '2026-10-02', room: 'Lab 2' });
    // Undo restores the original slot exactly.
    await undoLog(changed.logId!);
    const after = (await db.entity('classSchedule').where('subjectId').equals(dbms).toArray()).filter((s) => !s.deletedAt);
    expect(after.find((s) => s.startTime === '14:00')!.validUntil).toBeNull();
    expect(after.some((s) => s.startTime === '15:00')).toBe(false);
  });

  it('changes settings with a before → after summary', async () => {
    const r = await prepareAction('update_settings', { changes: { minAttendance: 80, dailyStudyTargetMinutes: 180, classReminderMinutes: [30, 10] } });
    expect(r).toMatchObject({ kind: 'proposal', proposal: { lines: ['Minimum attendance: 75% → 80%', 'Daily study target: 240 min → 180 min', 'Class reminders: 15 → 30, 10 min before'] } });
    if (r.kind !== 'proposal') return;
    const done = await confirmProposal(r.proposal);
    const s = await getSettings();
    expect([s.minAttendance, s.dailyStudyTargetMinutes, s.notifications.categories.classes.offsets]).toEqual([80, 180, [30, 10]]);
    await undoLog(done.logId!);
    expect((await getSettings()).notifications.categories.classes.offsets).toEqual([15]);
  });

  it('updates the profile, study hours included, and undoes it', async () => {
    const r = await prepareAction('update_profile', { changes: { name: 'Asha Rao', bio: 'Final-year CSE', studyStart: '19:00', studyEnd: '22:00' } });
    expect(r.kind).toBe('proposal');
    if (r.kind !== 'proposal') return;
    const done = await confirmProposal(r.proposal);
    const s = await getSettings();
    expect([s.profile.name, s.profile.bio, s.studyWindow]).toEqual(['Asha Rao', 'Final-year CSE', { start: '19:00', end: '22:00' }]);
    await undoLog(done.logId!);
    expect((await getSettings()).studyWindow).toBeNull();
  });

  it('never lets AI change AI Power or AI permissions', async () => {
    const before = await getSettings();
    expect(await prepareAction('update_settings', { changes: { aiPower: 'maximum' } })).toMatchObject({ kind: 'error' });
    expect(await prepareAction('update_settings', { changes: { minAttendance: 70, aiPermissions: { deleteTasks: true } } })).toMatchObject({ kind: 'error' });
    // Even a write slipped into an AI action is refused at the storage layer.
    await expect(asAiWrite(() => saveSettings({ aiPower: 'maximum' }))).rejects.toThrow();
    const after = await getSettings();
    expect([after.aiPower, after.minAttendance, after.aiPermissions]).toEqual([before.aiPower, before.minAttendance, before.aiPermissions]);
    // The student can still change it themselves.
    await saveSettings({ aiPower: 'high' });
    expect((await getSettings()).aiPower).toBe('high');
    await saveSettings({ aiPower: before.aiPower });
  });
});

describe('Copilot command flow', () => {
  it('turns validated intents into proposals and blocks unpermitted ones', async () => {
    const intents = [
      { action: 'create_task', params: { title: 'Complete OS Assignment', dueDate: '2026-10-03', priority: 'high', estimatedMinutes: 120 } },
      { action: 'delete_task', params: { target: { title: 'anything' } } },
    ];
    // The student turned off deletions for this test: AI Pilot must refuse them.
    await saveSettings({ aiPermissions: { ...(await getSettings()).aiPermissions, deleteTasks: false } });
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
    expect(last.notices?.[0]).toMatch(/Delete todos.*AI/);
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

describe('Compulsory subjects and sleep time', () => {
  it('reschedules missed work only for compulsory subjects, outside sleep time', async () => {
    const { runCatchUp } = await import('./lib/catchup');
    const { catchUpIdFor } = await import('@student-os/core');
    const law = (await create('subject', { name: 'Business Law', color: '#111111', compulsory: true } as never)).id;
    const art = (await create('subject', { name: 'Art Appreciation', color: '#222222' })).id;
    const missedLaw = await create('classInstance', { scheduleId: null, subjectId: law, date: '2026-10-01', startTime: '09:00', endTime: '10:00', status: 'absent', isExtra: true } as never);
    await create('classInstance', { scheduleId: null, subjectId: art, date: '2026-10-01', startTime: '11:00', endTime: '12:00', status: 'absent', isExtra: true } as never);
    const study = await create('calendarEvent', { title: 'Law reading', type: 'study', date: '2026-10-01', startTime: '18:00', endTime: '19:00', subjectId: law } as never);
    const artStudy = await create('calendarEvent', { title: 'Art reading', type: 'study', date: '2026-10-01', startTime: '18:00', endTime: '19:00', subjectId: art } as never);
    const rev = await create('revisionSchedule', { topicId: 't', subjectId: law, stage: 1, dueDate: '2026-09-30' } as never);
    const artRev = await create('revisionSchedule', { topicId: 't2', subjectId: art, stage: 1, dueDate: '2026-09-30' } as never);

    expect(await runCatchUp()).toBe(3);
    const sleep = (await getSettings()).sleepWindow;
    const { overlapsSleep } = await import('@student-os/core');

    const catchUp = await db.entity('calendarEvent').get(catchUpIdFor(missedLaw.id));
    expect(catchUp).toMatchObject({ title: 'Catch up: Business Law', type: 'study', subjectId: law });
    expect(catchUp!.date >= '2026-10-02' && !overlapsSleep(catchUp!.startTime!, catchUp!.endTime!, sleep)).toBe(true);
    const moved = await db.entity('calendarEvent').get(study.id);
    expect(moved!.date >= '2026-10-02' && !overlapsSleep(moved!.startTime!, moved!.endTime!, sleep)).toBe(true);
    expect((await db.entity('revisionSchedule').get(rev.id))!.dueDate >= '2026-10-02').toBe(true);
    // Non-compulsory subjects are left alone.
    expect((await db.entity('calendarEvent').get(artStudy.id))!.date).toBe('2026-10-01');
    expect((await db.entity('revisionSchedule').get(artRev.id))!.dueDate).toBe('2026-09-30');
    // Idempotent: a second run moves nothing new (the catch-up isn't created twice).
    expect(await runCatchUp()).toBe(0);
  });

  it('AI Pilot refuses to schedule during sleep time', async () => {
    const r = await prepareAction('create_event', { title: 'Late study', type: 'study', date: '2026-10-03', startTime: '23:30', endTime: '23:59', subject: null });
    expect(r).toMatchObject({ kind: 'error' });
    if (r.kind === 'error') expect(r.message).toMatch(/sleep time/);
  });
});

describe('Baskets', () => {
  it("creates a basket whose own holiday removes only its subjects' classes, and undoes it", async () => {
    const settings = await getSettings();
    const fridays = async () => (await occurrencesBetween('2026-10-09', '2026-10-09', settings)).filter((o) => o.subjectId === dbms).length;
    expect(await fridays()).toBe(2);

    const params = ACTIONS.create_basket.schema.parse({ name: 'College', holidays: ['2026-10-09'], minAttendance: 60, subjects: ['DBMS'] });
    const r = await prepareAction('create_basket', params);
    expect(r).toMatchObject({ kind: 'proposal', proposal: { lines: expect.arrayContaining(['Subjects: Database Management Systems', 'Minimum attendance: 60%']) } });
    if (r.kind !== 'proposal') return;
    const done = await confirmProposal(r.proposal);

    const basket = (await db.entity('basket').toArray()).find((b) => b.name === 'College' && !b.deletedAt)!;
    expect((await db.entity('subject').get(dbms))?.basketId).toBe(basket.id);
    expect(await fridays()).toBe(0);
    const att = await computeAttendance(settings, '2026-10-02');
    expect(att.subjects.find((x) => x.subject.id === dbms)).toMatchObject({ basket: { name: 'College' }, thresholds: { min: 60 } });

    await undoLog(done.logId!);
    expect((await db.entity('subject').get(dbms))?.basketId).toBeNull();
    expect(await fridays()).toBe(2);
  });

  it('moves a subject into a basket by name', async () => {
    const coaching = await create('basket', { name: 'Coaching' });
    const params = ACTIONS.update_subject.schema.parse({ target: { name: 'Operating Systems' }, changes: { basket: 'coaching' } });
    const r = await prepareAction('update_subject', params);
    expect(r).toMatchObject({ kind: 'proposal', proposal: { lines: ['Basket: none → Coaching'] } });
    if (r.kind !== 'proposal') return;
    await confirmProposal(r.proposal);
    const os = (await db.entity('subject').toArray()).find((s) => s.name === 'Operating Systems')!;
    expect(os.basketId).toBe(coaching.id);
  });
});

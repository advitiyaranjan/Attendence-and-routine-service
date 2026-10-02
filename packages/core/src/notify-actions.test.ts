import { describe, expect, it } from 'vitest';
import {
  dueNow,
  freeSlots,
  instanceIdFor,
  localMomentIn,
  planNotifications,
  refOf,
  reminderDates,
  settingsSchema,
  validateIntents,
  canAutoApply,
  PERMISSION_LABEL,
  type PlannerData,
  type Settings,
} from './index';

const meta = (id: string) => ({ id, createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z', deletedAt: null, version: 0, deviceId: 'd', syncStatus: 'synced' as const });

function settings(patch: Record<string, unknown> = {}): Settings {
  return settingsSchema.parse({ ...meta('settings'), onboarded: true, semesterStart: '2026-09-07', semesterEnd: '2026-12-18', ...patch });
}

function data(patch: Partial<PlannerData> = {}): PlannerData {
  return {
    settings: settings(),
    subjects: [{ ...meta('os'), name: 'Operating Systems', code: null, faculty: null, credits: null, color: '#000', minAttendance: null, targetAttendance: null, active: true }],
    schedules: [{ ...meta('s1'), subjectId: 'os', weekday: 5, startTime: '10:00', endTime: '11:00', room: 'B-204', faculty: null, type: 'lecture', active: true, validFrom: null, validUntil: null }],
    instances: [],
    tasks: [],
    revisions: [],
    topics: [],
    exams: [],
    assignments: [],
    events: [],
    reminders: [],
    ...patch,
  };
}

// 2026-10-02 is a Friday.
const at = (minutes: number) => ({ date: '2026-10-02', minutes });
const classes = (list: ReturnType<typeof dueNow>) => list.filter((n) => n.category === 'classes' || n.category === 'attendance');

describe('notification planner', () => {
  it('reminds 15 minutes before class and asks about attendance afterwards', () => {
    const before = classes(dueNow(planNotifications(data(), at(9 * 60 + 45)), at(9 * 60 + 45)));
    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({ type: 'class_reminder', title: 'Operating Systems starts in 15 min', body: '10:00 AM – 11:00 AM · Room B-204' });

    const after = classes(dueNow(planNotifications(data(), at(11 * 60 + 2)), at(11 * 60 + 2)));
    expect(after.map((n) => n.type)).toEqual(['attendance_prompt']);
    expect(after[0]!.actions.map((a) => a.action)).toEqual(['present', 'absent', 'cancelled']);
    expect((after[0]!.data!.occurrence as { date: string }).date).toBe('2026-10-02');
  });

  it('produces stable ids so repeated runs and other devices never duplicate', () => {
    const a = planNotifications(data(), at(9 * 60 + 50));
    const b = planNotifications(data(), at(9 * 60 + 52));
    expect(a[0]!.id).toBe(b[0]!.id);
  });

  it('does not remind about cancelled classes or ask about already-marked ones', () => {
    const occId = instanceIdFor('s1', '2026-10-02');
    const inst = (status: 'cancelled' | 'present') => ({
      ...meta(occId), scheduleId: 's1', subjectId: 'os', date: '2026-10-02', startTime: '10:00', endTime: '11:00', room: null, status, note: null, rescheduledToId: null, rescheduledFromId: null, isExtra: false,
    });
    expect(classes(dueNow(planNotifications(data({ instances: [inst('cancelled')] }), at(9 * 60 + 45)), at(9 * 60 + 45)))).toHaveLength(0);
    expect(classes(dueNow(planNotifications(data({ instances: [inst('present')] }), at(11 * 60 + 5)), at(11 * 60 + 5)))).toHaveLength(0);
  });

  it('honours custom offsets and disabled categories', () => {
    const s = settings({ notifications: { categories: { classes: { offsets: [30, 5] }, attendance: { enabled: false } } } });
    const planned = planNotifications(data({ settings: s }), at(12 * 60), 180, 0);
    expect(planned.filter((n) => n.type === 'class_reminder').map((n) => n.time)).toEqual(['09:30', '09:55']);
    expect(planned.some((n) => n.type === 'attendance_prompt')).toBe(false);
  });

  it('reminds about tasks, assignments and exams at their offsets', () => {
    const planned = planNotifications(
      data({
        tasks: [{ ...meta('t1'), title: 'DBMS Assignment', notes: null, category: 'Study', priority: 'high', importance: 3, dueDate: '2026-10-02', dueTime: '20:00', plannedDate: null, estimatedMinutes: null, subjectId: null, status: 'todo', completedAt: null, dependsOn: [], source: 'manual' }],
        exams: [{ ...meta('x1'), subjectId: null, title: 'DBMS Mid-Sem', kind: 'midsem', date: '2026-10-09', startTime: '10:00', room: null, topics: null, notes: null }],
        assignments: [{ ...meta('a1'), subjectId: 'os', title: 'OS Assignment', description: null, deadline: '2026-10-03', deadlineTime: '23:59', priority: 'medium', estimatedMinutes: null, status: 'todo' }],
      }),
      at(0),
      0,
      24 * 60,
    );
    const task = planned.find((n) => n.type === 'task_due')!;
    expect(task).toMatchObject({ time: '19:00', body: 'DBMS Assignment\nDue today at 8:00 PM.' });
    expect(planned.find((n) => n.type === 'exam_reminder')).toMatchObject({ time: '10:00', body: 'DBMS Mid-Sem\n7 days remaining.' });
    expect(planned.find((n) => n.type === 'assignment_due')).toMatchObject({ time: '23:59', body: 'OS Assignment (Operating Systems)\nDue tomorrow.' });
  });

  it('fires recurring reminders, skipping completed dates', () => {
    const rem = { ...meta('r1'), title: 'Plan my week', notes: null, date: '2026-09-06', time: '20:00', recurrence: { freq: 'weekly' as const, interval: 1, weekdays: [0], unit: 'day' as const, until: null }, active: true, doneDates: ['2026-10-04'], source: 'manual' as const };
    const sunday = { date: '2026-10-11', minutes: 20 * 60 };
    expect(dueNow(planNotifications(data({ reminders: [rem] }), sunday), sunday).filter((n) => n.type === 'reminder').map((n) => n.title)).toEqual(['⏰ Plan my week']);
    const doneSunday = { date: '2026-10-04', minutes: 20 * 60 };
    expect(dueNow(planNotifications(data({ reminders: [rem] }), doneSunday), doneSunday).filter((n) => n.type === 'reminder')).toHaveLength(0);
  });

  it('raises an attendance alert once per change in counts', () => {
    const mk = (date: string, status: 'present' | 'absent') => ({
      ...meta(`${date}`), scheduleId: 's1', subjectId: 'os', date, startTime: '10:00', endTime: '11:00', room: null, status, note: null, rescheduledToId: null, rescheduledFromId: null, isExtra: false,
    });
    // Fridays 11, 18, 25 Sep present; 2 Oct absent → 3/4 = 75%, can miss 0
    const instances = [mk('2026-09-11', 'present'), mk('2026-09-18', 'present'), mk('2026-09-25', 'present'), mk('2026-10-02', 'absent')];
    const fixed = instances.map((i) => ({ ...i, id: instanceIdFor('s1', i.date) }));
    const noon = at(12 * 60);
    // Semester ends 16 Oct: 2 classes left, (3+2)/(4+2)=83% max, can miss 0 → alert. (With 11 left it could miss 2: no alert.)
    expect(dueNow(planNotifications(data({ instances: fixed }), noon), noon).filter((n) => n.type === 'attendance_risk')).toHaveLength(0);
    const risk = dueNow(planNotifications(data({ instances: fixed, settings: settings({ semesterEnd: '2026-10-16' }) }), noon), noon).filter((n) => n.type === 'attendance_risk');
    expect(risk).toHaveLength(1);
    expect(risk[0]!.key).toBe('risk:os:3/4');
  });
});

describe('recurrence', () => {
  it('expands daily, weekday, weekly and monthly rules', () => {
    const r = (freq: string, extra = {}) => ({ freq, interval: 1, weekdays: [], unit: 'day', until: null, ...extra }) as never;
    expect(reminderDates('2026-10-01', r('daily', { interval: 2 }), '2026-10-01', '2026-10-06')).toEqual(['2026-10-01', '2026-10-03', '2026-10-05']);
    expect(reminderDates('2026-10-01', r('weekdays'), '2026-10-02', '2026-10-06')).toEqual(['2026-10-02', '2026-10-05', '2026-10-06']);
    expect(reminderDates('2026-10-05', r('weekly', { weekdays: [1, 3] }), '2026-10-05', '2026-10-14')).toEqual(['2026-10-05', '2026-10-07', '2026-10-12', '2026-10-14']);
    expect(reminderDates('2026-01-31', r('monthly'), '2026-01-01', '2026-04-30')).toEqual(['2026-01-31', '2026-03-31']);
    expect(reminderDates('2026-10-01', r('none'), '2026-10-02', '2026-10-09')).toEqual([]);
  });
});

describe('timezones', () => {
  it('computes wall-clock time in the user timezone, including DST', () => {
    expect(localMomentIn('Asia/Kolkata', new Date('2026-10-02T04:30:00Z'))).toEqual({ date: '2026-10-02', minutes: 10 * 60 });
    // US DST ends 2026-11-01: 13:00Z is 08:00 EST
    expect(localMomentIn('America/New_York', new Date('2026-11-02T13:00:00Z'))).toEqual({ date: '2026-11-02', minutes: 8 * 60 });
    expect(localMomentIn('Not/AZone', new Date('2026-10-02T04:30:00Z')).minutes).toBe(4 * 60 + 30);
  });
});

describe('AI action registry', () => {
  it('reports a turned-off action as not permitted, even with malformed params', () => {
    const perms = settings().aiPermissions;
    const { intents, rejected } = validateIntents([{ action: 'update_profile', params: {} }], { ...perms, updateProfile: false });
    expect(intents).toEqual([]);
    expect(rejected[0]?.reason).toMatch(/^Not permitted: Update profile/);
    // Reminder-only settings changes need just the notification permission.
    const ok = validateIntents([{ action: 'update_settings', params: { changes: { classReminderMinutes: [10] } } }], { ...perms, modifySettings: false, modifyNotifications: true });
    expect(ok.intents).toHaveLength(1);
  });

  it('validates intents and rejects unknown, malformed or unpermitted ones', () => {
    const { intents, rejected } = validateIntents(
      [
        { action: 'mark_attendance', params: { target: { subject: 'DBMS', date: '2026-10-02' }, status: 'present' } },
        { action: 'reschedule_class', params: { target: { subject: 'DBMS', date: '2026-10-03', time: '10 AM' }, newStartTime: '2 PM' } },
        { action: 'drop_table', params: {} },
        { action: 'create_task', params: { title: '' } },
        { action: 'delete_task', params: { target: { title: 'x' } } },
        { action: 'move_revisions', params: { fromDate: '2026-10-03', toDate: '2026-10-04' } },
      ],
      { ...settings().aiPermissions, deleteTasks: false, bulkChanges: false },
    );
    expect(intents.map((i) => i.action)).toEqual(['mark_attendance', 'reschedule_class']);
    expect(intents[1]!.params).toMatchObject({ target: { time: '10:00' }, newStartTime: '14:00' });
    expect(rejected.map((r) => r.action)).toEqual(['drop_table', 'create_task', 'delete_task', 'move_revisions']);
    expect(rejected[2]!.reason).toMatch(/Delete todos/);
    expect(rejected[3]!.reason).toMatch(/many items at once/);
  });

  it('never lets AI Pilot change AI Power or its own permissions, whatever is granted', () => {
    const all = Object.fromEntries(Object.keys(PERMISSION_LABEL).map((k) => [k, true]));
    const { intents, rejected } = validateIntents(
      [
        { action: 'update_settings', params: { changes: { aiPower: 'maximum' } } },
        { action: 'update_settings', params: { changes: { minAttendance: 80, aiPower: 'maximum' } } },
        { action: 'update_settings', params: { changes: { aiPermissions: { deleteTasks: true } } } },
        { action: 'set_ai_power', params: { level: 'maximum' } },
        { action: 'update_settings', params: { changes: { minAttendance: 80 } } },
      ],
      all,
    );
    expect(intents.map((i) => i.action)).toEqual(['update_settings']);
    expect(rejected).toHaveLength(4);
    for (const r of rejected) expect(r.reason).toMatch(/^Protected: AI Power and AI permissions can only be changed by you/);
  });

  it('validates profile updates and asks for complete study hours', () => {
    const perms = settings().aiPermissions;
    const ok = validateIntents([{ action: 'update_profile', params: { changes: { name: 'Advitiya', studyStart: '7 PM', studyEnd: '11 PM' } } }], perms);
    expect(ok.intents[0]!.params).toMatchObject({ changes: { name: 'Advitiya', studyStart: '19:00', studyEnd: '23:00' } });
    expect(validateIntents([{ action: 'update_profile', params: { changes: {} } }], perms).rejected[0]!.reason).toMatch(/No profile change/);
    expect(validateIntents([{ action: 'update_profile', params: { changes: { studyStart: '19:00' } } }], perms).rejected[0]!.reason).toMatch(/start and an end/);
    expect(validateIntents([{ action: 'update_profile', params: { changes: { name: 'X' } } }], { ...perms, updateProfile: false }).rejected[0]!.reason).toMatch(/Update profile/);
  });

  it('auto-applies only creates/updates in areas with full access, never deletions or bulk changes', () => {
    const perms = settingsSchema.parse({ ...meta('settings'), aiPermissions: { access: { tasks: 'full' } } }).aiPermissions;
    expect(canAutoApply('create_task', perms)).toBe(true);
    expect(canAutoApply('update_task', perms)).toBe(true);
    expect(canAutoApply('delete_task', perms)).toBe(false);
    expect(canAutoApply('create_event', perms)).toBe(false);
    expect(canAutoApply('move_revisions', { access: { ...perms.access, learning: 'full' } })).toBe(false);
  });

  it('needs the notification permission to change reminder timing', () => {
    const perms = { ...settings().aiPermissions, modifyNotifications: false };
    expect(validateIntents([{ action: 'update_settings', params: { changes: { classReminderMinutes: [10] } } }], perms).rejected[0]!.reason).toMatch(/notification preferences/);
    expect(validateIntents([{ action: 'update_settings', params: { changes: { minAttendance: 80 } } }], perms).intents).toHaveLength(1);
  });

  it('refs are short, stable and do not reveal ids', () => {
    const id = '6f1c7a52-6a0e-4e55-9a51-2b1f3f9c0d11';
    expect(refOf('c', id)).toBe(refOf('c', id));
    expect(refOf('c', id)).toMatch(/^c[0-9a-z]{6}$/);
    expect(refOf('c', id)).not.toContain('6f1c');
  });

  it('finds free time around classes and events', () => {
    const { free } = freeSlots(
      '2026-10-02',
      [{ date: '2026-10-02', startTime: '09:00', endTime: '13:00', status: null } as never],
      [{ date: '2026-10-02', startTime: '18:00', endTime: '19:00', title: 'Gym', deletedAt: null }],
      { dayStart: '08:00', dayEnd: '22:00', notBefore: 14 * 60 },
    );
    expect(free).toEqual([
      { start: '14:00', end: '18:00', label: 'free' },
      { start: '19:00', end: '22:00', label: 'free' },
    ]);
  });
});

import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  applyRating,
  attendancePercent,
  chatResponseSchema,
  classesCanMiss,
  classesNeededToReach,
  computeStreak,
  countAttendance,
  diffDays,
  extractJson,
  generateOccurrences,
  initialRevisions,
  instanceIdFor,
  normalizeTime,
  parseWeekday,
  projectSemester,
  quizResponseSchema,
  rankTasks,
  remainingClassesBySubject,
  resolveOccurrences,
  resolveWrite,
  riskLevel,
  scoreTask,
  summarizeSubject,
  timetableExtractionSchema,
  weekdayOf,
  whatIf,
} from './index';

describe('dates', () => {
  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-03-01', -1)).toBe('2027-02-28');
  });
  it('clamps month addition to the last day', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
  });
  it('computes weekdays and differences', () => {
    expect(weekdayOf('2026-10-05')).toBe(1); // Monday
    expect(diffDays('2026-10-02', '2026-10-15')).toBe(13);
  });
  it('normalises loose times and weekdays', () => {
    expect(normalizeTime('9:30')).toBe('09:30');
    expect(normalizeTime('2 PM')).toBe('14:00');
    expect(normalizeTime('12:15am')).toBe('00:15');
    expect(normalizeTime('25:00')).toBeNull();
    expect(parseWeekday('Mon')).toBe(1);
    expect(parseWeekday('THURSDAY')).toBe(4);
    expect(parseWeekday('xyz')).toBeNull();
  });
});

describe('attendance', () => {
  const today = '2026-10-10';
  it('excludes cancelled and rescheduled classes from conducted', () => {
    const c = countAttendance(
      [
        { date: '2026-10-01', status: 'present' },
        { date: '2026-10-02', status: 'absent' },
        { date: '2026-10-03', status: 'cancelled' },
        { date: '2026-10-04', status: 'rescheduled' },
        { date: '2026-10-05', status: null },
        { date: '2026-10-06', status: 'unsure' },
        { date: '2026-10-20', status: null },
      ],
      today,
    );
    expect(c).toEqual({ present: 1, absent: 1, conducted: 2, cancelled: 1, unmarked: 2 });
  });

  it('matches the spec example (34/40 = 85%)', () => {
    expect(attendancePercent(34, 40)).toBe(85);
    expect(attendancePercent(0, 0)).toBeNull();
  });

  it('computes classes needed to reach a target', () => {
    // 18/25 = 72% → need n with (18+n)/(25+n) >= .75 → n >= 3
    expect(classesNeededToReach(18, 25, 75)).toBe(3);
    expect(classesNeededToReach(30, 40, 75)).toBe(0); // exactly 75%
    expect(classesNeededToReach(9, 10, 100)).toBe(Infinity);
  });

  it('computes classes that can be missed', () => {
    // 43/50 = 86% → 43/(50+m) >= .75 → m <= 7.33 → 7
    expect(classesCanMiss(43, 50, 75)).toBe(7);
    expect(classesCanMiss(30, 40, 75)).toBe(0);
    expect(classesCanMiss(10, 20, 75)).toBe(0);
  });

  it('projects against remaining classes in the semester', () => {
    // 30/40, 10 remaining: (30+10-m)/50 >= .75 → m <= 2.5 → 2
    expect(projectSemester(30, 40, 10, 75)).toMatchObject({ maxMissable: 2, mustAttend: 8 });
    // 10/30, 5 remaining: best = 15/35 = 42.9% → impossible
    expect(projectSemester(10, 30, 5, 75).maxMissable).toBe(-1);
  });

  it('answers what-if questions', () => {
    expect(whatIf(39, 50, 0, 2)).toBeCloseTo(75);
    expect(whatIf(0, 0, 0, 0)).toBeNull();
  });

  it('classifies risk', () => {
    const th = { min: 75, target: 80, safe: 85 };
    expect(riskLevel(90, th)).toBe('safe');
    expect(riskLevel(82, th)).toBe('on_track');
    expect(riskLevel(75, th)).toBe('at_risk');
    expect(riskLevel(74.9, th)).toBe('below_min');
    expect(riskLevel(null, th)).toBe('no_data');
  });

  it('produces advice that accounts for remaining classes', () => {
    const counts = { present: 18, absent: 7, conducted: 25, cancelled: 0, unmarked: 0 };
    const s = summarizeSubject(counts, { min: 75, target: 80, safe: 85 }, 2);
    expect(s.risk).toBe('below_min');
    expect(s.neededForMin).toBe(3);
    expect(s.advice).toMatch(/Even attending all 2 remaining/);
  });
});

describe('recurrence', () => {
  const schedule = {
    id: 'sched-1',
    subjectId: 'os',
    weekday: 1,
    startTime: '10:00',
    endTime: '11:00',
    room: 'B-204',
    type: 'lecture' as const,
    active: true,
    validFrom: null,
    validUntil: null,
    deletedAt: null,
  };

  it('generates weekly occurrences with deterministic ids', () => {
    const occ = generateOccurrences([schedule], '2026-10-01', '2026-10-31');
    expect(occ.map((o) => o.date)).toEqual(['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26']);
    expect(occ[0]!.id).toBe(instanceIdFor('sched-1', '2026-10-05'));
    expect(instanceIdFor('sched-1', '2026-10-05')).toBe(instanceIdFor('sched-1', '2026-10-05'));
  });

  it('respects holidays and semester bounds', () => {
    const occ = generateOccurrences([schedule], '2026-10-01', '2026-10-31', {
      holidays: ['2026-10-12'],
      semesterEnd: '2026-10-20',
    });
    expect(occ.map((o) => o.date)).toEqual(['2026-10-05', '2026-10-19']);
  });

  it('merges stored instances, cancellations and rescheduled replacements', () => {
    const base = { deletedAt: null, room: 'B-204', rescheduledToId: null, rescheduledFromId: null, isExtra: false };
    const instances = [
      { ...base, id: instanceIdFor('sched-1', '2026-10-05'), scheduleId: 'sched-1', subjectId: 'os', date: '2026-10-05', startTime: '10:00', endTime: '11:00', status: 'present' as const },
      { ...base, id: instanceIdFor('sched-1', '2026-10-12'), scheduleId: 'sched-1', subjectId: 'os', date: '2026-10-12', startTime: '10:00', endTime: '11:00', status: 'rescheduled' as const, rescheduledToId: 'extra-1' },
      { ...base, id: 'extra-1', scheduleId: 'sched-1', subjectId: 'os', date: '2026-10-14', startTime: '14:00', endTime: '15:00', status: null, isExtra: true, rescheduledFromId: instanceIdFor('sched-1', '2026-10-12') },
    ];
    const occ = resolveOccurrences([schedule], instances, '2026-10-01', '2026-10-20');
    expect(occ.map((o) => [o.date, o.status])).toEqual([
      ['2026-10-05', 'present'],
      ['2026-10-12', 'rescheduled'],
      ['2026-10-14', null],
      ['2026-10-19', null],
    ]);
    const counts = countAttendance(occ, '2026-10-20');
    expect(counts.conducted).toBe(1);
    expect(counts.unmarked).toBe(2); // replacement on 14th + 19th
  });

  it('counts remaining classes until semester end', () => {
    const remaining = remainingClassesBySubject([schedule], [], '2026-10-06', { semesterEnd: '2026-10-31' });
    expect(remaining?.get('os')).toBe(3); // Oct 12, 19, 26
    expect(remainingClassesBySubject([schedule], [], '2026-10-06', {})).toBeNull();
  });
});

describe('revision', () => {
  it('creates the default Day 1/3/7/30/90/180 schedule', () => {
    const r = initialRevisions('2026-10-02');
    expect(r.map((x) => x.dueDate)).toEqual(['2026-10-03', '2026-10-05', '2026-10-09', '2026-11-01', '2026-12-31', '2027-03-31']);
    expect(r.map((x) => x.stage)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('forgot → tomorrow and restart', () => {
    const out = applyRating({ stage: 2, ease: 1 }, 3, 'forgot', '2026-10-09');
    expect(out.upcoming[0]).toEqual({ stage: 1, dueDate: '2026-10-10' });
    expect(out.state.stage).toBe(0);
    expect(out.state.ease).toBeLessThan(1);
  });

  it('partial → 2 days, same stage', () => {
    const out = applyRating({ stage: 2, ease: 1 }, 3, 'partial', '2026-10-09');
    expect(out.upcoming[0]).toEqual({ stage: 3, dueDate: '2026-10-11' });
  });

  it('remembered → next ladder gap; easy extends it', () => {
    const remembered = applyRating({ stage: 2, ease: 1 }, 3, 'remembered', '2026-10-09');
    expect(remembered.upcoming[0]).toEqual({ stage: 4, dueDate: '2026-11-01' }); // gap 23
    const easy = applyRating({ stage: 2, ease: 1 }, 3, 'easy', '2026-10-09');
    expect(easy.upcoming[0]!.dueDate > remembered.upcoming[0]!.dueDate).toBe(true);
    expect(easy.state.ease).toBeGreaterThan(1);
  });

  it('marks topic mastered after the last stage', () => {
    const out = applyRating({ stage: 5, ease: 1 }, 6, 'remembered', '2027-03-31');
    expect(out.mastered).toBe(true);
    expect(out.upcoming).toEqual([]);
  });
});

describe('priority', () => {
  const today = '2026-10-02';
  it('explains why a task ranks high', () => {
    const s = scoreTask({ id: '1', title: 'DBMS Assignment', priority: 'high', dueDate: '2026-10-03', estimatedMinutes: 120, status: 'todo' }, today);
    expect(s.level).toBe('critical');
    expect(s.reasons).toContain('Due tomorrow');
    expect(s.reasons.some((r) => r.includes('2h'))).toBe(true);
  });
  it('ranks overdue above far-future and demotes blocked tasks', () => {
    const ranked = rankTasks(
      [
        { id: 'a', title: 'Later', priority: 'high', dueDate: '2026-11-01', estimatedMinutes: null, status: 'todo' },
        { id: 'b', title: 'Overdue', priority: 'low', dueDate: '2026-09-30', estimatedMinutes: null, status: 'todo' },
        { id: 'c', title: 'Blocked', priority: 'urgent', dueDate: '2026-10-02', estimatedMinutes: null, status: 'todo', dependsOn: ['b'] },
        { id: 'd', title: 'Done', priority: 'urgent', dueDate: null, estimatedMinutes: null, status: 'done' },
      ],
      today,
    );
    expect(ranked.map((t) => t.id)).toEqual(['b', 'c', 'a']);
    expect(ranked[1]!.priorityScore.reasons.at(-1)).toMatch(/Waiting on: Overdue/);
  });
});

describe('conflict resolution', () => {
  const rec = (updatedAt: string, deviceId: string, version: number, status: string) => ({ updatedAt, deviceId, version, status });
  it('inserts and fast-forwards without conflict', () => {
    expect(resolveWrite(null, rec('2026-10-02T10:00:00Z', 'A', 0, 'present'), 0).kind).toBe('insert');
    expect(resolveWrite(rec('2026-10-02T10:00:00Z', 'A', 1, 'present'), rec('2026-10-02T11:00:00Z', 'A', 1, 'absent'), 1).kind).toBe('fast_forward');
  });
  it('resolves concurrent writes by last-write-wins and keeps the loser', () => {
    const stored = rec('2026-10-02T10:05:00Z', 'B', 2, 'absent');
    const incoming = rec('2026-10-02T10:01:00Z', 'A', 1, 'present');
    const r = resolveWrite(stored, incoming, 1);
    expect(r.kind).toBe('conflict');
    if (r.kind === 'conflict') {
      expect(r.incomingWon).toBe(false);
      expect(r.winner.status).toBe('absent');
      expect(r.loser.status).toBe('present');
    }
  });
  it('breaks timestamp ties deterministically by deviceId', () => {
    const stored = rec('2026-10-02T10:00:00Z', 'A', 2, 'absent');
    const incoming = rec('2026-10-02T10:00:00Z', 'B', 1, 'present');
    const r = resolveWrite(stored, incoming, 1);
    expect(r.kind === 'conflict' && r.incomingWon).toBe(true);
  });
});

describe('AI output validation', () => {
  it('normalises a valid timetable extraction', () => {
    const parsed = timetableExtractionSchema.parse({
      semester: '5',
      subjects: [{ name: 'DBMS', day: 'Mon', start_time: '9:00', end_time: '10 AM', type: 'Theory', faculty: '' }],
    });
    expect(parsed.subjects[0]).toMatchObject({ day: 1, start_time: '09:00', end_time: '10:00', type: 'lecture', faculty: null });
  });
  it('rejects malformed entries such as a null subject', () => {
    expect(timetableExtractionSchema.safeParse({ subjects: [{ name: null, day: 'Mon', start_time: '9', end_time: '10' }] }).success).toBe(false);
    expect(timetableExtractionSchema.safeParse({ subject: null }).success).toBe(false);
    expect(timetableExtractionSchema.safeParse({ subjects: [{ name: 'X', day: 'Funday', start_time: '9', end_time: '10' }] }).success).toBe(false);
  });
  it('drops invalid chat actions but keeps valid ones', () => {
    const r = chatResponseSchema.parse({
      reply: 'Here you go',
      actions: [
        { type: 'create_tasks', tasks: [{ title: 'Revise CPU Scheduling', dueDate: '2026-10-03', priority: 'HIGH' }] },
        { type: 'drop_database' },
        { type: 'create_tasks', tasks: [{ title: '' }] },
      ],
    });
    expect(r.actions).toHaveLength(1);
    expect(r.actions[0]).toMatchObject({ type: 'create_tasks', tasks: [{ priority: 'high', category: 'Study' }] });
  });
  it('rejects quiz answers out of range', () => {
    expect(quizResponseSchema.safeParse({ questions: [{ question: 'Q', options: ['a', 'b'], answerIndex: 3 }] }).success).toBe(false);
  });
  it('extracts JSON from fenced model output', () => {
    expect(extractJson('Sure!\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('prefix {"b":2} suffix')).toEqual({ b: 2 });
    expect(() => extractJson('no json here')).toThrow();
  });
});

describe('streaks', () => {
  it('counts a streak ending today or yesterday', () => {
    expect(computeStreak(['2026-10-01', '2026-10-02', '2026-09-30'], '2026-10-02')).toBe(3);
    expect(computeStreak(['2026-10-01', '2026-09-30'], '2026-10-02')).toBe(2);
    expect(computeStreak(['2026-09-29'], '2026-10-02')).toBe(0);
  });
});

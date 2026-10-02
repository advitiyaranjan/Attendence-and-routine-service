/**
 * Pure derived views over a student's data, shared by the web app (from
 * IndexedDB), the service worker and the server (from Postgres).
 */
import { countAttendance, summarizeSubject, type SubjectAttendanceSummary, type Thresholds } from './attendance';
import { addDays, timeToMinutes, minutesToTime, type ISODate } from './dates';
import type { Basket, CalendarEvent, ClassInstance, ClassSchedule, Settings, Subject } from './entities';
import { remainingClassesBySubject, resolveOccurrences, rulesForSubject, type CalendarRules, type ClassOccurrence, type DateRules } from './recurrence';

/** A subject's basket, if it has a live one. */
export function basketOf(subject: Pick<Subject, 'basketId'> | undefined, baskets: Basket[] = []): Basket | null {
  if (!subject?.basketId) return null;
  return baskets.find((b) => b.id === subject.basketId && !b.deletedAt) ?? null;
}

/** A basket's date rules: its own holidays on top of the global ones, its own term dates if set. */
export function basketRules(settings: Pick<Settings, 'holidays' | 'semesterStart' | 'semesterEnd'>, basket: Basket): DateRules {
  return {
    holidays: [...settings.holidays, ...basket.holidays],
    semesterStart: basket.termStart ?? settings.semesterStart,
    semesterEnd: basket.termEnd ?? settings.semesterEnd,
  };
}

/** Calendar rules for the timetable: global settings, overridden per subject by its basket. */
export function rulesFrom(
  settings: Pick<Settings, 'holidays' | 'semesterStart' | 'semesterEnd'>,
  subjects: Pick<Subject, 'id' | 'basketId'>[] = [],
  baskets: Basket[] = [],
): CalendarRules {
  const bySubject: Record<string, DateRules> = {};
  for (const subject of subjects) {
    const basket = basketOf(subject, baskets);
    if (basket) bySubject[subject.id] = basketRules(settings, basket);
  }
  return {
    holidays: settings.holidays,
    semesterStart: settings.semesterStart,
    semesterEnd: settings.semesterEnd,
    bySubject,
  };
}

/** Attendance thresholds: the subject's own, else its basket's, else the global setting. */
export function thresholdsFor(settings: Pick<Settings, 'minAttendance' | 'targetAttendance' | 'safeAttendance'>, subject?: Subject, basket?: Basket | null): Thresholds {
  const target = subject?.targetAttendance ?? basket?.targetAttendance ?? null;
  return {
    min: subject?.minAttendance ?? basket?.minAttendance ?? settings.minAttendance,
    target: target ?? settings.targetAttendance,
    safe: Math.max(settings.safeAttendance, target ?? 0),
  };
}

/** Where attendance counting starts: the earliest term start, or the earliest timetable entry. */
export function trackingStart(rules: CalendarRules, schedules: ClassSchedule[], instances: ClassInstance[]): ISODate | null {
  const termStarts = [rules.semesterStart, ...Object.values(rules.bySubject ?? {}).map((r) => r.semesterStart)].filter((d): d is ISODate => !!d);
  const candidates = rules.semesterStart
    ? termStarts
    : [
        ...termStarts,
        ...schedules.map((s) => s.validFrom ?? s.createdAt.slice(0, 10)),
        ...instances.filter((i) => !i.deletedAt).map((i) => i.date),
      ];
  return candidates.length ? candidates.sort()[0]! : null;
}

export interface SubjectAttendance {
  subject: Subject;
  basket: Basket | null;
  thresholds: Thresholds;
  summary: SubjectAttendanceSummary;
}

export interface AttendanceOverview {
  subjects: SubjectAttendance[];
  overall: { present: number; conducted: number; percent: number | null; unmarked: number };
  /** Past occurrences (oldest first) that still need a decision. */
  unmarked: ClassOccurrence[];
}

export interface TimetableData {
  settings: Settings;
  subjects: Subject[];
  schedules: ClassSchedule[];
  instances: ClassInstance[];
  baskets?: Basket[];
}

export function attendanceOverview({ settings, subjects, schedules, instances, baskets = [] }: TimetableData, today: ISODate): AttendanceOverview {
  const active = subjects.filter((s) => !s.deletedAt);
  const liveSchedules = schedules.filter((s) => !s.deletedAt);
  const rules = rulesFrom(settings, active, baskets);
  const start = trackingStart(rules, liveSchedules, instances);
  const past = start && start <= today ? resolveOccurrences(liveSchedules, instances, start, today, rules) : [];
  const remaining = remainingClassesBySubject(liveSchedules, instances, addDays(today, 1), rules);

  const bySubject = new Map<string, ClassOccurrence[]>();
  for (const o of past) {
    if (!bySubject.has(o.subjectId)) bySubject.set(o.subjectId, []);
    bySubject.get(o.subjectId)!.push(o);
  }
  const list: SubjectAttendance[] = active.map((subject) => {
    const basket = basketOf(subject, baskets);
    const thresholds = thresholdsFor(settings, subject, basket);
    const hasTermEnd = !!rulesForSubject(rules, subject.id).semesterEnd;
    return {
      subject,
      basket,
      thresholds,
      summary: summarizeSubject(
        countAttendance(bySubject.get(subject.id) ?? [], today),
        thresholds,
        remaining && hasTermEnd ? (remaining.get(subject.id) ?? 0) : null,
      ),
    };
  });
  const present = list.reduce((a, s) => a + s.summary.present, 0);
  const conducted = list.reduce((a, s) => a + s.summary.conducted, 0);
  const unmarked = past.filter((o) => (o.status === null || o.status === 'unsure') && active.some((s) => s.id === o.subjectId));
  return {
    subjects: list,
    overall: { present, conducted, percent: conducted ? (present / conducted) * 100 : null, unmarked: unmarked.length },
    unmarked,
  };
}

export interface TimeBlock {
  start: string;
  end: string;
  label: string;
}

/**
 * Free time on a date between `dayStart` and `dayEnd`, after removing classes
 * and timed calendar events. Gaps shorter than `minMinutes` are dropped.
 */
export function freeSlots(
  date: ISODate,
  classes: ClassOccurrence[],
  events: Pick<CalendarEvent, 'date' | 'startTime' | 'endTime' | 'title' | 'deletedAt'>[],
  opts: { dayStart?: string; dayEnd?: string; minMinutes?: number; notBefore?: number } = {},
): { busy: TimeBlock[]; free: TimeBlock[] } {
  const busy: TimeBlock[] = [
    ...classes
      .filter((c) => c.date === date && c.status !== 'cancelled' && c.status !== 'rescheduled')
      .map((c) => ({ start: c.startTime, end: c.endTime, label: 'class' })),
    ...events
      .filter((e) => !e.deletedAt && e.date === date && e.startTime && e.endTime)
      .map((e) => ({ start: e.startTime!, end: e.endTime!, label: e.title })),
  ].sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));

  const dayStart = Math.max(timeToMinutes(opts.dayStart ?? '07:00'), opts.notBefore ?? 0);
  const dayEnd = timeToMinutes(opts.dayEnd ?? '23:00');
  const min = opts.minMinutes ?? 30;
  const free: TimeBlock[] = [];
  let cursor = dayStart;
  for (const b of busy) {
    const s = timeToMinutes(b.start);
    const e = timeToMinutes(b.end);
    if (s - cursor >= min) free.push({ start: minutesToTime(cursor), end: minutesToTime(Math.min(s, dayEnd)), label: 'free' });
    cursor = Math.max(cursor, e);
  }
  if (dayEnd - cursor >= min) free.push({ start: minutesToTime(cursor), end: minutesToTime(dayEnd), label: 'free' });
  return { busy, free: free.filter((f) => timeToMinutes(f.end) - timeToMinutes(f.start) >= min) };
}

/** Short opaque reference for an id, so the AI can point at records without seeing database ids. */
export function refOf(prefix: string, id: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${prefix}${(h >>> 0).toString(36).padStart(6, '0').slice(0, 6)}`;
}

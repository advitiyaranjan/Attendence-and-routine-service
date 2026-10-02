/**
 * Recurring timetable engine.
 *
 * ClassSchedule = the rule ("every Monday 10:00–11:00").
 * ClassInstance = what happened on a specific date.
 *
 * Future occurrences are generated on demand; an instance is only stored once
 * the student does something to it. Materialised instances use a deterministic
 * UUID (v5 of scheduleId + date) so two offline devices marking the same class
 * produce the same record, which the sync engine can then reconcile.
 */
import { v5 as uuidv5 } from 'uuid';
import { addDays, diffDays, eachDay, timeToMinutes, weekdayOf, type ISODate } from './dates';
import type { ClassInstance, ClassSchedule, AttendanceStatus } from './entities';

const INSTANCE_NAMESPACE = '6f1c7a52-6a0e-4e55-9a51-2b1f3f9c0d11';

export function instanceIdFor(scheduleId: string, date: ISODate): string {
  return uuidv5(`${scheduleId}@${date}`, INSTANCE_NAMESPACE);
}

export interface DateRules {
  holidays?: string[];
  semesterStart?: ISODate | null;
  semesterEnd?: ISODate | null;
}

export interface CalendarRules extends DateRules {
  /** Rules that replace the global ones for a subject's classes (from the subject's basket). */
  bySubject?: Record<string, DateRules>;
}

/** The date rules that govern one subject's classes. */
export function rulesForSubject(rules: CalendarRules, subjectId: string): DateRules {
  return rules.bySubject?.[subjectId] ?? rules;
}

interface CompiledRules {
  holidays: Set<string>;
  start: ISODate | null;
  end: ISODate | null;
}

function compileRules(rules: CalendarRules): (subjectId: string) => CompiledRules {
  const compile = (r: DateRules): CompiledRules => ({ holidays: new Set(r.holidays ?? []), start: r.semesterStart ?? null, end: r.semesterEnd ?? null });
  const base = compile(rules);
  const bySubject = new Map(Object.entries(rules.bySubject ?? {}).map(([id, r]) => [id, compile(r)]));
  return (subjectId) => bySubject.get(subjectId) ?? base;
}

/** A class on a specific date, whether stored or generated. */
export interface ClassOccurrence {
  /** Deterministic for scheduled occurrences, the stored id for extras. */
  id: string;
  scheduleId: string | null;
  subjectId: string;
  date: ISODate;
  startTime: string;
  endTime: string;
  room: string | null;
  type: ClassSchedule['type'];
  status: AttendanceStatus | null;
  rescheduledToId: string | null;
  rescheduledFromId: string | null;
  isExtra: boolean;
  /** True when backed by a stored ClassInstance. */
  materialized: boolean;
}

type ScheduleLike = Pick<
  ClassSchedule,
  'id' | 'subjectId' | 'weekday' | 'startTime' | 'endTime' | 'room' | 'type' | 'active' | 'validFrom' | 'validUntil' | 'deletedAt'
>;

function scheduleAppliesOn(s: ScheduleLike, date: ISODate, rules: CompiledRules): boolean {
  if (!s.active || s.deletedAt) return false;
  if (weekdayOf(date) !== s.weekday) return false;
  if (s.validFrom && date < s.validFrom) return false;
  if (s.validUntil && date > s.validUntil) return false;
  if (rules.start && date < rules.start) return false;
  if (rules.end && date > rules.end) return false;
  if (rules.holidays.has(date)) return false;
  return true;
}

/** Generate scheduled occurrences (ignoring stored instances) in [from, to]. */
export function generateOccurrences(
  schedules: ScheduleLike[],
  from: ISODate,
  to: ISODate,
  rules: CalendarRules = {},
): ClassOccurrence[] {
  const ruleFor = compileRules(rules);
  const out: ClassOccurrence[] = [];
  if (to < from) return out;
  for (const date of eachDay(from, to)) {
    for (const s of schedules) {
      if (!scheduleAppliesOn(s, date, ruleFor(s.subjectId))) continue;
      out.push({
        id: instanceIdFor(s.id, date),
        scheduleId: s.id,
        subjectId: s.subjectId,
        date,
        startTime: s.startTime,
        endTime: s.endTime,
        room: s.room,
        type: s.type,
        status: null,
        rescheduledToId: null,
        rescheduledFromId: null,
        isExtra: false,
        materialized: false,
      });
    }
  }
  return out;
}

type InstanceLike = Pick<
  ClassInstance,
  | 'id'
  | 'scheduleId'
  | 'subjectId'
  | 'date'
  | 'startTime'
  | 'endTime'
  | 'room'
  | 'status'
  | 'rescheduledToId'
  | 'rescheduledFromId'
  | 'isExtra'
  | 'deletedAt'
>;

/**
 * Merge generated occurrences with stored instances in [from, to].
 * Stored instances override generated ones with the same id; stored extras and
 * rescheduled replacements are added.
 */
export function resolveOccurrences(
  schedules: ScheduleLike[],
  instances: InstanceLike[],
  from: ISODate,
  to: ISODate,
  rules: CalendarRules = {},
): ClassOccurrence[] {
  const scheduleById = new Map(schedules.map((s) => [s.id, s]));
  const stored = new Map<string, InstanceLike>();
  for (const i of instances) {
    if (!i.deletedAt && i.date >= from && i.date <= to) stored.set(i.id, i);
  }

  const result: ClassOccurrence[] = [];
  for (const occ of generateOccurrences(schedules, from, to, rules)) {
    const inst = stored.get(occ.id);
    if (inst) {
      stored.delete(occ.id);
      result.push(fromInstance(inst, occ.type));
    } else {
      result.push(occ);
    }
  }
  // Remaining stored instances: extras, replacements, or instances whose schedule changed.
  for (const inst of stored.values()) {
    const type = inst.scheduleId ? (scheduleById.get(inst.scheduleId)?.type ?? 'lecture') : 'lecture';
    result.push(fromInstance(inst, type));
  }
  return sortOccurrences(result);
}

function fromInstance(i: InstanceLike, type: ClassSchedule['type']): ClassOccurrence {
  return {
    id: i.id,
    scheduleId: i.scheduleId,
    subjectId: i.subjectId,
    date: i.date,
    startTime: i.startTime,
    endTime: i.endTime,
    room: i.room,
    type,
    status: i.status,
    rescheduledToId: i.rescheduledToId,
    rescheduledFromId: i.rescheduledFromId,
    isExtra: i.isExtra,
    materialized: true,
  };
}

export function sortOccurrences<T extends { date: string; startTime: string }>(list: T[]): T[] {
  return list.sort((a, b) => (a.date === b.date ? timeToMinutes(a.startTime) - timeToMinutes(b.startTime) : a.date < b.date ? -1 : 1));
}

/**
 * Count future occurrences per subject from `from` up to each subject's term end
 * (exclusive of past). Null when no term end is known at all; subjects whose own
 * term has no end are counted but meaningless — check `rulesForSubject` first.
 */
export function remainingClassesBySubject(
  schedules: ScheduleLike[],
  instances: InstanceLike[],
  from: ISODate,
  rules: CalendarRules,
): Map<string, number> | null {
  const ends = [rules.semesterEnd, ...Object.values(rules.bySubject ?? {}).map((r) => r.semesterEnd)].filter((d): d is ISODate => !!d);
  if (ends.length === 0) return null;
  const lastEnd = ends.sort().at(-1)!;
  const counts = new Map<string, number>();
  if (lastEnd < from) return counts;
  for (const occ of resolveOccurrences(schedules, instances, from, lastEnd, rules)) {
    if (occ.status === 'cancelled' || occ.status === 'rescheduled') continue;
    if (occ.status === 'present' || occ.status === 'absent') continue; // already counted as conducted
    const end = rulesForSubject(rules, occ.subjectId).semesterEnd;
    if (end && occ.date > end) continue; // an extra class after this subject's term ended
    counts.set(occ.subjectId, (counts.get(occ.subjectId) ?? 0) + 1);
  }
  return counts;
}

/** Number of upcoming occurrences of a subject in the next `days` days (for "what if"). */
export function nextOccurrences(
  schedules: ScheduleLike[],
  instances: InstanceLike[],
  subjectId: string,
  from: ISODate,
  count: number,
  rules: CalendarRules = {},
  horizonDays = 120,
): ClassOccurrence[] {
  const termEnd = rulesForSubject(rules, subjectId).semesterEnd;
  const end = termEnd && diffDays(from, termEnd) < horizonDays ? termEnd : addDays(from, horizonDays);
  return resolveOccurrences(schedules, instances, from, end, rules)
    .filter((o) => o.subjectId === subjectId && o.status !== 'cancelled' && o.status !== 'rescheduled')
    .slice(0, count);
}

export function overlaps(a: { startTime: string; endTime: string }, b: { startTime: string; endTime: string }): boolean {
  return timeToMinutes(a.startTime) < timeToMinutes(b.endTime) && timeToMinutes(b.startTime) < timeToMinutes(a.endTime);
}

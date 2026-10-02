/**
 * Sleep time and catch-up scheduling.
 *
 * Nothing is ever scheduled inside the student's sleep time. For subjects the
 * student marked compulsory, missed work (absent classes, overdue revisions,
 * study sessions that didn't happen) is moved into the next free slot.
 */
import { v5 as uuidv5 } from 'uuid';
import { addDays, minutesToTime, timeToMinutes, type ISODate } from './dates';
import type { CalendarEvent } from './entities';
import { freeSlots } from './overview';
import type { ClassOccurrence } from './recurrence';

export interface SleepWindow {
  start: string;
  end: string;
}

/** Waking hours for planning. Sleep usually crosses midnight (23:00–07:00 → plan 07:00–23:00). */
export function awakeHours(sleep: SleepWindow): { dayStart: string; dayEnd: string } {
  const s = timeToMinutes(sleep.start);
  const e = timeToMinutes(sleep.end);
  if (s > e) return { dayStart: sleep.end, dayEnd: sleep.start };
  // Sleep after midnight (e.g. 01:00–08:00): plan from waking up until the end of the day.
  return { dayStart: sleep.end, dayEnd: '23:59' };
}

/** Does start–end (same day, HH:MM) touch the sleep window? */
export function overlapsSleep(start: string, end: string, sleep: SleepWindow): boolean {
  const a = timeToMinutes(start);
  const b = timeToMinutes(end);
  const s = timeToMinutes(sleep.start);
  const e = timeToMinutes(sleep.end);
  const ranges = s > e ? [[s, 24 * 60], [0, e]] : [[s, e]];
  return ranges.some(([rs, re]) => a < re! && b > rs!);
}

export function sleepLabel(sleep: SleepWindow) {
  return `${sleep.start}–${sleep.end}`;
}

export interface Slot {
  date: ISODate;
  start: string;
  end: string;
}

/**
 * The earliest free slot of `minutes` from `from` (not before `notBefore`
 * minutes on that first day), outside classes, events and sleep, within `days`.
 * `taken` are slots already handed out in this run, so items don't stack.
 */
export function findSlot(opts: {
  from: ISODate;
  notBefore: number;
  minutes: number;
  classes: ClassOccurrence[];
  events: Pick<CalendarEvent, 'date' | 'startTime' | 'endTime' | 'title' | 'deletedAt'>[];
  sleep: SleepWindow;
  taken?: Slot[];
  days?: number;
}): Slot | null {
  const { dayStart, dayEnd } = awakeHours(opts.sleep);
  const extra = (opts.taken ?? []).map((t) => ({ date: t.date, startTime: t.start, endTime: t.end, title: 'planned', deletedAt: null }));
  for (let i = 0; i < (opts.days ?? 14); i++) {
    const date = addDays(opts.from, i);
    const { free } = freeSlots(date, opts.classes, [...opts.events, ...extra], {
      dayStart,
      dayEnd,
      minMinutes: opts.minutes,
      notBefore: i === 0 ? opts.notBefore : 0,
    });
    const f = free[0];
    if (f) {
      const start = timeToMinutes(f.start);
      return { date, start: f.start, end: minutesToTime(start + opts.minutes) };
    }
  }
  return null;
}

/** Revisions have a date, not a time: the first day (from `from`) with at least `minutes` free and fewer than `perDay` already moved there. */
export function findRevisionDay(opts: {
  from: ISODate;
  notBefore: number;
  classes: ClassOccurrence[];
  events: Pick<CalendarEvent, 'date' | 'startTime' | 'endTime' | 'title' | 'deletedAt'>[];
  sleep: SleepWindow;
  load: Map<ISODate, number>;
  perDay?: number;
  minutes?: number;
}): ISODate {
  const { dayStart, dayEnd } = awakeHours(opts.sleep);
  for (let i = 0; i < 14; i++) {
    const date = addDays(opts.from, i);
    if ((opts.load.get(date) ?? 0) >= (opts.perDay ?? 3)) continue;
    const { free } = freeSlots(date, opts.classes, opts.events, { dayStart, dayEnd, minMinutes: opts.minutes ?? 30, notBefore: i === 0 ? opts.notBefore : 0 });
    if (free.length) return date;
  }
  return addDays(opts.from, 1);
}

/** Same id on every device, so a missed class gets exactly one catch-up session even when several devices run this. */
export function catchUpIdFor(occurrenceId: string): string {
  return uuidv5(`catchup:${occurrenceId}`, '2b8f0c9e-4d3a-4b7e-9f61-7c5d2e1a8b40');
}

import { addDays, addMonths, diffDays, eachDay, parseISODate, weekdayOf, type ISODate } from './dates';
import type { Recurrence } from './entities';

/** Dates on which a reminder occurs within [from, to]. */
export function reminderDates(start: ISODate, rec: Recurrence, from: ISODate, to: ISODate): ISODate[] {
  const lastDay = rec.until && rec.until < to ? rec.until : to;
  const first = start > from ? start : from;
  if (lastDay < first) return [];
  if (rec.freq === 'none') return start >= from && start <= lastDay ? [start] : [];

  const out: ISODate[] = [];
  const weekdays = rec.weekdays.length ? rec.weekdays : [weekdayOf(start)];

  if (rec.freq === 'monthly' || (rec.freq === 'custom' && rec.unit === 'month')) {
    const day = parseISODate(start).getUTCDate();
    for (let i = 0, d = start; d <= lastDay && i < 1200; i++, d = addMonths(start, i * rec.interval)) {
      // addMonths clamps (31st → 30th); skip months that don't have this day.
      if (d >= first && parseISODate(d).getUTCDate() === day) out.push(d);
    }
    return out;
  }

  for (const d of eachDay(first, lastDay)) {
    const offset = diffDays(start, d);
    switch (rec.freq) {
      case 'daily':
        if (offset % rec.interval === 0) out.push(d);
        break;
      case 'weekdays': {
        const w = weekdayOf(d);
        if (w >= 1 && w <= 5) out.push(d);
        break;
      }
      case 'weekly':
        if (weekdays.includes(weekdayOf(d)) && Math.floor(offset / 7) % rec.interval === 0) out.push(d);
        break;
      case 'custom':
        if (rec.unit === 'day' ? offset % rec.interval === 0 : weekdays.includes(weekdayOf(d)) && Math.floor(offset / 7) % rec.interval === 0) out.push(d);
        break;
    }
  }
  return out;
}

export function describeRecurrence(rec: Recurrence, start: ISODate): string {
  const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const days = (rec.weekdays.length ? rec.weekdays : [weekdayOf(start)]).map((d) => names[d]).join(', ');
  const every = (n: number, unit: string) => (n === 1 ? `Every ${unit}` : `Every ${n} ${unit}s`);
  switch (rec.freq) {
    case 'none':
      return 'Once';
    case 'daily':
      return every(rec.interval, 'day');
    case 'weekdays':
      return 'Every weekday';
    case 'weekly':
      return rec.interval === 1 ? `Every ${days}` : `Every ${rec.interval} weeks on ${days}`;
    case 'monthly':
      return every(rec.interval, 'month');
    case 'custom':
      return rec.unit === 'week' ? `Every ${rec.interval} week(s) on ${days}` : every(rec.interval, rec.unit);
  }
}

/** Next occurrence on or after `from`, or null. */
export function nextReminderDate(start: ISODate, rec: Recurrence, from: ISODate): ISODate | null {
  return reminderDates(start, rec, from, addDays(from, 400))[0] ?? null;
}

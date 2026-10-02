/**
 * Timezone-safe date helpers.
 *
 * Calendar dates are stored as "YYYY-MM-DD" strings and times as "HH:MM".
 * All arithmetic on date strings is done in UTC so DST shifts can never move a
 * class to the wrong day.
 */

export type ISODate = string;
export type HHMM = string;

export const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
export type WeekdayName = (typeof WEEKDAYS)[number];
export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isISODate(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) return false;
  const d = parseISODate(value);
  return formatUTC(d) === value;
}

export function parseISODate(date: ISODate): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function formatUTC(d: Date): ISODate {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** The local calendar date of a JS Date (what the user sees on their wall clock). */
export function toLocalISODate(d: Date = new Date()): ISODate {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayISO(): ISODate {
  return toLocalISODate(new Date());
}

export function addDays(date: ISODate, days: number): ISODate {
  const d = parseISODate(date);
  d.setUTCDate(d.getUTCDate() + days);
  return formatUTC(d);
}

export function addMonths(date: ISODate, months: number): ISODate {
  const d = parseISODate(date);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return formatUTC(d);
}

/** Whole days from `a` to `b` (positive when b is later). */
export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((parseISODate(b).getTime() - parseISODate(a).getTime()) / 86_400_000);
}

/** 0 = Sunday … 6 = Saturday */
export function weekdayOf(date: ISODate): number {
  return parseISODate(date).getUTCDay();
}

export function startOfWeek(date: ISODate, weekStartsOn: 0 | 1 = 1): ISODate {
  const diff = (weekdayOf(date) - weekStartsOn + 7) % 7;
  return addDays(date, -diff);
}

export function startOfMonth(date: ISODate): ISODate {
  return `${date.slice(0, 7)}-01`;
}

export function endOfMonth(date: ISODate): ISODate {
  return addDays(addMonths(startOfMonth(date), 1), -1);
}

/** Inclusive list of dates between `from` and `to`. */
export function eachDay(from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function timeToMinutes(time: HHMM): number {
  const [h, m] = time.split(':').map(Number) as [number, number];
  return h * 60 + m;
}

export function minutesToTime(minutes: number): HHMM {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

/** Normalise "9:5", "9.30", "09:30 PM" etc. into "HH:MM" (24h). Returns null if unparseable. */
export function normalizeTime(raw: string): HHMM | null {
  const s = raw.trim().toLowerCase().replace(/\s+/g, '');
  const match = /^(\d{1,2})(?:[:.](\d{1,2}))?(am|pm)?$/.exec(s);
  if (!match) return null;
  let h = Number(match[1]);
  const m = match[2] ? Number(match[2]) : 0;
  const meridiem = match[3];
  if (meridiem === 'pm' && h < 12) h += 12;
  if (meridiem === 'am' && h === 12) h = 0;
  if (h > 23 || m > 59) return null;
  return `${pad(h)}:${pad(m)}`;
}

export function parseWeekday(raw: string): number | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  const idx = WEEKDAYS.findIndex((d) => d === s || d.startsWith(s.slice(0, 3)));
  return idx === -1 ? null : idx;
}

/** Minutes since local midnight for a JS Date. */
export function nowMinutes(d: Date = new Date()): number {
  return d.getHours() * 60 + d.getMinutes();
}

export function formatTime12(time: HHMM): string {
  const mins = timeToMinutes(time);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad(m)} ${suffix}`;
}

/**
 * Understands short natural answers during AI Pilot setup ("75%", "evening and night",
 * "3 hours", "15 Dec"). Deterministic on purpose: these answers become settings, so we
 * never guess — anything unclear is asked again.
 */
import { addDays, todayISO, type ISODate } from '@student-os/core';

export type StudyTime = 'morning' | 'afternoon' | 'evening' | 'night';
export const STUDY_TIMES: StudyTime[] = ['morning', 'afternoon', 'evening', 'night'];

const clean = (t: string) => t.trim().toLowerCase();

export function isSkip(text: string): boolean {
  return /^(skip|later|not now|none|no thanks|nah|pass|-)\b/.test(clean(text));
}

export function parseYesNo(text: string): boolean | null {
  const t = clean(text);
  if (/^(y|yes|yeah|yep|sure|ok|okay|of course|please|definitely|absolutely)\b/.test(t)) return true;
  if (/^(n|no|nope|not now|don'?t|never|skip)\b/.test(t)) return false;
  return null;
}

/** "75", "75%", "75 percent" → 75. Anything outside 1–100 is rejected. */
export function parsePercent(text: string): number | null {
  const m = /(\d{1,3}(?:\.\d+)?)\s*(%|percent|per cent)?/.exec(clean(text));
  if (!m) return null;
  const n = Math.round(Number(m[1]));
  return n >= 1 && n <= 100 ? n : null;
}

/** "15", "15 min", "half an hour", "1 hour" → minutes (1–240). */
export function parseLeadMinutes(text: string): number | null {
  const t = clean(text);
  if (/half an? hour/.test(t)) return 30;
  if (/^an? hour/.test(t)) return 60;
  const m = /(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes)?\b/.exec(t);
  if (!m) return null;
  const n = Number(m[1]);
  const minutes = m[2]?.startsWith('h') ? n * 60 : n;
  return minutes >= 1 && minutes <= 240 ? Math.round(minutes) : null;
}

/** "3 hours", "3h", "2.5", "90 min" → minutes (15 min – 16 h). A bare number up to 16 means hours. */
export function parseStudyTarget(text: string): number | null {
  const t = clean(text);
  const m = /(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes)?\b/.exec(t);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2];
  const minutes = unit ? (unit.startsWith('h') ? n * 60 : n) : n <= 16 ? n * 60 : n;
  return minutes >= 15 && minutes <= 16 * 60 ? Math.round(minutes / 15) * 15 : null;
}

/** "evening and night", "mornings", "any time" → study times, in day order. */
export function parseStudyTimes(text: string): StudyTime[] {
  const t = clean(text);
  if (/\b(any ?time|all|whenever|any)\b/.test(t)) return [...STUDY_TIMES];
  return STUDY_TIMES.filter((s) => t.includes(s) || (s === 'night' && /late|midnight/.test(t)));
}

/** "1, 3, 7, 30" → sorted unique day intervals. Needs at least one valid number. */
export function parseIntervals(text: string): number[] | null {
  const nums = clean(text)
    .split(/[^\d]+/)
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 3650);
  const unique = [...new Set(nums)].sort((a, b) => a - b);
  return unique.length ? unique.slice(0, 20) : null;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function iso(y: number, m: number, d: number): ISODate | null {
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * A future date: "2026-12-15", "15/12/2026" (day first), "15 Dec", "December 15 2026".
 * Without a year, the next such date from `today` is used.
 */
export function parseFutureDate(text: string, today: ISODate = todayISO()): ISODate | null {
  const t = clean(text).replace(/(\d)(st|nd|rd|th)\b/g, '$1');
  const thisYear = Number(today.slice(0, 4));
  const withYear = (m: number, d: number, y?: number): ISODate | null => {
    if (y !== undefined) return iso(y < 100 ? 2000 + y : y, m, d);
    const candidate = iso(thisYear, m, d);
    if (!candidate) return null;
    return candidate > today ? candidate : iso(thisYear + 1, m, d);
  };

  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/.exec(t);
  if (m) return withYear(Number(m[2]), Number(m[1]), m[3] ? Number(m[3]) : undefined);

  const monthIndex = (word: string) => MONTHS.findIndex((mo) => word.startsWith(mo));
  m = /^(\d{1,2})\s+([a-z]+),?\s*(\d{4})?$/.exec(t);
  if (m && monthIndex(m[2]!) >= 0) return withYear(monthIndex(m[2]!) + 1, Number(m[1]), m[3] ? Number(m[3]) : undefined);
  m = /^([a-z]+)\s+(\d{1,2}),?\s*(\d{4})?$/.exec(t);
  if (m && monthIndex(m[1]!) >= 0) return withYear(monthIndex(m[1]!) + 1, Number(m[2]), m[3] ? Number(m[3]) : undefined);
  return null;
}

/** Academic year label for today, e.g. "2026–27" (years starting in July). */
export function currentAcademicYear(today: ISODate = todayISO()): string {
  const y = Number(today.slice(0, 4));
  const start = Number(today.slice(5, 7)) >= 7 ? y : y - 1;
  return `${start}–${String((start + 1) % 100).padStart(2, '0')}`;
}

/** Default semester end used when the student skips the question (about four months out). */
export function defaultSemesterEnd(today: ISODate = todayISO()): ISODate {
  return addDays(today, 120);
}

import { addDays, type ISODate } from './dates';

/**
 * Consecutive-day streak ending today (or yesterday, so a streak isn't shown as
 * broken before the student has had a chance to act today).
 */
export function computeStreak(activeDates: Iterable<ISODate>, today: ISODate): number {
  const set = new Set(activeDates);
  let day = set.has(today) ? today : addDays(today, -1);
  let streak = 0;
  while (set.has(day)) {
    streak++;
    day = addDays(day, -1);
  }
  return streak;
}

export function longestStreak(activeDates: Iterable<ISODate>): number {
  const sorted = [...new Set(activeDates)].sort();
  let best = 0;
  let run = 0;
  let prev: ISODate | null = null;
  for (const d of sorted) {
    run = prev && addDays(prev, 1) === d ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return best;
}

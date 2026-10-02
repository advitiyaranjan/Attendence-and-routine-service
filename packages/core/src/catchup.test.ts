import { describe, expect, it } from 'vitest';
import { awakeHours, findRevisionDay, findSlot, overlapsSleep } from './catchup';
import type { ClassOccurrence } from './recurrence';

const sleep = { start: '23:00', end: '07:00' };
const cls = (date: string, startTime: string, endTime: string) => ({ id: `${date}${startTime}`, subjectId: 's', date, startTime, endTime, status: null }) as unknown as ClassOccurrence;

describe('sleep time', () => {
  it('turns sleep into waking hours', () => {
    expect(awakeHours(sleep)).toEqual({ dayStart: '07:00', dayEnd: '23:00' });
    expect(awakeHours({ start: '01:00', end: '08:00' })).toEqual({ dayStart: '08:00', dayEnd: '23:59' });
  });

  it('detects overlap across midnight', () => {
    expect(overlapsSleep('22:00', '23:30', sleep)).toBe(true);
    expect(overlapsSleep('06:00', '07:30', sleep)).toBe(true);
    expect(overlapsSleep('07:00', '22:59', sleep)).toBe(false);
    expect(overlapsSleep('02:00', '03:00', { start: '01:00', end: '08:00' })).toBe(true);
  });
});

describe('catch-up slots', () => {
  it('finds the next free slot after now, outside classes and sleep', () => {
    const classes = [cls('2026-10-02', '18:00', '22:00')];
    // 17:30 now, 2 hours needed: today has no 2h gap before sleep (22:00–23:00 is 1h) → tomorrow 07:00.
    const slot = findSlot({ from: '2026-10-02', notBefore: 17 * 60 + 30, minutes: 120, classes, events: [], sleep });
    expect(slot).toEqual({ date: '2026-10-03', start: '07:00', end: '09:00' });
  });

  it('does not stack items on a slot already given out', () => {
    const taken = [{ date: '2026-10-03', start: '07:00', end: '09:00' }];
    const slot = findSlot({ from: '2026-10-03', notBefore: 0, minutes: 60, classes: [], events: [], sleep, taken });
    expect(slot).toEqual({ date: '2026-10-03', start: '09:00', end: '10:00' });
  });

  it('spreads moved revisions over days', () => {
    const load = new Map([['2026-10-02', 3]]);
    expect(findRevisionDay({ from: '2026-10-02', notBefore: 600, classes: [], events: [], sleep, load })).toBe('2026-10-03');
  });
});

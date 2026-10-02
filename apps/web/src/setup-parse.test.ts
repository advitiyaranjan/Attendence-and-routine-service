import { describe, expect, it } from 'vitest';
import {
  currentAcademicYear,
  isSkip,
  parseFutureDate,
  parseIntervals,
  parseLeadMinutes,
  parsePercent,
  parseStudyTarget,
  parseStudyTimes,
  parseYesNo,
} from './lib/setup-parse';

const TODAY = '2026-10-02';

describe('AI Pilot answer parsing', () => {
  it('reads attendance percentages', () => {
    expect(parsePercent('75%')).toBe(75);
    expect(parsePercent('I need 80 percent')).toBe(80);
    expect(parsePercent('0')).toBeNull();
    expect(parsePercent('150')).toBeNull();
    expect(parsePercent('a lot')).toBeNull();
  });

  it('reads yes / no / skip', () => {
    expect(parseYesNo('Yes.')).toBe(true);
    expect(parseYesNo('sure, go ahead')).toBe(true);
    expect(parseYesNo('nope')).toBe(false);
    expect(parseYesNo('maybe')).toBeNull();
    expect(isSkip('skip')).toBe(true);
    expect(isSkip('Not now')).toBe(true);
    expect(isSkip('75')).toBe(false);
  });

  it('reads reminder lead times', () => {
    expect(parseLeadMinutes('15 minutes')).toBe(15);
    expect(parseLeadMinutes('10')).toBe(10);
    expect(parseLeadMinutes('half an hour')).toBe(30);
    expect(parseLeadMinutes('1 hour')).toBe(60);
    expect(parseLeadMinutes('soon')).toBeNull();
  });

  it('reads daily study targets', () => {
    expect(parseStudyTarget('3 hours')).toBe(180);
    expect(parseStudyTarget('4h')).toBe(240);
    expect(parseStudyTarget('2.5')).toBe(150);
    expect(parseStudyTarget('90 min')).toBe(90);
    expect(parseStudyTarget('none')).toBeNull();
  });

  it('reads preferred study times', () => {
    expect(parseStudyTimes('Evening and night.')).toEqual(['evening', 'night']);
    expect(parseStudyTimes('mornings, late at night')).toEqual(['morning', 'night']);
    expect(parseStudyTimes('any time')).toEqual(['morning', 'afternoon', 'evening', 'night']);
    expect(parseStudyTimes('whenever I feel like it')).toHaveLength(4);
    expect(parseStudyTimes('dunno')).toEqual([]);
  });

  it('reads revision intervals', () => {
    expect(parseIntervals('1, 3, 7, 30')).toEqual([1, 3, 7, 30]);
    expect(parseIntervals('7 3 1 3')).toEqual([1, 3, 7]);
    expect(parseIntervals('none')).toBeNull();
  });

  it('reads future dates, day first', () => {
    expect(parseFutureDate('2026-12-15', TODAY)).toBe('2026-12-15');
    expect(parseFutureDate('15/12/2026', TODAY)).toBe('2026-12-15');
    expect(parseFutureDate('15 Dec', TODAY)).toBe('2026-12-15');
    expect(parseFutureDate('December 15th', TODAY)).toBe('2026-12-15');
    // Already passed this year → next year.
    expect(parseFutureDate('15 Jan', TODAY)).toBe('2027-01-15');
    expect(parseFutureDate('31/02/2027', TODAY)).toBeNull();
    expect(parseFutureDate('end of term', TODAY)).toBeNull();
  });

  it('labels the academic year', () => {
    expect(currentAcademicYear('2026-10-02')).toBe('2026–27');
    expect(currentAcademicYear('2027-03-01')).toBe('2026–27');
  });
});

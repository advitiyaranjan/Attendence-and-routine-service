/**
 * Attendance calculations.
 *
 *   Attendance % = attended / conducted × 100
 *
 * - Cancelled classes are not conducted.
 * - Rescheduled originals are not conducted (the replacement instance counts instead).
 * - "Unsure" or unmarked past classes are not counted until the student decides,
 *   but are surfaced so they can be resolved.
 */
import type { AttendanceStatus } from './entities';
import type { ISODate } from './dates';

const EPS = 1e-9;

export interface AttendanceCounts {
  present: number;
  absent: number;
  conducted: number;
  cancelled: number;
  /** Past classes with no decision yet (null or "unsure"). */
  unmarked: number;
}

export interface Countable {
  date: ISODate;
  status: AttendanceStatus | null;
}

export function countAttendance(items: Countable[], today: ISODate): AttendanceCounts {
  const c: AttendanceCounts = { present: 0, absent: 0, conducted: 0, cancelled: 0, unmarked: 0 };
  for (const item of items) {
    switch (item.status) {
      case 'present':
        c.present++;
        c.conducted++;
        break;
      case 'absent':
        c.absent++;
        c.conducted++;
        break;
      case 'cancelled':
        c.cancelled++;
        break;
      case 'rescheduled':
        break;
      default:
        if (item.date <= today) c.unmarked++;
    }
  }
  return c;
}

/** Attendance percentage, or null when nothing has been conducted yet. */
export function attendancePercent(present: number, conducted: number): number | null {
  if (conducted <= 0) return null;
  return (present / conducted) * 100;
}

/**
 * Minimum number of consecutive classes to attend so that attendance reaches `target` %.
 * Returns Infinity when the target is mathematically unreachable (target 100% after an absence).
 */
export function classesNeededToReach(present: number, conducted: number, target: number): number {
  const t = target / 100;
  if (conducted === 0 || present / conducted + EPS >= t) return 0;
  if (t >= 1) return Infinity;
  // (p + n) / (c + n) >= t  =>  n >= (t·c − p) / (1 − t)
  return Math.max(0, Math.ceil((t * conducted - present) / (1 - t) - EPS));
}

/**
 * How many upcoming classes can be missed in a row while staying at or above `threshold` %,
 * assuming no other classes in between.
 */
export function classesCanMiss(present: number, conducted: number, threshold: number): number {
  const t = threshold / 100;
  if (t <= 0) return Infinity;
  // p / (c + m) >= t  =>  m <= p / t − c
  return Math.max(0, Math.floor(present / t - conducted + EPS));
}

export interface SemesterProjection {
  remaining: number;
  /** Best achievable % if every remaining class is attended. */
  maxAchievable: number | null;
  /** Classes that may be missed out of `remaining` and still end the semester ≥ threshold. -1 = impossible. */
  maxMissable: number;
  /** Classes that must be attended out of `remaining` to end ≥ threshold. -1 = impossible. */
  mustAttend: number;
}

/**
 * Projection that accounts for the classes actually left on the timetable this semester.
 */
export function projectSemester(
  present: number,
  conducted: number,
  remaining: number,
  threshold: number,
): SemesterProjection {
  const t = threshold / 100;
  const total = conducted + remaining;
  const maxAchievable = total > 0 ? ((present + remaining) / total) * 100 : null;
  // (p + R − m) / (c + R) >= t  =>  m <= p + R − t(c + R)
  const raw = Math.floor(present + remaining - t * total + EPS);
  const maxMissable = raw < 0 ? -1 : Math.min(raw, remaining);
  return {
    remaining,
    maxAchievable,
    maxMissable,
    mustAttend: maxMissable < 0 ? -1 : remaining - maxMissable,
  };
}

/** "What if I attend X and miss Y of the next classes?" */
export function whatIf(present: number, conducted: number, attend: number, miss: number): number | null {
  return attendancePercent(present + attend, conducted + attend + miss);
}

export type RiskLevel = 'safe' | 'on_track' | 'at_risk' | 'below_min' | 'no_data';

export interface Thresholds {
  min: number;
  target: number;
  safe: number;
}

export function riskLevel(percent: number | null, th: Thresholds): RiskLevel {
  if (percent === null) return 'no_data';
  if (percent + EPS >= th.safe) return 'safe';
  if (percent + EPS >= th.target) return 'on_track';
  if (percent + EPS >= th.min) return 'at_risk';
  return 'below_min';
}

export const RISK_LABEL: Record<RiskLevel, string> = {
  safe: 'Safe',
  on_track: 'On track',
  at_risk: 'At risk',
  below_min: 'Below minimum',
  no_data: 'No classes yet',
};

export interface SubjectAttendanceSummary extends AttendanceCounts {
  percent: number | null;
  risk: RiskLevel;
  neededForMin: number;
  neededForTarget: number;
  canMissForMin: number;
  projection: SemesterProjection | null;
  /** Human-readable explanation of the numbers. */
  advice: string;
}

export function summarizeSubject(
  counts: AttendanceCounts,
  th: Thresholds,
  remainingThisSemester: number | null,
): SubjectAttendanceSummary {
  const percent = attendancePercent(counts.present, counts.conducted);
  const risk = riskLevel(percent, th);
  const neededForMin = classesNeededToReach(counts.present, counts.conducted, th.min);
  const neededForTarget = classesNeededToReach(counts.present, counts.conducted, th.target);
  const canMissForMin = classesCanMiss(counts.present, counts.conducted, th.min);
  const projection =
    remainingThisSemester === null ? null : projectSemester(counts.present, counts.conducted, remainingThisSemester, th.min);

  let advice: string;
  if (percent === null) {
    advice = 'No classes conducted yet.';
  } else if (projection && projection.maxMissable < 0) {
    advice = `Even attending all ${projection.remaining} remaining classes reaches only ${fmtPct(projection.maxAchievable)}, below ${th.min}%.`;
  } else if (risk === 'below_min') {
    advice = `Attend the next ${neededForMin} class${neededForMin === 1 ? '' : 'es'} in a row to reach ${th.min}%.`;
    if (projection && neededForMin > projection.remaining) {
      advice += ` Only ${projection.remaining} remain this semester.`;
    }
  } else if (projection) {
    advice =
      projection.maxMissable === 0
        ? `You can't miss any of the ${projection.remaining} remaining classes and stay above ${th.min}%.`
        : `You can miss up to ${projection.maxMissable} of the ${projection.remaining} remaining classes and stay above ${th.min}%.`;
  } else {
    advice =
      canMissForMin === 0
        ? `Missing the next class drops you below ${th.min}%.`
        : `You can miss about ${canMissForMin} upcoming class${canMissForMin === 1 ? '' : 'es'} and stay above ${th.min}%.`;
  }
  if (percent !== null && risk === 'at_risk' && neededForTarget > 0 && Number.isFinite(neededForTarget)) {
    advice += ` Attend ${neededForTarget} in a row to reach your ${th.target}% target.`;
  }

  return { ...counts, percent, risk, neededForMin, neededForTarget, canMissForMin, projection, advice };
}

export function fmtPct(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const rounded = Number(value.toFixed(digits));
  return `${rounded}%`;
}

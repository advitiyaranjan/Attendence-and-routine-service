/**
 * Adaptive spaced-repetition scheduler.
 *
 * The student's revision ladder (default Day 1, 3, 7, 30, 90, 180 after learning)
 * defines the base gaps between revisions: 1, 2, 4, 23, 60, 90 days.
 * Each topic keeps:
 *   stage – how many ladder revisions have been passed
 *   ease  – a personal multiplier on the gaps, learned from recall ratings
 *
 * Ratings:
 *   forgot      → revise tomorrow, restart the ladder, ease ×0.85
 *   partial     → revise in 2 days, repeat the same stage, ease ×0.95
 *   remembered  → advance to the next stage at the normal (ease-scaled) gap
 *   easy        → advance, ease ×1.25, so this and future gaps grow
 */
import { addDays, type ISODate } from './dates';
import type { RecallRating } from './entities';

export const DEFAULT_REVISION_LADDER = [1, 3, 7, 30, 90, 180];
export const MIN_EASE = 0.5;
export const MAX_EASE = 3;

export interface PlannedRevision {
  stage: number; // 1-based
  dueDate: ISODate;
}

export interface RevisionState {
  stage: number;
  ease: number;
}

function gaps(ladder: number[]): number[] {
  const sorted = [...ladder].sort((a, b) => a - b);
  return sorted.map((d, i) => Math.max(1, d - (i === 0 ? 0 : sorted[i - 1]!)));
}

function scaled(gap: number, ease: number): number {
  return Math.max(1, Math.round(gap * ease));
}

/** Project the remaining ladder from `anchor`, starting at 0-based stage index `fromIndex`. */
export function projectRevisions(
  anchor: ISODate,
  fromIndex: number,
  ease: number,
  ladder: number[] = DEFAULT_REVISION_LADDER,
  firstGapOverride?: number,
): PlannedRevision[] {
  const g = gaps(ladder);
  const out: PlannedRevision[] = [];
  let date = anchor;
  for (let i = fromIndex; i < g.length; i++) {
    const gap = i === fromIndex && firstGapOverride !== undefined ? firstGapOverride : scaled(g[i]!, ease);
    date = addDays(date, gap);
    out.push({ stage: i + 1, dueDate: date });
  }
  return out;
}

/** Full initial schedule for a newly learned topic. */
export function initialRevisions(learnedOn: ISODate, ladder: number[] = DEFAULT_REVISION_LADDER): PlannedRevision[] {
  return projectRevisions(learnedOn, 0, 1, ladder);
}

export interface RatingOutcome {
  state: RevisionState;
  upcoming: PlannedRevision[];
  mastered: boolean;
  explanation: string;
}

const clampEase = (e: number) => Math.min(MAX_EASE, Math.max(MIN_EASE, Number(e.toFixed(3))));

/**
 * Apply a recall rating for the revision at `completedStage` (1-based), done on `today`.
 * Returns the new topic state and the re-projected upcoming revisions.
 */
export function applyRating(
  current: RevisionState,
  completedStage: number,
  rating: RecallRating,
  today: ISODate,
  ladder: number[] = DEFAULT_REVISION_LADDER,
): RatingOutcome {
  const total = ladder.length;
  let ease = current.ease;
  let upcoming: PlannedRevision[];
  let stage: number;
  let explanation: string;

  switch (rating) {
    case 'forgot':
      ease = clampEase(ease * 0.85);
      stage = 0;
      upcoming = projectRevisions(today, 0, ease, ladder, 1);
      explanation = 'Forgot: revising again tomorrow and restarting the schedule.';
      break;
    case 'partial': {
      ease = clampEase(ease * 0.95);
      stage = Math.max(0, completedStage - 1);
      upcoming = projectRevisions(today, stage, ease, ladder, 2);
      explanation = 'Partially remembered: repeating this stage in 2 days.';
      break;
    }
    case 'remembered':
      stage = completedStage;
      upcoming = projectRevisions(today, stage, ease, ladder);
      explanation = upcoming[0]
        ? `Remembered: next revision in ${daysBetweenLabel(today, upcoming[0].dueDate)}.`
        : 'Remembered: schedule complete.';
      break;
    case 'easy':
      ease = clampEase(ease * 1.25);
      stage = completedStage;
      upcoming = projectRevisions(today, stage, ease, ladder);
      explanation = upcoming[0]
        ? `Easy: interval extended — next revision in ${daysBetweenLabel(today, upcoming[0].dueDate)}.`
        : 'Easy: topic mastered.';
      break;
  }

  const mastered = stage >= total;
  if (mastered) upcoming = [];
  return { state: { stage, ease }, upcoming, mastered, explanation };
}

function daysBetweenLabel(from: ISODate, to: ISODate): string {
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
  return days === 1 ? '1 day' : `${days} days`;
}

export const RATING_LABEL: Record<RecallRating, { emoji: string; label: string }> = {
  forgot: { emoji: '😟', label: 'Forgot' },
  partial: { emoji: '😐', label: 'Partially' },
  remembered: { emoji: '🙂', label: 'Remembered' },
  easy: { emoji: '🔥', label: 'Easily' },
};

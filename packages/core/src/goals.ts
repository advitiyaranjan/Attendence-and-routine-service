/**
 * Long-term goals: categories, milestone templates, progress and schedule health.
 *
 * Progress (auto mode) is derived, never stored:
 * - A milestone marked done is 100%. Otherwise, if it has tasks, it is the share of
 *   its tasks that are done; with no tasks it is its manual progress (or 0).
 * - A goal is the average of its units, each weighted equally: every milestone is one
 *   unit, and tasks linked to the goal but to no milestone form one more unit together.
 *   A task counts once, inside its milestone or in that extra unit, never both.
 * - A completed goal is 100%. In manual mode the goal shows the student's own figure.
 * Milestones can be completed in any order; the roadmap's "current" stage is the first
 * open one by order (an in-progress one wins), so finishing a later stage early is fine.
 */
import { diffDays, type ISODate } from './dates';
import type { Goal, Milestone, Task } from './entities';

export interface GoalCategory {
  key: string;
  label: string;
  icon: string;
  color: string;
}

export const GOAL_CATEGORIES: GoalCategory[] = [
  { key: 'career', label: 'Career & placements', icon: '💼', color: '#4f46e5' },
  { key: 'exam', label: 'Competitive exams', icon: '📝', color: '#c2410c' },
  { key: 'academic', label: 'Academics', icon: '🎓', color: '#0f766e' },
  { key: 'skill', label: 'Technical skills', icon: '🧠', color: '#2563eb' },
  { key: 'project', label: 'Projects & research', icon: '🔬', color: '#7c3aed' },
  { key: 'personal', label: 'Personal growth', icon: '🌱', color: '#15803d' },
  { key: 'health', label: 'Health & fitness', icon: '💪', color: '#be123c' },
  { key: 'finance', label: 'Finance', icon: '💰', color: '#a16207' },
];

/** A built-in category, or the student's own label shown as-is. */
export function goalCategory(key: string): GoalCategory {
  return GOAL_CATEGORIES.find((c) => c.key === key) ?? { key, label: key, icon: '🏷️', color: '#64748b' };
}

/** Optional starting milestones per category. Always editable; never applied without the student choosing them. */
export const MILESTONE_TEMPLATES: Record<string, string[]> = {
  career: [
    'Strengthen DSA fundamentals',
    'Revise core CS subjects',
    'Build or improve 2 projects',
    'Prepare resume and portfolio',
    'Apply for internships',
    'Practise mock interviews',
    'Complete interviews and evaluate offers',
  ],
  exam: ['Understand the syllabus and exam pattern', 'Collect books and resources', 'Finish first pass of the syllabus', 'Revise every subject', 'Solve previous years’ papers', 'Take full-length mock tests', 'Final revision'],
  academic: ['Set the target grade per subject', 'Keep up with weekly coursework', 'Clear doubts with faculty', 'Finish mid-semester preparation', 'Submit all assignments', 'End-semester revision'],
  skill: ['Pick a learning path', 'Learn the fundamentals', 'Practise with small exercises', 'Build a project with it', 'Share the work publicly'],
  project: ['Define the problem and scope', 'Review existing work', 'Build a first prototype', 'Run experiments and collect results', 'Write up the report or paper', 'Present or publish'],
  personal: ['Define what success looks like', 'Build a daily habit', 'Review progress each month'],
  health: ['Set a baseline', 'Build a weekly routine', 'Reach the first checkpoint', 'Hit the target'],
  finance: ['Track spending for a month', 'Set a budget', 'Build an emergency fund', 'Reach the savings target'],
};

export const byOrder = <T extends { order: number; createdAt: string }>(rows: T[]): T[] =>
  rows.slice().sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt));

export interface MilestoneProgress {
  percent: number;
  /** Where the number comes from. */
  source: 'done' | 'tasks' | 'manual' | 'none';
  tasksDone: number;
  tasksTotal: number;
}

export function milestoneProgress(m: Milestone, tasks: readonly Task[]): MilestoneProgress {
  const own = tasks.filter((t) => t.milestoneId === m.id);
  const tasksDone = own.filter((t) => t.status === 'done').length;
  if (m.status === 'done') return { percent: 100, source: 'done', tasksDone, tasksTotal: own.length };
  if (own.length) return { percent: (tasksDone / own.length) * 100, source: 'tasks', tasksDone, tasksTotal: own.length };
  if (m.manualProgress !== null) return { percent: m.manualProgress, source: 'manual', tasksDone: 0, tasksTotal: 0 };
  return { percent: 0, source: 'none', tasksDone: 0, tasksTotal: 0 };
}

/** Every task that belongs to a goal, directly or through one of its milestones. */
export function goalTasks(goal: Goal, milestones: readonly Milestone[], tasks: readonly Task[]): Task[] {
  const ids = new Set(milestones.filter((m) => m.goalId === goal.id).map((m) => m.id));
  return tasks.filter((t) => t.goalId === goal.id || (t.milestoneId !== null && ids.has(t.milestoneId)));
}

export interface GoalProgress {
  percent: number;
  mode: 'auto' | 'manual';
  milestonesDone: number;
  milestonesTotal: number;
  tasksDone: number;
  tasksTotal: number;
}

export function goalProgress(goal: Goal, milestones: readonly Milestone[], tasks: readonly Task[]): GoalProgress {
  const ms = milestones.filter((m) => m.goalId === goal.id);
  const ids = new Set(ms.map((m) => m.id));
  const all = goalTasks(goal, ms, tasks);
  const loose = all.filter((t) => !(t.milestoneId && ids.has(t.milestoneId)));
  const counts = {
    milestonesDone: ms.filter((m) => m.status === 'done').length,
    milestonesTotal: ms.length,
    tasksDone: all.filter((t) => t.status === 'done').length,
    tasksTotal: all.length,
  };
  if (goal.status === 'completed') return { percent: 100, mode: goal.progressMode, ...counts };
  if (goal.progressMode === 'manual') return { percent: goal.manualProgress, mode: 'manual', ...counts };
  const units = ms.map((m) => milestoneProgress(m, all).percent);
  if (loose.length) units.push((loose.filter((t) => t.status === 'done').length / loose.length) * 100);
  const percent = units.length ? units.reduce((a, b) => a + b, 0) / units.length : 0;
  return { percent, mode: 'auto', ...counts };
}

/** The stage the student is on: the first open milestone by order, preferring one marked in progress. */
export function currentMilestone(milestones: readonly Milestone[]): Milestone | null {
  const open = byOrder(milestones.filter((m) => m.status !== 'done'));
  return open.find((m) => m.status === 'in_progress') ?? open[0] ?? null;
}

export type MilestoneState = 'done' | 'active' | 'upcoming' | 'overdue' | 'blocked';

export function milestoneState(m: Milestone, today: ISODate, currentId: string | null): MilestoneState {
  if (m.status === 'done') return 'done';
  if (m.status === 'blocked') return 'blocked';
  if (m.targetDate && m.targetDate < today) return 'overdue';
  if (m.id === currentId || m.status === 'in_progress') return 'active';
  return 'upcoming';
}

export type GoalHealthLevel = 'completed' | 'paused' | 'on_track' | 'attention' | 'behind' | 'overdue' | 'no_deadline';

export interface GoalHealth {
  level: GoalHealthLevel;
  label: string;
  /** Plain-language reasons behind the level, so the rule is never a black box. */
  reasons: string[];
  /** Share of the start→target window already used (0–100), when there is a target date. */
  timeUsed: number | null;
  daysLeft: number | null;
}

export const GOAL_HEALTH_LABEL: Record<GoalHealthLevel, string> = {
  completed: 'Completed',
  paused: 'Paused',
  on_track: 'On track',
  attention: 'Needs attention',
  behind: 'Behind schedule',
  overdue: 'Past target date',
  no_deadline: 'No target date',
};

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/**
 * Transparent schedule check. Compares progress with the share of time used, and looks
 * at overdue milestones and milestones dated after the goal itself. Progress alone never
 * makes a goal "on track".
 */
export function goalHealth(goal: Goal, progress: GoalProgress, milestones: readonly Milestone[], today: ISODate): GoalHealth {
  const make = (level: GoalHealthLevel, reasons: string[], timeUsed: number | null = null, daysLeft: number | null = null): GoalHealth => ({
    level,
    label: GOAL_HEALTH_LABEL[level],
    reasons,
    timeUsed,
    daysLeft,
  });
  if (goal.status === 'completed') return make('completed', [goal.completedAt ? `Completed on ${goal.completedAt.slice(0, 10)}` : 'Completed']);
  if (goal.status === 'paused') return make('paused', ['Paused. Its deadlines are not tracked until you resume it.']);

  const ms = milestones.filter((m) => m.goalId === goal.id);
  const open = ms.filter((m) => m.status !== 'done');
  const overdueMs = open.filter((m) => m.targetDate && m.targetDate < today);
  const blocked = open.filter((m) => m.status === 'blocked');
  const reasons: string[] = [];
  if (overdueMs.length) reasons.push(`${plural(overdueMs.length, 'milestone')} past ${overdueMs.length === 1 ? 'its' : 'their'} date`);
  if (blocked.length) reasons.push(`${plural(blocked.length, 'milestone')} blocked`);

  if (!goal.targetDate) {
    return make(overdueMs.length || blocked.length ? 'attention' : 'no_deadline', reasons.length ? reasons : ['Add a target date to track the pace.']);
  }
  const daysLeft = diffDays(today, goal.targetDate);
  if (daysLeft < 0) {
    return make('overdue', [`Target date passed ${plural(-daysLeft, 'day')} ago. Reschedule it to keep going.`, ...reasons], 100, daysLeft);
  }
  const span = Math.max(1, diffDays(goal.startDate, goal.targetDate));
  const timeUsed = Math.max(0, Math.min(100, (diffDays(goal.startDate, today) / span) * 100));
  const gap = timeUsed - progress.percent;
  reasons.unshift(`${Math.round(progress.percent)}% done with ${Math.round(timeUsed)}% of the time used`);
  const late = open.filter((m) => m.targetDate && m.targetDate > goal.targetDate!);
  if (late.length) reasons.push(`${plural(late.length, 'milestone')} dated after the goal's target`);
  if (open.length > 0 && daysLeft === 0) reasons.push('Target date is today');

  if (gap > 25 || overdueMs.length >= 2 || (daysLeft <= 7 && progress.percent < 50 && open.length > 1)) return make('behind', reasons, timeUsed, daysLeft);
  if (gap > 10 || overdueMs.length === 1 || blocked.length || late.length) return make('attention', reasons, timeUsed, daysLeft);
  return make('on_track', reasons, timeUsed, daysLeft);
}

/** Rank for "which goal needs me most": worse health first, then nearer target date, then priority. */
export function goalUrgency(h: GoalHealth, goal: Goal): number {
  const level = { overdue: 0, behind: 1, attention: 2, on_track: 3, no_deadline: 4, paused: 5, completed: 6 }[h.level];
  const prio = { urgent: 0, high: 1, medium: 2, low: 3 }[goal.priority];
  return level * 1_000_000 + Math.min(99_999, Math.max(0, h.daysLeft ?? 99_999)) * 10 + prio;
}

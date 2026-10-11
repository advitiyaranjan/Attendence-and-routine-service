/**
 * Goals, milestones and their tasks: write helpers and live data. Progress is never
 * stored; it is derived from these records by goalProgress() in @student-os/core.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import {
  activeMilestones,
  addDays,
  byOrder,
  currentMilestone,
  goalCategory,
  goalHealth,
  goalProgress,
  goalTasks,
  goalUrgency,
  todayISO,
  type Goal,
  type GoalHealth,
  type GoalProgress,
  type ISODate,
  type Milestone,
  type MilestoneStatus,
  type Task,
} from '@student-os/core';
import { db } from './db';
import { create, createMany, remove, removeMany, update, type NewRecord } from './repo';

const live = <T extends { deletedAt: string | null }>(rows: T[]) => rows.filter((r) => !r.deletedAt);

export interface GoalData {
  goals: Goal[];
  milestones: Milestone[];
  /** Every live task linked to a goal or milestone. */
  tasks: Task[];
}

/** All goals with their milestones and linked tasks, kept live. Undefined while loading. */
export function useGoalData(): GoalData | undefined {
  return useLiveQuery(async () => {
    const [goals, milestones, tasks] = await Promise.all([db.entity('goal').toArray(), db.entity('milestone').toArray(), db.entity('task').toArray()]);
    const g = live(goals);
    const ids = new Set(g.map((x) => x.id));
    const ms = live(milestones).filter((m) => ids.has(m.goalId));
    return { goals: byOrder(g), milestones: byOrder(ms), tasks: live(tasks).filter((t) => t.goalId || t.milestoneId) };
  }, []);
}

export interface GoalSummary {
  goal: Goal;
  milestones: Milestone[];
  tasks: Task[];
  progress: GoalProgress;
  health: GoalHealth;
  current: Milestone | null;
  /** Milestones active today: their start→end dates span today, they are in progress, or the current stage. */
  active: Milestone[];
  /** The concrete next step: the current milestone's first open task, else the goal's. */
  nextTask: Task | null;
  urgency: number;
}

export function summarizeGoal(goal: Goal, data: GoalData, today: ISODate): GoalSummary {
  const milestones = byOrder(data.milestones.filter((m) => m.goalId === goal.id));
  const tasks = goalTasks(goal, milestones, data.tasks);
  const progress = goalProgress(goal, milestones, tasks);
  const health = goalHealth(goal, progress, milestones, today);
  const current = goal.status === 'completed' ? null : currentMilestone(milestones);
  const open = tasks.filter((t) => t.status !== 'done');
  const byDue = (a: Task, b: Task) => (a.plannedDate ?? a.dueDate ?? '9999').localeCompare(b.plannedDate ?? b.dueDate ?? '9999') || a.createdAt.localeCompare(b.createdAt);
  // The current milestone's first open task; failing that, any open task of the goal.
  const nextTask = (current && open.filter((t) => t.milestoneId === current.id).sort(byDue)[0]) || (open.sort(byDue)[0] ?? null);
  const active = goal.status === 'active' ? activeMilestones(milestones, today) : [];
  return { goal, milestones, tasks, progress, health, current, active, nextTask, urgency: goalUrgency(health, goal) };
}

export const summarizeAll = (data: GoalData, today: ISODate) => data.goals.map((g) => summarizeGoal(g, data, today));

export interface MilestoneDraft {
  title: string;
  startDate?: string | null;
  targetDate: string | null;
}

/** A milestone with no start date begins the day after the previous one ends (or when the goal starts). */
function defaultStart(prevEnd: string | null | undefined, goalStart: string, end: string | null): string {
  const start = prevEnd ? addDays(prevEnd, 1) : goalStart;
  return end && start > end ? end : start;
}

export async function createGoal(data: NewRecord<'goal'>, milestones: MilestoneDraft[]): Promise<Goal> {
  const count = (await db.entity('goal').toArray()).filter((g) => !g.deletedAt).length;
  const cat = goalCategory(data.category ?? 'career');
  const goal = await create('goal', { icon: cat.icon, color: cat.color, startDate: todayISO(), order: count, ...data });
  const clean = milestones.filter((m) => m.title.trim());
  if (clean.length) {
    await createMany(
      'milestone',
      clean.map((m, i) => ({ goalId: goal.id, title: m.title.trim(), startDate: m.startDate || defaultStart(clean[i - 1]?.targetDate, goal.startDate, m.targetDate), targetDate: m.targetDate, order: i })),
    );
  }
  return goal;
}

export const updateGoal = (id: string, patch: Partial<Goal>) => update('goal', id, patch);

export async function setGoalStatus(goal: Goal, status: Goal['status']) {
  return update('goal', goal.id, { status, completedAt: status === 'completed' ? (goal.completedAt ?? new Date().toISOString()) : null });
}

/**
 * Deletes a goal and its milestones. Linked tasks are unlinked and kept (they may already
 * be on the student's daily plan), unless `deleteOpenTasks`: then unfinished ones go too.
 */
export async function deleteGoal(goal: Goal, deleteOpenTasks: boolean) {
  const ms = (await db.entity('milestone').where('goalId').equals(goal.id).toArray()).filter((m) => !m.deletedAt);
  const msIds = new Set(ms.map((m) => m.id));
  const tasks = (await db.entity('task').toArray()).filter((t) => !t.deletedAt && (t.goalId === goal.id || (t.milestoneId && msIds.has(t.milestoneId))));
  const drop = deleteOpenTasks ? tasks.filter((t) => t.status !== 'done') : [];
  await removeMany('task', drop.map((t) => t.id));
  for (const t of tasks.filter((t) => !drop.includes(t))) await update('task', t.id, { goalId: null, milestoneId: null });
  await removeMany('milestone', [...msIds]);
  await remove('goal', goal.id);
}

async function goalMilestones(goalId: string) {
  return byOrder((await db.entity('milestone').where('goalId').equals(goalId).toArray()).filter((m) => !m.deletedAt));
}

export async function addMilestone(goalId: string, data: Omit<NewRecord<'milestone'>, 'goalId'>): Promise<Milestone> {
  const ms = await goalMilestones(goalId);
  const goal = (await db.entity('goal').get(goalId))!;
  const startDate = data.startDate || defaultStart(ms.at(-1)?.targetDate, goal.startDate, data.targetDate ?? null);
  return create('milestone', { ...data, startDate, goalId, order: (ms.at(-1)?.order ?? -1) + 1 });
}

export const updateMilestone = (id: string, patch: Partial<Milestone>) => update('milestone', id, patch);

export async function setMilestoneStatus(m: Milestone, status: MilestoneStatus) {
  return update('milestone', m.id, { status, completedAt: status === 'done' ? (m.completedAt ?? new Date().toISOString()) : null });
}

/** Removes a milestone. Its tasks stay on the goal (without a milestone). */
export async function deleteMilestone(m: Milestone) {
  const tasks = (await db.entity('task').toArray()).filter((t) => !t.deletedAt && t.milestoneId === m.id);
  for (const t of tasks) await update('task', t.id, { milestoneId: null, goalId: m.goalId });
  await remove('milestone', m.id);
}

/** Moves a milestone one place up or down and renumbers the goal's milestones 0..n. */
export async function moveMilestone(m: Milestone, dir: -1 | 1) {
  const ms = await goalMilestones(m.goalId);
  const i = ms.findIndex((x) => x.id === m.id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= ms.length) return;
  [ms[i], ms[j]] = [ms[j]!, ms[i]!];
  for (const [k, x] of ms.entries()) if (x.order !== k) await update('milestone', x.id, { order: k });
}

export async function addGoalTask(goal: Goal, milestoneId: string | null, data: { title: string; dueDate?: string | null; plannedDate?: string | null; priority?: Task['priority'] }) {
  return create('task', {
    title: data.title.trim(),
    goalId: goal.id,
    milestoneId,
    category: goalCategory(goal.category).key === 'health' || goalCategory(goal.category).key === 'personal' ? 'Personal' : 'Goal',
    priority: data.priority ?? 'medium',
    dueDate: data.dueDate ?? null,
    plannedDate: data.plannedDate ?? null,
  });
}

export const toggleTask = (t: Task, done: boolean) => update('task', t.id, { status: done ? 'done' : 'todo', completedAt: done ? new Date().toISOString() : null });

/** Puts a roadmap task on today's plan, so it shows in Todos and on Home. */
export const planToday = (t: Task) => update('task', t.id, { plannedDate: todayISO() });

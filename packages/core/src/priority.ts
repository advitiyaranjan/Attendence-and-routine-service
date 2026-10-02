/**
 * Transparent task priority engine. Every point added comes with a reason the
 * UI can show, so the student always knows *why* something is ranked first.
 */
import { diffDays, type ISODate } from './dates';
import type { TaskPriority } from './entities';

export interface PrioritizableTask {
  id: string;
  title: string;
  priority: TaskPriority;
  importance?: number;
  dueDate: ISODate | null;
  estimatedMinutes: number | null;
  status: 'todo' | 'in_progress' | 'done' | string;
  dependsOn?: string[];
}

export type PriorityLevel = 'critical' | 'high' | 'medium' | 'low';

export interface PriorityScore {
  score: number;
  level: PriorityLevel;
  reasons: string[];
}

const PRIORITY_POINTS: Record<TaskPriority, number> = { urgent: 40, high: 30, medium: 20, low: 10 };

export function scoreTask(task: PrioritizableTask, today: ISODate, allTasks: PrioritizableTask[] = []): PriorityScore {
  const reasons: string[] = [];
  let score = PRIORITY_POINTS[task.priority];
  reasons.push(`Marked ${task.priority} priority`);

  const importance = task.importance ?? 3;
  if (importance !== 3) {
    score += (importance - 3) * 5;
    reasons.push(importance > 3 ? 'High importance' : 'Low importance');
  }

  if (task.dueDate) {
    const days = diffDays(today, task.dueDate);
    if (days < 0) {
      score += 45;
      reasons.push(`Overdue by ${-days} day${days === -1 ? '' : 's'}`);
    } else if (days === 0) {
      score += 35;
      reasons.push('Due today');
    } else if (days === 1) {
      score += 30;
      reasons.push('Due tomorrow');
    } else if (days <= 3) {
      score += 20;
      reasons.push(`Due in ${days} days`);
    } else if (days <= 7) {
      score += 10;
      reasons.push(`Due in ${days} days`);
    }

    const est = task.estimatedMinutes ?? 0;
    if (est >= 120 && days >= 0 && days <= 3) {
      score += 10;
      reasons.push(`Estimated ${formatMinutes(est)} — start early`);
    }
  }

  if (task.status === 'in_progress') {
    score += 5;
    reasons.push('Already in progress');
  }

  const blockers = (task.dependsOn ?? [])
    .map((id) => allTasks.find((t) => t.id === id))
    .filter((t): t is PrioritizableTask => !!t && t.status !== 'done');
  if (blockers.length > 0) {
    score -= 30;
    reasons.push(`Waiting on: ${blockers.map((b) => b.title).join(', ')}`);
  }

  const level: PriorityLevel = score >= 70 ? 'critical' : score >= 50 ? 'high' : score >= 30 ? 'medium' : 'low';
  return { score, level, reasons };
}

export function rankTasks<T extends PrioritizableTask>(tasks: T[], today: ISODate): Array<T & { priorityScore: PriorityScore }> {
  return tasks
    .filter((t) => t.status !== 'done')
    .map((t) => ({ ...t, priorityScore: scoreTask(t, today, tasks) }))
    .sort((a, b) => b.priorityScore.score - a.priorityScore.score);
}

export function formatMinutes(total: number): string {
  const h = Math.floor(total / 60);
  const m = Math.round(total % 60);
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

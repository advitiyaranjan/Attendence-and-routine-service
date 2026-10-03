/**
 * The same piece of work can exist more than once: a "UPSC Catch-up Session 1" task next to
 * the session in the calendar, or a "Revision: Geography" session next to the scheduled
 * revision. Lists show it once (preferring the scheduled copy), and an answer given on it
 * (done, not done, reschedule, cancel) is applied to every copy.
 */
import type { CalendarEvent, ISODate, RevisionSchedule, Task } from '@student-os/core';
import type { FeedbackTarget } from '../components/ItemFeedback';

/** "Revise Geography", "Revision: Geography" and "geography" are the same work. */
export const normTitle = (s: string) =>
  s
    .toLowerCase()
    .replace(/^(revise|revision|catch up)\b:?\s*/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** A task's day on the plan: planned date first, then deadline. */
export const taskDay = (t: Task): ISODate | null => t.plannedDate ?? t.dueDate;

export interface PlanData {
  tasks: Task[];
  revisions: RevisionSchedule[];
  topicTitle: (topicId: string) => string;
}

/**
 * Open tasks and revisions that duplicate an item on `date`. Overdue copies count too
 * (a task left over from yesterday is the same work as today's session).
 */
export function copiesOf(title: string, date: ISODate, data: PlanData, today: ISODate): FeedbackTarget[] {
  const key = normTitle(title);
  const matchesDay = (d: ISODate | null) => !!d && (d === date || (date === today && d < today));
  return [
    ...data.tasks.filter((t) => t.status !== 'done' && !t.deletedAt && normTitle(t.title) === key && matchesDay(taskDay(t))).map((task): FeedbackTarget => ({ kind: 'task', task })),
    ...data.revisions
      .filter((r) => r.status === 'pending' && normTitle(data.topicTitle(r.topicId)) === key && matchesDay(r.dueDate))
      .map((revision): FeedbackTarget => ({ kind: 'revision', revision, title: `Revise ${data.topicTitle(revision.topicId)}` })),
  ];
}

/** Normalised titles of today's scheduled sessions/events, to drop their task/revision copies from other lists. */
export function scheduledKeys(events: CalendarEvent[], date: ISODate): Set<string> {
  return new Set(events.filter((e) => e.date === date && !e.deletedAt).map((e) => normTitle(e.title)));
}

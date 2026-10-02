/**
 * Non-React data access over IndexedDB. Shared by the UI hooks, the
 * notification scheduler and the service worker (which has no React/DOM).
 */
import { attendanceOverview, resolveOccurrences, rulesFrom, type AttendanceOverview, type ClassOccurrence, type ISODate, type PlannerData, type Settings } from '@student-os/core';
import { db } from './db';
import { defaultSettings, normalizeSettings, SETTINGS_ID } from './repo';

const live = <T extends { deletedAt: string | null }>(rows: T[]) => rows.filter((r) => !r.deletedAt);

export async function loadSettings(): Promise<Settings> {
  return normalizeSettings(await db.entity('settings').get(SETTINGS_ID));
}

async function loadTimetable() {
  const [schedules, instances] = await Promise.all([db.entity('classSchedule').toArray(), db.entity('classInstance').toArray()]);
  return { schedules: live(schedules), instances };
}

export async function occurrencesBetween(from: ISODate, to: ISODate, settings: Settings): Promise<ClassOccurrence[]> {
  const { schedules, instances } = await loadTimetable();
  return resolveOccurrences(schedules, instances, from, to, rulesFrom(settings));
}

export async function computeAttendance(settings: Settings, today: ISODate): Promise<AttendanceOverview> {
  const [subjects, { schedules, instances }] = await Promise.all([db.entity('subject').toArray(), loadTimetable()]);
  return attendanceOverview({ settings, subjects, schedules, instances }, today);
}

/** Everything the notification planner needs, straight from IndexedDB. */
export async function loadPlannerData(): Promise<PlannerData> {
  const [settings, subjects, schedules, instances, tasks, revisions, topics, exams, assignments, events, reminders] = await Promise.all([
    loadSettings(),
    db.entity('subject').toArray(),
    db.entity('classSchedule').toArray(),
    db.entity('classInstance').toArray(),
    db.entity('task').toArray(),
    db.entity('revisionSchedule').toArray(),
    db.entity('topic').toArray(),
    db.entity('exam').toArray(),
    db.entity('assignment').toArray(),
    db.entity('calendarEvent').toArray(),
    db.entity('reminder').toArray(),
  ]);
  return {
    settings,
    subjects: live(subjects),
    schedules: live(schedules),
    instances,
    tasks: live(tasks),
    revisions: live(revisions),
    topics: live(topics),
    exams: live(exams),
    assignments: live(assignments),
    events: live(events),
    reminders: live(reminders),
  };
}

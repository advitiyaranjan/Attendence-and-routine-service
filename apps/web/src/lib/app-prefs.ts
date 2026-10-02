/** Names for the app-layout preferences (Settings → Appearance, or AI Pilot). */
import type { AppPage, HomeSection } from '@student-os/core';

export const HOME_SECTION_LABEL: Record<HomeSection, string> = {
  upNext: 'Up next',
  overview: 'Overview stats',
  markAttendance: 'Did you attend?',
  priorities: "Today's priorities",
  schedule: "Today's schedule",
  attendance: 'Attendance',
  revision: 'Revision',
  comingUp: 'Coming up',
  thisWeek: 'This week',
  aiPilot: 'Open AI Pilot',
};

export const PAGE_PATH: Record<AppPage, string> = {
  home: '/',
  assistant: '/assistant',
  todos: '/todos',
  calendar: '/calendar',
  revision: '/revision',
  attendance: '/attendance',
  subjects: '/subjects',
  notes: '/notes',
  deadlines: '/deadlines',
  analytics: '/analytics',
  classes: '/classes',
  tasks: '/tasks',
  reminders: '/reminders',
  review: '/review',
  'ai-activity': '/ai-activity',
};

export const PAGE_LABEL: Record<AppPage, string> = {
  home: 'Home',
  assistant: 'AI Pilot',
  todos: 'Todos',
  calendar: 'Calendar',
  revision: 'Revision',
  attendance: 'Attendance',
  subjects: 'Subjects',
  notes: 'Notes',
  deadlines: 'Exams',
  analytics: 'Analytics',
  classes: 'Timetable',
  tasks: 'All tasks',
  reminders: 'Reminders',
  review: 'Daily review',
  'ai-activity': 'AI activity',
};

/** Always in the menu, so AI Pilot (and Settings) can't be lost. */
export const UNHIDEABLE_PAGES: readonly AppPage[] = ['home', 'assistant'];

/** Paths hidden from the menu. */
export function hiddenPaths(hidden: readonly AppPage[]): Set<string> {
  return new Set(hidden.filter((p) => !UNHIDEABLE_PAGES.includes(p)).map((p) => PAGE_PATH[p]));
}

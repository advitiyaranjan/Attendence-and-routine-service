/**
 * Builds the minimal context sent with a Copilot request.
 *
 * - Only categories the student allows (Settings → AI permissions) are included.
 * - Records carry short opaque refs (refOf) instead of database ids; the client
 *   maps refs back to records when resolving an action.
 * - Attendance numbers are pre-computed so the model quotes rather than calculates.
 */
import {
  addDays,
  diffDays,
  freeSlots,
  localMomentNow,
  rankTasks,
  refOf,
  todayISO,
  WEEKDAYS,
  type ClassOccurrence,
} from '@student-os/core';
import { db } from '../db';
import { computeAttendance, loadSettings, occurrencesBetween } from '../queries';

export const REF = { class: 'c', task: 't', event: 'e', revision: 'r', exam: 'x', assignment: 'a', subject: 's', reminder: 'm' } as const;

export async function buildCommandContext(): Promise<Record<string, unknown>> {
  const settings = await loadSettings();
  const p = settings.aiPermissions;
  const today = todayISO();
  const now = localMomentNow();
  const live = <T extends { deletedAt: string | null }>(rows: T[]) => rows.filter((r) => !r.deletedAt);
  const subjects = live(await db.entity('subject').toArray());
  const subjectName = (id: string | null) => subjects.find((s) => s.id === id)?.name ?? null;

  const ctx: Record<string, unknown> = {
    now: { date: today, weekday: WEEKDAYS[new Date().getDay()], time: `${String(Math.floor(now.minutes / 60)).padStart(2, '0')}:${String(now.minutes % 60).padStart(2, '0')}` },
    collegeHours: `${settings.collegeStart}-${settings.collegeEnd}`,
    dailyStudyTargetMinutes: settings.dailyStudyTargetMinutes,
    ...(settings.studyTimes.length ? { preferredStudyTimes: settings.studyTimes } : {}),
    subjects: subjects.map((s) => ({ ref: refOf(REF.subject, s.id), name: s.name, code: s.code })),
  };
  if (p.shareName && settings.profile.name) ctx.studentName = settings.profile.name;

  if (p.readCalendar) {
    const classes = await occurrencesBetween(addDays(today, -7), addDays(today, 14), settings);
    ctx.classes = classes
      .filter((c) => c.status !== 'rescheduled')
      .map((c) => ({
        ref: refOf(REF.class, c.id),
        subject: subjectName(c.subjectId),
        date: c.date,
        start: c.startTime,
        end: c.endTime,
        room: c.room,
        ...(c.status ? { status: c.status } : {}),
      }));
    const events = live(await db.entity('calendarEvent').toArray()).filter((e) => e.date >= addDays(today, -1) && e.date <= addDays(today, 30));
    ctx.events = events.map((e) => ({ ref: refOf(REF.event, e.id), title: e.title, type: e.type, date: e.date, start: e.startTime, end: e.endTime, subject: subjectName(e.subjectId), done: !!e.completedAt }));
    const reminders = live(await db.entity('reminder').toArray()).filter((r) => r.active);
    ctx.reminders = reminders.map((r) => ({ ref: refOf(REF.reminder, r.id), title: r.title, date: r.date, time: r.time, repeats: r.recurrence.freq }));
    // Free time today (from now) and tomorrow, so scheduling never clashes.
    ctx.freeTime = [today, addDays(today, 1)].map((date) => ({
      date,
      free: freeSlots(date, classes as ClassOccurrence[], events, {
        dayStart: '07:00',
        dayEnd: '23:00',
        notBefore: date === today ? now.minutes + 15 : 0,
      }).free.map((f) => `${f.start}-${f.end}`),
    }));
  }

  if (p.readAttendance) {
    const att = await computeAttendance(settings, today);
    ctx.attendance = {
      overallPercent: att.overall.percent === null ? null : Number(att.overall.percent.toFixed(1)),
      rule: { minimum: settings.minAttendance, target: settings.targetAttendance },
      bySubject: att.subjects.map(({ subject, summary }) => ({
        subject: subject.name,
        present: summary.present,
        conducted: summary.conducted,
        percent: summary.percent === null ? null : Number(summary.percent.toFixed(1)),
        status: summary.risk,
        unmarked: summary.unmarked,
        neededForMin: Number.isFinite(summary.neededForMin) ? summary.neededForMin : null,
        canMissForMin: Number.isFinite(summary.canMissForMin) ? summary.canMissForMin : null,
        remainingThisSemester: summary.projection?.remaining ?? null,
        maxMissableThisSemester: summary.projection?.maxMissable ?? null,
        explanation: summary.advice,
      })),
    };
  }

  if (p.readTasks) {
    const tasks = live(await db.entity('task').toArray());
    ctx.openTasks = rankTasks(tasks, today)
      .slice(0, 30)
      .map((t) => ({ ref: refOf(REF.task, t.id), title: t.title, due: t.dueDate, dueTime: t.dueTime, priority: t.priority, estimatedMinutes: t.estimatedMinutes, subject: subjectName(t.subjectId), why: t.priorityScore.reasons.slice(1, 3) }));
    ctx.completedToday = tasks.filter((t) => t.completedAt?.slice(0, 10) === today).map((t) => t.title);
    const assignments = live(await db.entity('assignment').toArray()).filter((a) => a.status !== 'submitted');
    ctx.assignments = assignments.map((a) => ({ ref: refOf(REF.assignment, a.id), title: a.title, deadline: a.deadline, deadlineTime: a.deadlineTime, subject: subjectName(a.subjectId), status: a.status }));
  }

  if (p.readRevision) {
    const [revs, topics] = await Promise.all([db.entity('revisionSchedule').toArray(), db.entity('topic').toArray()]);
    const topicById = new Map(live(topics).map((t) => [t.id, t]));
    ctx.revisions = live(revs)
      .filter((r) => r.status === 'pending' && topicById.has(r.topicId) && r.dueDate <= addDays(today, 14))
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      .slice(0, 40)
      .map((r) => ({ ref: refOf(REF.revision, r.id), topic: topicById.get(r.topicId)!.title, subject: subjectName(r.subjectId), due: r.dueDate, overdueDays: r.dueDate < today ? diffDays(r.dueDate, today) : 0 }));
    ctx.weakTopics = [...topicById.values()].filter((t) => t.ease < 0.9).slice(0, 10).map((t) => t.title);
  }

  if (p.readExams) {
    const exams = live(await db.entity('exam').toArray()).filter((e) => e.date >= today);
    ctx.exams = exams.map((e) => ({ ref: refOf(REF.exam, e.id), title: e.title, subject: subjectName(e.subjectId), date: e.date, startTime: e.startTime, kind: e.kind, daysLeft: diffDays(today, e.date), topics: e.topics }));
  }

  if (p.readNotes) {
    const notes = live(await db.entity('note').toArray());
    ctx.notes = notes.slice(0, 20).map((n) => ({ title: n.title, subject: subjectName(n.subjectId), excerpt: n.body.slice(0, 300) }));
  }
  return ctx;
}

/**
 * Notification planner.
 *
 * One pure function decides what should be notified and when, from the
 * student's data and local wall-clock time. The same planner runs in three
 * places, so reminders work in every state:
 *
 *   app open            → in-app scheduler (works offline)
 *   app closed, offline → service worker periodic sync (best effort)
 *   app/browser closed  → server Web Push, using synced data + the user's timezone
 *
 * Every notification has a deterministic id derived from what it is about
 * (e.g. "class reminder, 15 min, for this class on this date"). Re-running the
 * planner after a sync yields the same ids, so deliveries can be de-duplicated
 * across runs, devices and channels. Cancelled, rescheduled, completed or
 * deleted items simply stop being planned.
 */
import { v5 as uuidv5 } from 'uuid';
import { fmtPct } from './attendance';
import { addDays, diffDays, formatTime12, minutesToTime, timeToMinutes, weekdayOf, type ISODate } from './dates';
import type {
  Assignment,
  CalendarEvent,
  ClassInstance,
  ClassSchedule,
  Exam,
  NotificationCategory,
  Reminder,
  RevisionSchedule,
  Settings,
  Subject,
  Task,
  Topic,
} from './entities';
import { attendanceOverview, rulesFrom } from './overview';
import { resolveOccurrences, type ClassOccurrence } from './recurrence';
import { reminderDates } from './reminders';

const NOTIFICATION_NAMESPACE = '0b6f2f2e-3c1d-4f5e-9c39-7d4a7b0f5a21';

export type NotificationType =
  | 'class_reminder'
  | 'attendance_prompt'
  | 'revision_due'
  | 'task_due'
  | 'assignment_due'
  | 'exam_reminder'
  | 'study_session'
  | 'event_reminder'
  | 'reminder'
  | 'daily_review'
  | 'weekly_review'
  | 'attendance_risk'
  | 'ai_suggestion'
  | 'sync';

/** Actions a notification can offer. Handlers live in the app / service worker / server. */
export type NotificationActionId =
  | 'open'
  | 'present'
  | 'absent'
  | 'cancelled'
  | 'complete'
  | 'done'
  | 'snooze'
  | 'start'
  | 'skip';

export interface NotificationAction {
  action: NotificationActionId;
  title: string;
}

export interface PlannedNotification {
  id: string;
  key: string;
  type: NotificationType;
  category: NotificationCategory;
  title: string;
  body: string;
  entityType: string | null;
  entityId: string | null;
  /** Local wall-clock time it is due. */
  date: ISODate;
  time: string;
  /** Minutes since 1970-01-01 00:00 local time (for ordering/windows). */
  stamp: number;
  /** Not delivered after this stamp (stale). */
  expiresAt: number;
  actions: NotificationAction[];
  href: string;
  /** Extra data for action handlers (e.g. the class occurrence). */
  data?: Record<string, unknown>;
}

export interface LocalMoment {
  date: ISODate;
  minutes: number;
}

export interface PlannerData {
  settings: Settings;
  subjects: Subject[];
  schedules: ClassSchedule[];
  instances: ClassInstance[];
  tasks: Task[];
  revisions: RevisionSchedule[];
  topics: Topic[];
  exams: Exam[];
  assignments: Assignment[];
  events: CalendarEvent[];
  reminders: Reminder[];
}

export const toStamp = (date: ISODate, minutes: number) => diffDays('1970-01-01', date) * 1440 + minutes;
export const fromStamp = (stamp: number): LocalMoment => {
  const days = Math.floor(stamp / 1440);
  return { date: addDays('1970-01-01', days), minutes: stamp - days * 1440 };
};

export function notificationId(key: string): string {
  return uuidv5(key, NOTIFICATION_NAMESPACE);
}

function humanOffset(minutes: number): string {
  if (minutes === 0) return 'now';
  if (minutes < 60) return `in ${minutes} min`;
  if (minutes % 1440 === 0) {
    const d = minutes / 1440;
    return d === 1 ? 'tomorrow' : `in ${d} days`;
  }
  if (minutes < 1440) {
    const h = Math.round(minutes / 60);
    return `in ${h} hour${h === 1 ? '' : 's'}`;
  }
  return `in ${Math.round(minutes / 1440)} days`;
}

/** "today at 8:00 PM", "tomorrow at 9:00 AM", "on 2026-10-20 at 9:00 AM" */
function whenLabel(date: ISODate, time: string, today: ISODate): string {
  const d = diffDays(today, date);
  const day = d === 0 ? 'today' : d === 1 ? 'tomorrow' : `on ${date}`;
  return `${day} at ${formatTime12(time)}`;
}

const ATTENDANCE_PROMPT_TTL = 12 * 60;

/**
 * Plan every notification whose due time falls within [now − lookback, now + lookahead].
 */
export function planNotifications(data: PlannerData, now: LocalMoment, lookbackMinutes = 180, lookaheadMinutes = 0): PlannedNotification[] {
  const { settings } = data;
  const cats = settings.notifications.categories;
  const nowStamp = toStamp(now.date, now.minutes);
  const windowStart = nowStamp - lookbackMinutes;
  const windowEnd = nowStamp + lookaheadMinutes;
  const fromDate = fromStamp(windowStart).date;
  const toDate = fromStamp(windowEnd).date;
  const out: PlannedNotification[] = [];
  const subjects = new Map(data.subjects.filter((s) => !s.deletedAt && s.active).map((s) => [s.id, s]));
  const subjectName = (id: string | null) => (id ? (subjects.get(id)?.name ?? null) : null);

  const push = (n: Omit<PlannedNotification, 'id' | 'date' | 'time'>) => {
    if (n.stamp < windowStart || n.stamp > windowEnd) return;
    const m = fromStamp(n.stamp);
    out.push({ ...n, id: notificationId(n.key), date: m.date, time: minutesToTime(m.minutes) });
  };
  if (!settings.onboarded) return out;

  // --- Classes and attendance -------------------------------------------------
  if (cats.classes.enabled || cats.attendance.enabled) {
    const maxBefore = Math.max(0, ...cats.classes.offsets);
    const occ = resolveOccurrences(
      data.schedules.filter((s) => !s.deletedAt),
      data.instances,
      addDays(fromDate, -1),
      fromStamp(windowEnd + maxBefore).date,
      rulesFrom(settings),
    );
    for (const o of occ) {
      const subject = subjects.get(o.subjectId);
      if (!subject || o.status === 'cancelled' || o.status === 'rescheduled') continue;
      const start = toStamp(o.date, timeToMinutes(o.startTime));
      const end = toStamp(o.date, timeToMinutes(o.endTime));
      const range = `${formatTime12(o.startTime)} – ${formatTime12(o.endTime)}${o.room ? ` · Room ${o.room}` : ''}`;
      const occurrence = occurrenceData(o);

      if (cats.classes.enabled) {
        for (const offset of cats.classes.offsets) {
          push({
            key: `class:${o.id}:${o.date}:${o.startTime}:${offset}`,
            type: 'class_reminder',
            category: 'classes',
            title: offset === 0 ? `${subject.name} starts now` : `${subject.name} starts ${humanOffset(offset)}`,
            body: range,
            entityType: 'class_instance',
            entityId: o.id,
            stamp: start - offset,
            expiresAt: start + 5,
            actions: [
              { action: 'open', title: 'Open class' },
              { action: 'present', title: 'Mark present' },
            ],
            href: '/today',
            data: { occurrence },
          });
        }
      }
      if (cats.attendance.enabled && (o.status === null || o.status === 'unsure')) {
        const after = cats.attendance.offsets[0] ?? 0;
        push({
          key: `attend:${o.id}:${o.date}:${o.startTime}`,
          type: 'attendance_prompt',
          category: 'attendance',
          title: `Did you attend ${subject.name}?`,
          body: `${formatTime12(o.startTime)} – ${formatTime12(o.endTime)}`,
          entityType: 'class_instance',
          entityId: o.id,
          stamp: end + after,
          expiresAt: end + after + ATTENDANCE_PROMPT_TTL,
          actions: [
            { action: 'present', title: '✓ Present' },
            { action: 'absent', title: '✕ Absent' },
            { action: 'cancelled', title: '⚠ Cancelled' },
          ],
          href: '/attendance',
          data: { occurrence },
        });
      }
    }
  }

  // --- Revision ------------------------------------------------------------------
  if (cats.revision.enabled) {
    const topics = new Map(data.topics.filter((t) => !t.deletedAt).map((t) => [t.id, t]));
    const due = data.revisions.filter((r) => !r.deletedAt && r.status === 'pending' && r.dueDate >= fromDate && r.dueDate <= toDate && topics.has(r.topicId));
    const byDate = new Map<string, RevisionSchedule[]>();
    for (const r of due) byDate.set(r.dueDate, [...(byDate.get(r.dueDate) ?? []), r]);
    const at = timeToMinutes(cats.revision.time);
    for (const [date, list] of byDate) {
      if (list.length <= 3) {
        for (const r of list) {
          const topic = topics.get(r.topicId)!;
          push({
            key: `rev:${r.id}:${date}`,
            type: 'revision_due',
            category: 'revision',
            title: '📚 Revision due',
            body: `${topic.title}${subjectName(r.subjectId) ? ` (${subjectName(r.subjectId)})` : ''} is scheduled for revision today.`,
            entityType: 'revision',
            entityId: r.id,
            stamp: toStamp(date, at),
            expiresAt: toStamp(date, 1439),
            actions: [
              { action: 'start', title: 'Start revision' },
              { action: 'done', title: 'Done' },
              { action: 'snooze', title: 'Snooze' },
            ],
            href: '/revision',
          });
        }
      } else {
        push({
          key: `revs:${date}:${list.length}`,
          type: 'revision_due',
          category: 'revision',
          title: `📚 ${list.length} revisions due today`,
          body: list
            .slice(0, 3)
            .map((r) => topics.get(r.topicId)!.title)
            .join(', ') + (list.length > 3 ? '…' : ''),
          entityType: null,
          entityId: null,
          stamp: toStamp(date, at),
          expiresAt: toStamp(date, 1439),
          actions: [
            { action: 'start', title: 'Start revising' },
            { action: 'snooze', title: 'Snooze' },
          ],
          href: '/revision',
        });
      }
    }
  }

  // --- Tasks ------------------------------------------------------------------------
  if (cats.tasks.enabled) {
    for (const t of data.tasks) {
      if (t.deletedAt || t.status === 'done' || !t.dueDate) continue;
      const time = t.dueTime ?? cats.tasks.time;
      const due = toStamp(t.dueDate, timeToMinutes(time));
      for (const offset of cats.tasks.offsets) {
        push({
          key: `task:${t.id}:${t.dueDate}:${time}:${offset}`,
          type: 'task_due',
          category: 'tasks',
          title: '🎯 Task reminder',
          body: `${t.title}\nDue ${whenLabel(t.dueDate, time, now.date)}.`,
          entityType: 'task',
          entityId: t.id,
          stamp: due - offset,
          expiresAt: due + 60,
          actions: [
            { action: 'complete', title: 'Complete' },
            { action: 'snooze', title: 'Snooze' },
          ],
          href: '/tasks',
        });
      }
    }
  }

  // --- Assignments ----------------------------------------------------------------
  if (cats.assignments.enabled) {
    for (const a of data.assignments) {
      if (a.deletedAt || a.status === 'submitted') continue;
      const time = a.deadlineTime ?? cats.assignments.time;
      const due = toStamp(a.deadline, timeToMinutes(time));
      for (const offset of cats.assignments.offsets) {
        push({
          key: `assign:${a.id}:${a.deadline}:${time}:${offset}`,
          type: 'assignment_due',
          category: 'assignments',
          title: '⚠️ Assignment deadline',
          body: `${a.title}${subjectName(a.subjectId) ? ` (${subjectName(a.subjectId)})` : ''}\nDue ${humanOffset(offset)}.`,
          entityType: 'assignment',
          entityId: a.id,
          stamp: due - offset,
          expiresAt: due,
          actions: [{ action: 'open', title: 'Open' }],
          href: '/deadlines',
        });
      }
    }
  }

  // --- Exams -----------------------------------------------------------------------
  if (cats.exams.enabled) {
    for (const e of data.exams) {
      if (e.deletedAt) continue;
      const time = e.startTime ?? cats.exams.time;
      const start = toStamp(e.date, timeToMinutes(time));
      for (const offset of cats.exams.offsets) {
        const days = Math.round(offset / 1440);
        push({
          key: `exam:${e.id}:${e.date}:${time}:${offset}`,
          type: 'exam_reminder',
          category: 'exams',
          title: '📅 Exam reminder',
          body: `${e.title}\n${offset >= 1440 ? `${days} day${days === 1 ? '' : 's'} remaining.` : `Starts ${humanOffset(offset)}${e.room ? ` · ${e.room}` : ''}.`}`,
          entityType: 'exam',
          entityId: e.id,
          stamp: start - offset,
          expiresAt: start,
          actions: [{ action: 'open', title: 'View preparation plan' }],
          href: '/deadlines',
        });
      }
    }
  }

  // --- Study sessions and timed events ---------------------------------------------
  for (const ev of data.events) {
    if (ev.deletedAt || ev.completedAt || !ev.startTime) continue;
    const isStudy = ev.type === 'study';
    const cat = isStudy ? cats.studySessions : cats.reminders;
    if (!cat.enabled) continue;
    const start = toStamp(ev.date, timeToMinutes(ev.startTime));
    for (const offset of isStudy ? cats.studySessions.offsets : [0]) {
      push({
        key: `event:${ev.id}:${ev.date}:${ev.startTime}:${offset}`,
        type: isStudy ? 'study_session' : 'event_reminder',
        category: isStudy ? 'studySessions' : 'reminders',
        title: isStudy ? `🧠 Study session ${offset === 0 ? 'starts now' : `starts ${humanOffset(offset)}`}` : `🔔 ${ev.title}`,
        body: `${isStudy ? `${ev.title}\n` : ''}${formatTime12(ev.startTime)}${ev.endTime ? ` – ${formatTime12(ev.endTime)}` : ''}`,
        entityType: 'calendar_event',
        entityId: ev.id,
        stamp: start - offset,
        expiresAt: ev.endTime ? toStamp(ev.date, timeToMinutes(ev.endTime)) : start + 60,
        actions: isStudy
          ? [
              { action: 'start', title: 'Start' },
              { action: 'skip', title: 'Skip' },
            ]
          : [{ action: 'open', title: 'Open' }],
        href: '/today',
      });
    }
  }

  // --- Custom reminders ------------------------------------------------------------
  if (cats.reminders.enabled) {
    for (const r of data.reminders) {
      if (r.deletedAt || !r.active) continue;
      for (const date of reminderDates(r.date, r.recurrence, fromDate, toDate)) {
        if (r.doneDates.includes(date)) continue;
        const stamp = toStamp(date, timeToMinutes(r.time));
        push({
          key: `rem:${r.id}:${date}:${r.time}`,
          type: 'reminder',
          category: 'reminders',
          title: `⏰ ${r.title}`,
          body: r.notes ?? `Reminder for ${formatTime12(r.time)}`,
          entityType: 'reminder',
          entityId: r.id,
          stamp,
          expiresAt: stamp + 12 * 60,
          actions: [
            { action: 'done', title: 'Done' },
            { action: 'snooze', title: 'Snooze' },
          ],
          href: '/reminders',
          data: { date },
        });
      }
    }
  }

  // --- Daily / weekly review and morning AI suggestion ------------------------------
  for (const date of datesBetween(fromDate, toDate)) {
    if (cats.dailyReview.enabled) {
      const open = data.tasks.filter((t) => !t.deletedAt && t.status !== 'done' && (t.plannedDate ?? t.dueDate ?? '9999') <= date).length;
      const done = data.tasks.filter((t) => !t.deletedAt && t.completedAt?.slice(0, 10) === date).length;
      push({
        key: `daily:${date}`,
        type: 'daily_review',
        category: 'dailyReview',
        title: '🌙 Daily review',
        body: `You completed ${done} task${done === 1 ? '' : 's'}${open ? ` and have ${open} unfinished` : ''}. Ready for your daily review?`,
        entityType: null,
        entityId: null,
        stamp: toStamp(date, timeToMinutes(cats.dailyReview.time)),
        expiresAt: toStamp(date, 1439),
        actions: [{ action: 'open', title: 'Review my day' }],
        href: '/review',
      });
    }
    if (cats.weeklyReview.enabled && weekdayOf(date) === cats.weeklyReview.weekday) {
      push({
        key: `weekly:${date}`,
        type: 'weekly_review',
        category: 'weeklyReview',
        title: '📊 Weekly academic review',
        body: 'Your weekly academic summary is ready.',
        entityType: null,
        entityId: null,
        stamp: toStamp(date, timeToMinutes(cats.weeklyReview.time)),
        expiresAt: toStamp(date, 1439),
        actions: [{ action: 'open', title: 'View review' }],
        href: '/review?tab=weekly',
      });
    }
    if (cats.aiSuggestions.enabled && settings.aiPermissions.enabled) {
      const classes = resolveOccurrences(data.schedules.filter((s) => !s.deletedAt), data.instances, date, date, rulesFrom(settings)).filter(
        (o) => o.status !== 'cancelled' && o.status !== 'rescheduled',
      ).length;
      const revs = data.revisions.filter((r) => !r.deletedAt && r.status === 'pending' && r.dueDate <= date).length;
      const tasks = data.tasks.filter((t) => !t.deletedAt && t.status !== 'done' && (t.plannedDate ?? t.dueDate ?? '9999') <= date).length;
      if (classes + revs + tasks > 0) {
        push({
          key: `ai:${date}`,
          type: 'ai_suggestion',
          category: 'aiSuggestions',
          title: '✨ Plan your day',
          body: `${classes} class${classes === 1 ? '' : 'es'}, ${revs} revision${revs === 1 ? '' : 's'} and ${tasks} task${tasks === 1 ? '' : 's'} today. Want Study Copilot to organise it?`,
          entityType: null,
          entityId: null,
          stamp: toStamp(date, timeToMinutes(cats.aiSuggestions.time)),
          expiresAt: toStamp(date, 12 * 60),
          actions: [{ action: 'open', title: 'Create plan' }],
          href: '/assistant?prompt=plan-today',
        });
      }
    }
  }

  // --- Attendance risk (state-based: fires once per change in counts) ---------------
  if (cats.attendanceRisk.enabled) {
    const earliest = toStamp(now.date, timeToMinutes(cats.attendanceRisk.time));
    const latest = toStamp(now.date, 21 * 60);
    if (nowStamp >= earliest && nowStamp <= latest) {
      const overview = attendanceOverview(data, now.date);
      for (const { subject, summary } of overview.subjects) {
        if (summary.percent === null || summary.conducted < 3) continue;
        const canMiss = summary.projection ? summary.projection.maxMissable : summary.canMissForMin;
        const risky = summary.risk === 'below_min' || canMiss <= cats.attendanceRisk.margin;
        if (!risky) continue;
        const min = subject.minAttendance ?? settings.minAttendance;
        push({
          key: `risk:${subject.id}:${summary.present}/${summary.conducted}`,
          type: 'attendance_risk',
          category: 'attendanceRisk',
          title: '⚠️ Attendance alert',
          body: `${subject.name}: ${fmtPct(summary.percent)} (minimum ${min}%). ${summary.advice}`,
          entityType: 'subject',
          entityId: subject.id,
          stamp: nowStamp,
          expiresAt: latest,
          actions: [{ action: 'open', title: 'View attendance' }],
          href: '/attendance',
        });
      }
    }
  }

  return out.sort((a, b) => a.stamp - b.stamp);
}

function datesBetween(from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function occurrenceData(o: ClassOccurrence) {
  return {
    id: o.id,
    scheduleId: o.scheduleId,
    subjectId: o.subjectId,
    date: o.date,
    startTime: o.startTime,
    endTime: o.endTime,
    room: o.room,
    isExtra: o.isExtra,
    rescheduledFromId: o.rescheduledFromId,
    rescheduledToId: o.rescheduledToId,
  };
}

/** Notifications that should be shown right now (due and not stale). */
export function dueNow(planned: PlannedNotification[], now: LocalMoment): PlannedNotification[] {
  const nowStamp = toStamp(now.date, now.minutes);
  return planned.filter((n) => n.stamp <= nowStamp && nowStamp <= n.expiresAt);
}

/** Local wall-clock time in an IANA timezone (server side). */
export function localMomentIn(timeZone: string, at: Date = new Date()): LocalMoment {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at);
  } catch {
    parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at);
  }
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

/** Local wall-clock time on this device. */
export function localMomentNow(at: Date = new Date()): LocalMoment {
  const pad = (n: number) => String(n).padStart(2, '0');
  return { date: `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`, minutes: at.getHours() * 60 + at.getMinutes() };
}

export const NOTIFICATION_CATEGORY_LABEL: Record<NotificationCategory, string> = {
  classes: 'Classes',
  attendance: 'Attendance',
  revision: 'Revision',
  tasks: 'Tasks',
  assignments: 'Assignments',
  exams: 'Exams',
  studySessions: 'Study sessions',
  dailyReview: 'Daily review',
  weeklyReview: 'Weekly review',
  attendanceRisk: 'Attendance risk',
  reminders: 'Reminders & events',
  aiSuggestions: 'AI suggestions',
  sync: 'Sync',
};

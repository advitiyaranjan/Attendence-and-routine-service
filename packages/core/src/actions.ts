/**
 * AI action registry — the only bridge between Gemini and application data.
 *
 *   User → Gemini → intent → schema validation (here) → permission check →
 *   target resolution against real data → confirmation UI → execution → sync
 *
 * Gemini can only emit intents from this list. It never sees or emits database
 * ids: records are referenced by short opaque refs from the context it was
 * given (see refOf) or by description (subject/date/time), and the client
 * resolves them against real data, asking the student when ambiguous.
 */
import { z } from 'zod';
import { isISODate, normalizeTime } from './dates';
import { AI_PROTECTED_SETTINGS, type AIArea, type AIPermission, type AIPermissions } from './entities';

const time = z.string().transform((v, ctx) => {
  const t = normalizeTime(v);
  if (!t) {
    ctx.addIssue({ code: 'custom', message: `Invalid time "${v}"` });
    return z.NEVER;
  }
  return t;
});
const date = z.string().refine(isISODate, 'Expected YYYY-MM-DD');
const optStr = (max = 300) =>
  z
    .string()
    .max(max)
    .nullish()
    .transform((v) => (v && v.trim() ? v.trim() : null));
const optTime = time.nullish().transform((v) => v ?? null);
const optDate = date.nullish().transform((v) => v ?? null);
const priority = z
  .string()
  .nullish()
  .transform((v): 'low' | 'medium' | 'high' | 'urgent' => {
    const s = (v ?? '').toLowerCase();
    return s === 'low' || s === 'high' || s === 'urgent' ? s : 'medium';
  });
const ref = optStr(20);

export const classTarget = z.object({ ref, subject: optStr(), date: optDate, time: optTime });
export const taskTarget = z.object({ ref, title: optStr() });
export const eventTarget = z.object({ ref, title: optStr(), date: optDate });
export const revisionTarget = z.object({ ref, topic: optStr(), date: optDate });
export const examTarget = z.object({ ref, title: optStr(), subject: optStr() });
export const assignmentTarget = z.object({ ref, title: optStr() });
export type ClassTarget = z.infer<typeof classTarget>;

const eventInput = z.object({
  title: z.string().trim().min(1).max(300),
  type: z.enum(['study', 'revision', 'practice', 'personal', 'event', 'break']).catch('study'),
  date,
  startTime: time,
  endTime: time,
  subject: optStr(),
});

const recurrenceInput = z
  .object({
    freq: z.enum(['none', 'daily', 'weekdays', 'weekly', 'monthly', 'custom']).catch('none'),
    interval: z.number().int().min(1).max(365).nullish().transform((v) => v ?? 1),
    weekdays: z.array(z.number().int().min(0).max(6)).max(7).nullish().transform((v) => v ?? []),
    unit: z.enum(['day', 'week', 'month']).nullish().transform((v) => v ?? 'day'),
  })
  .nullish()
  .transform((v) => v ?? { freq: 'none' as const, interval: 1, weekdays: [], unit: 'day' as const });

export type ActionKind = 'read' | 'create' | 'modify' | 'delete';

export interface ActionDefinition<S extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  description: string;
  /** Parameter shape shown to the model. */
  params: string;
  schema: S;
  kind: ActionKind;
  /** All listed permissions are required. */
  permissions: AIPermission[];
  /** Touches several existing records at once. */
  bulk?: boolean;
  /** Systems updated as a side effect (shown in the confirmation). */
  affects?: string[];
}

function define<S extends z.ZodTypeAny>(d: ActionDefinition<S>) {
  return d;
}

export const ACTIONS = {
  create_task: define({
    name: 'create_task',
    description: 'Create a task / to-do.',
    params: '{ title, dueDate?: YYYY-MM-DD, dueTime?: HH:MM, priority?: low|medium|high|urgent, estimatedMinutes?, category?, subject? }',
    schema: z.object({
      title: z.string().trim().min(1).max(300),
      dueDate: optDate,
      dueTime: optTime,
      priority,
      estimatedMinutes: z.number().int().min(0).max(1440).nullish().transform((v) => v ?? null),
      category: optStr(50),
      subject: optStr(),
    }),
    kind: 'create',
    permissions: ['createTasks'],
    affects: ['Tasks', 'Task reminder'],
  }),
  update_task: define({
    name: 'update_task',
    description: 'Change an existing task (title, deadline, priority, plan date).',
    params: '{ target: { ref? | title? }, changes: { title?, dueDate?, dueTime?, plannedDate?, priority?, estimatedMinutes? } }',
    schema: z.object({
      target: taskTarget,
      changes: z.object({
        title: optStr(),
        dueDate: optDate,
        dueTime: optTime,
        plannedDate: optDate,
        priority: z.enum(['low', 'medium', 'high', 'urgent']).nullish(),
        estimatedMinutes: z.number().int().min(0).max(1440).nullish(),
      }),
    }),
    kind: 'modify',
    permissions: ['modifyTasks'],
    affects: ['Tasks', 'Task reminder'],
  }),
  complete_task: define({
    name: 'complete_task',
    description: 'Mark a task as done.',
    params: '{ target: { ref? | title? } }',
    schema: z.object({ target: taskTarget }),
    kind: 'modify',
    permissions: ['modifyTasks'],
  }),
  delete_task: define({
    name: 'delete_task',
    description: 'Delete a task.',
    params: '{ target: { ref? | title? } }',
    schema: z.object({ target: taskTarget }),
    kind: 'delete',
    permissions: ['deleteTasks'],
  }),
  create_class: define({
    name: 'create_class',
    description: 'Add a class: a one-off/extra class on a date, or a new weekly slot (recurring=true with weekday 0-6, 0=Sunday).',
    params: '{ subject, recurring: boolean, date?: YYYY-MM-DD, weekday?: 0-6, startTime: HH:MM, endTime: HH:MM, room?, basket?: only when the subject is new — the basket the student chose for it }',
    schema: z
      .object({
        subject: z.string().trim().min(1).max(200),
        recurring: z.boolean().nullish().transform((v) => !!v),
        date: optDate,
        weekday: z.number().int().min(0).max(6).nullish().transform((v) => v ?? null),
        startTime: time,
        endTime: time,
        room: optStr(100),
        basket: optStr(200),
      })
      .refine((v) => (v.recurring ? v.weekday !== null || v.date !== null : v.date !== null), 'A one-off class needs a date; a weekly class needs a weekday'),
    kind: 'create',
    permissions: ['modifyClasses'],
    affects: ['Timetable', 'Calendar', 'Class reminders', 'Attendance schedule'],
  }),
  cancel_class: define({
    name: 'cancel_class',
    description: 'Mark a specific class occurrence as cancelled (it stops counting for attendance).',
    params: '{ target: { ref? | subject?, date?, time? } }',
    schema: z.object({ target: classTarget }),
    kind: 'modify',
    permissions: ['modifyClasses'],
    affects: ['Calendar', 'Class reminder', 'Attendance'],
  }),
  reschedule_class: define({
    name: 'reschedule_class',
    description: 'Move one class occurrence to a new date and/or time.',
    params: '{ target: { ref? | subject?, date?, time? }, newDate?: YYYY-MM-DD, newStartTime?: HH:MM, newEndTime?: HH:MM }',
    schema: z
      .object({ target: classTarget, newDate: optDate, newStartTime: optTime, newEndTime: optTime })
      .refine((v) => v.newDate || v.newStartTime, 'Give a new date or time'),
    kind: 'modify',
    permissions: ['modifyClasses'],
    affects: ['Calendar', 'Class reminder', 'Attendance schedule'],
  }),
  mark_attendance: define({
    name: 'mark_attendance',
    description: 'Record attendance for a class that took place (only when the student says so).',
    params: '{ target: { ref? | subject?, date?, time? }, status: present|absent|cancelled|unsure }',
    schema: z.object({ target: classTarget, status: z.enum(['present', 'absent', 'cancelled', 'unsure']) }),
    kind: 'modify',
    permissions: ['modifyAttendance'],
    affects: ['Attendance', 'Attendance statistics'],
  }),
  create_event: define({
    name: 'create_event',
    description: 'Add one calendar block: study session, practice, revision block, personal event or break.',
    params: '{ title, type: study|revision|practice|personal|event|break, date, startTime, endTime, subject? }',
    schema: eventInput,
    kind: 'create',
    permissions: ['createEvents'],
    affects: ['Calendar', 'Session reminder'],
  }),
  create_events: define({
    name: 'create_events',
    description: 'Add a multi-session plan (e.g. "plan my evening", study plan, exam preparation). Use for 2+ sessions.',
    params: '{ summary?, events: [ { title, type, date, startTime, endTime, subject? } ] }',
    schema: z.object({ summary: optStr(200), events: z.array(eventInput).min(1).max(60) }),
    kind: 'create',
    permissions: ['createEvents'],
    affects: ['Calendar', 'Session reminders'],
  }),
  update_event: define({
    name: 'update_event',
    description: 'Move or change an existing calendar event / study session.',
    params: '{ target: { ref? | title?, date? }, changes: { title?, date?, startTime?, endTime? } }',
    schema: z.object({
      target: eventTarget,
      changes: z.object({ title: optStr(), date: optDate, startTime: optTime, endTime: optTime }),
    }),
    kind: 'modify',
    permissions: ['modifyEvents'],
    affects: ['Calendar', 'Session reminder'],
  }),
  delete_event: define({
    name: 'delete_event',
    description: 'Delete a calendar event / study session.',
    params: '{ target: { ref? | title?, date? } }',
    schema: z.object({ target: eventTarget }),
    kind: 'delete',
    permissions: ['deleteEvents'],
  }),
  create_topic: define({
    name: 'create_topic',
    description: 'Record a newly learned topic; the app schedules spaced revisions automatically.',
    params: '{ title, subject?, learnedOn?: YYYY-MM-DD }',
    schema: z.object({ title: z.string().trim().min(1).max(300), subject: optStr(), learnedOn: optDate }),
    kind: 'create',
    permissions: ['createRevision'],
    affects: ['Revision schedule', 'Calendar', 'Revision reminders'],
  }),
  update_revision: define({
    name: 'update_revision',
    description: 'Move one revision to another date.',
    params: '{ target: { ref? | topic?, date? }, newDate: YYYY-MM-DD }',
    schema: z.object({ target: revisionTarget, newDate: date }),
    kind: 'modify',
    permissions: ['modifyRevision'],
    affects: ['Revision schedule', 'Calendar'],
  }),
  move_revisions: define({
    name: 'move_revisions',
    description: 'Move ALL pending revisions due on one date to another date (optionally only one subject).',
    params: '{ fromDate: YYYY-MM-DD, toDate: YYYY-MM-DD, subject? }',
    schema: z.object({ fromDate: date, toDate: date, subject: optStr() }),
    kind: 'modify',
    permissions: ['modifyRevision', 'bulkChanges'],
    bulk: true,
    affects: ['Revision schedule', 'Calendar'],
  }),
  delete_revisions: define({
    name: 'delete_revisions',
    description: 'Delete pending revisions matching a subject/topic and/or date range.',
    params: '{ subject?, topic?, fromDate?, toDate? }',
    schema: z
      .object({ subject: optStr(), topic: optStr(), fromDate: optDate, toDate: optDate })
      .refine((v) => v.subject || v.topic || v.fromDate || v.toDate, 'Too broad'),
    kind: 'delete',
    permissions: ['deleteRevision', 'bulkChanges'],
    bulk: true,
  }),
  create_exam: define({
    name: 'create_exam',
    description: 'Add an exam, quiz, viva or practical.',
    params: '{ title, date, subject?, kind?: midsem|endsem|quiz|viva|practical|project|other, startTime?, room? }',
    schema: z.object({
      title: z.string().trim().min(1).max(300),
      date,
      subject: optStr(),
      kind: z.enum(['midsem', 'endsem', 'quiz', 'viva', 'practical', 'project', 'other']).catch('other'),
      startTime: optTime,
      room: optStr(100),
    }),
    kind: 'create',
    permissions: ['createExams'],
    affects: ['Exams', 'Calendar', 'Exam reminders'],
  }),
  update_exam: define({
    name: 'update_exam',
    description: 'Change an exam date/time/title.',
    params: '{ target: { ref? | title?, subject? }, changes: { title?, date?, startTime?, room? } }',
    schema: z.object({ target: examTarget, changes: z.object({ title: optStr(), date: optDate, startTime: optTime, room: optStr(100) }) }),
    kind: 'modify',
    permissions: ['modifyExams'],
    affects: ['Exams', 'Calendar', 'Exam reminders'],
  }),
  create_assignment: define({
    name: 'create_assignment',
    description: 'Add an assignment with a deadline.',
    params: '{ title, deadline: YYYY-MM-DD, deadlineTime?, subject?, priority? }',
    schema: z.object({ title: z.string().trim().min(1).max(300), deadline: date, deadlineTime: optTime, subject: optStr(), priority }),
    kind: 'create',
    permissions: ['createExams'],
    affects: ['Assignments', 'Calendar', 'Deadline reminders'],
  }),
  update_assignment: define({
    name: 'update_assignment',
    description: 'Change an assignment deadline, title or status.',
    params: '{ target: { ref? | title? }, changes: { title?, deadline?, deadlineTime?, status?: todo|in_progress|submitted } }',
    schema: z.object({
      target: assignmentTarget,
      changes: z.object({ title: optStr(), deadline: optDate, deadlineTime: optTime, status: z.enum(['todo', 'in_progress', 'submitted']).nullish() }),
    }),
    kind: 'modify',
    permissions: ['modifyExams'],
    affects: ['Assignments', 'Deadline reminders'],
  }),
  create_note: define({
    name: 'create_note',
    description: 'Create a note.',
    params: '{ title, body (Markdown), subject? }',
    schema: z.object({ title: z.string().trim().min(1).max(300), body: z.string().max(20_000).default(''), subject: optStr() }),
    kind: 'create',
    permissions: ['createNotes'],
  }),
  create_reminder: define({
    name: 'create_reminder',
    description: 'Create a reminder at a date/time, optionally recurring.',
    params: '{ title, date: YYYY-MM-DD, time: HH:MM, notes?, recurrence?: { freq: none|daily|weekdays|weekly|monthly|custom, interval?, weekdays?: [0-6], unit?: day|week|month } }',
    schema: z.object({ title: z.string().trim().min(1).max(300), date, time, notes: optStr(1000), recurrence: recurrenceInput }),
    kind: 'create',
    permissions: ['createReminders'],
    affects: ['Reminders', 'Notifications'],
  }),
  generate_flashcards: define({
    name: 'generate_flashcards',
    description: 'Generate flashcards for a topic (the student reviews them before saving).',
    params: '{ topic, count?: 5-20 }',
    schema: z.object({ topic: z.string().trim().min(1).max(300), count: z.number().int().min(3).max(20).nullish().transform((v) => v ?? 10) }),
    kind: 'create',
    permissions: ['createRevision'],
  }),
  generate_quiz: define({
    name: 'generate_quiz',
    description: 'Start a practice quiz on a topic.',
    params: '{ topic, count?: 5|10|20, difficulty?: easy|medium|hard|mixed }',
    schema: z.object({
      topic: z.string().trim().min(1).max(300),
      count: z.union([z.literal(5), z.literal(10), z.literal(20)]).catch(5),
      difficulty: z.enum(['easy', 'medium', 'hard', 'mixed']).catch('mixed'),
    }),
    kind: 'read',
    permissions: [],
  }),
  create_subject: define({
    name: 'create_subject',
    description: 'Add a new subject/course (so classes, exams, attendance and topics can be linked to it). Every subject is in exactly one basket: set basket to the one the student named (a new name creates that basket); if they did not say, leave it out and the app asks them.',
    params: '{ name, code?, faculty?, credits?, minAttendance?: 0-100, targetAttendance?: 0-100, compulsory?: boolean, basket?: basket name }',
    schema: z.object({
      name: z.string().trim().min(1).max(200),
      basket: optStr(200),
      code: optStr(50),
      faculty: optStr(200),
      credits: z.number().min(0).max(50).nullish().transform((v) => v ?? null),
      minAttendance: z.number().min(0).max(100).nullish().transform((v) => v ?? null),
      targetAttendance: z.number().min(0).max(100).nullish().transform((v) => v ?? null),
      compulsory: z.boolean().nullish().transform((v) => v ?? false),
    }),
    kind: 'create',
    permissions: ['manageSubjects'],
    affects: ['Subjects', 'Attendance tracking'],
  }),
  update_subject: define({
    name: 'update_subject',
    description: 'Rename a subject or change its code, faculty, credits, attendance requirement, basket, or whether it is compulsory (compulsory: missed classes get catch-up sessions and missed revisions/study are rescheduled automatically).',
    params: '{ target: { ref? | name? }, changes: { name?, code?, faculty?, credits?, minAttendance?, targetAttendance?, compulsory?: boolean, basket?: basket name to move it to } }',
    schema: z.object({
      target: z.object({ ref, name: optStr() }),
      changes: z.object({
        name: optStr(200),
        code: optStr(50),
        faculty: optStr(200),
        credits: z.number().min(0).max(50).nullish(),
        minAttendance: z.number().min(0).max(100).nullish(),
        targetAttendance: z.number().min(0).max(100).nullish(),
        compulsory: z.boolean().nullish(),
        basket: optStr(200),
      }),
    }),
    kind: 'modify',
    permissions: ['manageSubjects'],
    affects: ['Subjects', 'Attendance calculations'],
  }),
  delete_subject: define({
    name: 'delete_subject',
    description: 'Delete a subject (its weekly classes stop appearing; past attendance history is kept).',
    params: '{ target: { ref? | name? } }',
    schema: z.object({ target: z.object({ ref, name: optStr() }) }),
    kind: 'delete',
    permissions: ['manageSubjects', 'deleteSubjects'],
    affects: ['Subjects', 'Timetable', 'Calendar', 'Class reminders'],
  }),
  update_weekly_class: define({
    name: 'update_weekly_class',
    description: 'Permanently change a recurring weekly timetable slot (day, time, room) from today on.',
    params: '{ target: { ref? | subject?, weekday?: 0-6, time? }, changes: { weekday?: 0-6, startTime?, endTime?, room? } }',
    schema: z.object({
      target: z.object({ ref, subject: optStr(), weekday: z.number().int().min(0).max(6).nullish().transform((v) => v ?? null), time: optTime }),
      changes: z.object({ weekday: z.number().int().min(0).max(6).nullish(), startTime: optTime, endTime: optTime, room: optStr(100) }),
    }),
    kind: 'modify',
    permissions: ['modifyClasses'],
    affects: ['Timetable', 'Calendar', 'Class reminders', 'Attendance schedule'],
  }),
  delete_weekly_class: define({
    name: 'delete_weekly_class',
    description: 'Remove a recurring weekly timetable slot from today on (past attendance is kept).',
    params: '{ target: { ref? | subject?, weekday?: 0-6, time? } }',
    schema: z.object({
      target: z.object({ ref, subject: optStr(), weekday: z.number().int().min(0).max(6).nullish().transform((v) => v ?? null), time: optTime }),
    }),
    kind: 'delete',
    permissions: ['modifyClasses', 'deleteEvents'],
    affects: ['Timetable', 'Calendar', 'Class reminders'],
  }),
  delete_exam: define({
    name: 'delete_exam',
    description: 'Delete an exam.',
    params: '{ target: { ref? | title?, subject? } }',
    schema: z.object({ target: examTarget }),
    kind: 'delete',
    permissions: ['deleteExams'],
  }),
  delete_assignment: define({
    name: 'delete_assignment',
    description: 'Delete an assignment.',
    params: '{ target: { ref? | title? } }',
    schema: z.object({ target: assignmentTarget }),
    kind: 'delete',
    permissions: ['deleteExams'],
  }),
  delete_note: define({
    name: 'delete_note',
    description: 'Delete a note.',
    params: '{ target: { ref? | title? } }',
    schema: z.object({ target: z.object({ ref, title: optStr() }) }),
    kind: 'delete',
    permissions: ['deleteNotes'],
  }),
  update_reminder: define({
    name: 'update_reminder',
    description: 'Change a reminder (title, date, time, repeat) or pause/resume it.',
    params: '{ target: { ref? | title? }, changes: { title?, date?, time?, active?: boolean, recurrence?: { freq, interval?, weekdays?, unit? } } }',
    schema: z.object({
      target: z.object({ ref, title: optStr() }),
      changes: z.object({ title: optStr(), date: optDate, time: optTime, active: z.boolean().nullish(), recurrence: recurrenceInput.optional() }),
    }),
    kind: 'modify',
    permissions: ['createReminders'],
    affects: ['Reminders', 'Notifications'],
  }),
  delete_reminder: define({
    name: 'delete_reminder',
    description: 'Delete a reminder.',
    params: '{ target: { ref? | title? } }',
    schema: z.object({ target: z.object({ ref, title: optStr() }) }),
    kind: 'delete',
    permissions: ['deleteEvents'],
    affects: ['Reminders', 'Notifications'],
  }),
  create_basket: define({
    name: 'create_basket',
    description: 'Create a basket that groups subjects by where they are taught (e.g. College, Coaching, Music class). A basket can have its own holidays (on top of the global ones), term dates and attendance requirement; blank fields follow the global settings.',
    params: '{ name, icon?: emoji, holidays?: YYYY-MM-DD[], termStart?: YYYY-MM-DD, termEnd?: YYYY-MM-DD, minAttendance?: 0-100, targetAttendance?: 0-100, subjects?: subject names to move into it }',
    schema: z.object({
      name: z.string().trim().min(1).max(200),
      icon: optStr(10),
      holidays: z.array(date).max(366).nullish().transform((v) => v ?? []),
      termStart: optDate,
      termEnd: optDate,
      minAttendance: z.number().min(0).max(100).nullish().transform((v) => v ?? null),
      targetAttendance: z.number().min(0).max(100).nullish().transform((v) => v ?? null),
      subjects: z.array(z.string().trim().min(1).max(200)).max(50).nullish().transform((v) => v ?? []),
    }),
    kind: 'create',
    permissions: ['modifySettings'],
    affects: ['Subjects', 'Timetable', 'Attendance calculations'],
  }),
  update_basket: define({
    name: 'update_basket',
    description: "Change a basket: rename it, add/remove its own holidays, change its term dates or attendance requirement (null = follow the global setting).",
    params: '{ target: { ref? | name? }, changes: { name?, icon?, addHolidays?: YYYY-MM-DD[], removeHolidays?: YYYY-MM-DD[], termStart?, termEnd?, minAttendance?, targetAttendance? } }',
    schema: z.object({
      target: z.object({ ref, name: optStr() }),
      changes: z.object({
        name: optStr(200),
        icon: optStr(10),
        addHolidays: z.array(date).max(366).nullish(),
        removeHolidays: z.array(date).max(366).nullish(),
        termStart: date.nullish(),
        termEnd: date.nullish(),
        minAttendance: z.number().min(0).max(100).nullish(),
        targetAttendance: z.number().min(0).max(100).nullish(),
      }),
    }),
    kind: 'modify',
    permissions: ['modifySettings'],
    affects: ['Timetable', 'Attendance calculations'],
  }),
  update_settings: define({
    name: 'update_settings',
    description: 'Change app settings: attendance rule (min/target/safe %), daily study target, semester dates and holidays (both apply to every basket unless a basket sets its own), revision intervals, theme, class reminder minutes, sleep time (nothing is scheduled during sleep).',
    params: '{ changes: { minAttendance?, targetAttendance?, safeAttendance?, dailyStudyTargetMinutes?, semesterStart?, semesterEnd?, addHolidays?: YYYY-MM-DD[], removeHolidays?: YYYY-MM-DD[], revisionIntervals?: number[], theme?: system|light|dark, classReminderMinutes?: number[], sleepStart?: HH:MM, sleepEnd?: HH:MM } }',
    schema: z.object({
      changes: z.object({
        minAttendance: z.number().min(0).max(100).nullish(),
        targetAttendance: z.number().min(0).max(100).nullish(),
        safeAttendance: z.number().min(0).max(100).nullish(),
        dailyStudyTargetMinutes: z.number().int().min(0).max(1440).nullish(),
        semesterStart: optDate,
        semesterEnd: optDate,
        addHolidays: z.array(date).max(366).nullish(),
        removeHolidays: z.array(date).max(366).nullish(),
        revisionIntervals: z.array(z.number().int().min(1).max(3650)).min(1).max(20).nullish(),
        theme: z.enum(['system', 'light', 'dark']).nullish(),
        classReminderMinutes: z.array(z.number().int().min(0).max(1440)).max(8).nullish(),
        sleepStart: optTime,
        sleepEnd: optTime,
      }),
    }),
    kind: 'modify',
    permissions: ['modifySettings'],
    affects: ['Settings'],
  }),
  update_profile: define({
    name: 'update_profile',
    description: "Update the student's own profile: name, college, course, semester, academic year, bio, preferred study times/hours. Only fields the student explicitly asked to change.",
    params: '{ changes: { name?, college?, course?, semester?, academicYear?, bio?, studyTimes?: [morning|afternoon|evening|night], studyStart?: HH:MM, studyEnd?: HH:MM } }',
    schema: z.object({
      changes: z
        .object({
          name: optStr(100),
          college: optStr(200),
          course: optStr(200),
          semester: optStr(50),
          academicYear: optStr(50),
          bio: optStr(500),
          studyTimes: z.array(z.enum(['morning', 'afternoon', 'evening', 'night'])).max(4).nullish(),
          studyStart: optTime,
          studyEnd: optTime,
        })
        .refine((c) => Object.values(c).some((v) => v !== null && v !== undefined), 'No profile change given')
        .refine((c) => !c.studyStart === !c.studyEnd, 'Give both a start and an end for study hours'),
    }),
    kind: 'modify',
    permissions: ['updateProfile'],
    affects: ['Profile'],
  }),
  navigate: define({
    name: 'navigate',
    description: 'Offer a link to a page: today, calendar, attendance, tasks, revision, deadlines, subjects, notes, analytics, reminders, review, settings.',
    params: '{ page }',
    schema: z.object({
      page: z.enum(['today', 'calendar', 'attendance', 'tasks', 'revision', 'deadlines', 'subjects', 'notes', 'analytics', 'reminders', 'review', 'settings', 'classes']),
    }),
    kind: 'read',
    permissions: [],
  }),
} as const;

export type ActionName = keyof typeof ACTIONS;
export const ACTION_NAMES = Object.keys(ACTIONS) as ActionName[];
export type ActionParams<N extends ActionName> = z.infer<(typeof ACTIONS)[N]['schema']>;

export type AIIntent = { [N in ActionName]: { action: N; params: ActionParams<N> } }[ActionName];

export function actionAllowed(name: ActionName, perms: Partial<Record<AIPermission, boolean>>): { ok: boolean; missing: AIPermission[] } {
  const missing = ACTIONS[name].permissions.filter((p) => !perms[p]);
  return { ok: missing.length === 0, missing };
}

export const PERMISSION_LABEL: Record<AIPermission, string> = {
  readProfile: 'View profile',
  updateProfile: 'Update profile',
  readTasks: 'View todos & assignments',
  createTasks: 'Create todos',
  modifyTasks: 'Update todos',
  deleteTasks: 'Delete todos',
  readCalendar: 'View schedule',
  createEvents: 'Create events & study sessions',
  modifyEvents: 'Update events',
  deleteEvents: 'Delete events, reminders & timetable slots',
  modifyClasses: 'Change classes & timetable',
  createReminders: 'Create & update reminders',
  readAttendance: 'View attendance',
  modifyAttendance: 'Mark & change attendance',
  readRevision: 'View topics & revisions',
  createRevision: 'Create topics, revisions & flashcards',
  modifyRevision: 'Update revision dates',
  deleteRevision: 'Delete revisions',
  readExams: 'View exams & assignments',
  createExams: 'Create exams & assignments',
  modifyExams: 'Update exams & assignments',
  deleteExams: 'Delete exams & assignments',
  manageSubjects: 'Create & update subjects',
  deleteSubjects: 'Delete subjects',
  readNotes: 'View notes',
  createNotes: 'Create notes',
  deleteNotes: 'Delete notes',
  readSettings: 'View settings',
  modifySettings: 'Update allowed settings',
  modifyNotifications: 'Update notification preferences',
  bulkChanges: 'Change many items at once',
};

/** Which permission area each action belongs to (drives "Ask first" vs "Full access"). */
export const ACTION_AREA: Record<ActionName, AIArea | null> = {
  create_task: 'tasks',
  update_task: 'tasks',
  complete_task: 'tasks',
  delete_task: 'tasks',
  create_class: 'schedule',
  cancel_class: 'schedule',
  reschedule_class: 'schedule',
  mark_attendance: 'attendance',
  create_event: 'schedule',
  create_events: 'schedule',
  update_event: 'schedule',
  delete_event: 'schedule',
  create_topic: 'learning',
  update_revision: 'learning',
  move_revisions: 'learning',
  delete_revisions: 'learning',
  create_exam: 'exams',
  update_exam: 'exams',
  create_assignment: 'exams',
  update_assignment: 'exams',
  create_note: 'notes',
  create_reminder: 'schedule',
  generate_flashcards: 'learning',
  generate_quiz: null,
  create_subject: 'subjects',
  update_subject: 'subjects',
  delete_subject: 'subjects',
  update_weekly_class: 'schedule',
  delete_weekly_class: 'schedule',
  delete_exam: 'exams',
  delete_assignment: 'exams',
  delete_note: 'notes',
  update_reminder: 'schedule',
  delete_reminder: 'schedule',
  create_basket: 'settings',
  update_basket: 'settings',
  update_settings: 'settings',
  update_profile: 'profile',
  navigate: null,
};

/**
 * Can this confirmed-or-not action be applied without a confirmation card?
 * Only when its area has "Full access", and never for deletions or bulk changes.
 */
export function canAutoApply(name: ActionName, perms: Pick<AIPermissions, 'access'>): boolean {
  const def = ACTIONS[name];
  const area = ACTION_AREA[name];
  if (!area || def.kind === 'delete' || def.kind === 'read' || def.bulk) return false;
  return perms.access?.[area] === 'full';
}

/** Settings keys a request tries to touch that AI Pilot may never change. */
export function protectedSettingsIn(changes: unknown): string[] {
  if (!changes || typeof changes !== 'object') return [];
  const keys = Object.keys(changes as Record<string, unknown>);
  const lowered = keys.map((k) => k.toLowerCase().replace(/[^a-z]/g, ''));
  const hits = new Set<string>();
  for (const p of AI_PROTECTED_SETTINGS) {
    const target = p.toLowerCase();
    lowered.forEach((k, i) => {
      if (k === target || k.includes('aipower') || k.includes('aipermission') || k === 'power') hits.add(keys[i]!);
    });
  }
  return [...hits];
}

export const PROTECTED_SETTING_MESSAGE =
  "AI Power and AI permissions can only be changed by you, in Settings → AI Pilot. I'm not allowed to change them.";

/**
 * Validate raw model output into typed intents. Unknown actions, invalid
 * parameters, attempts to change protected settings and actions the student
 * hasn't permitted are dropped with a reason.
 */
export function validateIntents(
  raw: unknown[],
  perms?: Partial<Record<AIPermission, boolean>>,
): { intents: AIIntent[]; rejected: Array<{ action: string; reason: string }> } {
  const intents: AIIntent[] = [];
  const rejected: Array<{ action: string; reason: string }> = [];
  for (const item of raw.slice(0, 20)) {
    const obj = (item ?? {}) as Record<string, unknown>;
    const name = String(obj.action ?? obj.type ?? '');
    if (!(name in ACTIONS)) {
      rejected.push({ action: name || 'unknown', reason: /power|permission/i.test(name) ? `Protected: ${PROTECTED_SETTING_MESSAGE}` : 'Unknown action' });
      continue;
    }
    const def = ACTIONS[name as ActionName];
    const params = (obj.params ?? Object.fromEntries(Object.entries(obj).filter(([k]) => k !== 'action' && k !== 'type'))) as Record<string, unknown>;
    // Hard rule: AI Power and AI permissions are user-only, whatever else is allowed.
    if (name === 'update_settings' && protectedSettingsIn(params?.changes).length) {
      rejected.push({ action: name, reason: `Protected: ${PROTECTED_SETTING_MESSAGE}` });
      continue;
    }
    // Permission first, so a blocked action is reported as blocked even when its parameters are wrong.
    // (update_settings depends on which fields change, so it is checked after parsing.)
    const staticMissing = perms && name !== 'update_settings' ? def.permissions.filter((p) => !perms[p]) : [];
    if (staticMissing.length) {
      rejected.push({ action: name, reason: `Not permitted: ${staticMissing.map((m) => PERMISSION_LABEL[m]).join(', ')}` });
      continue;
    }
    const parsed = def.schema.safeParse(params);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      rejected.push({ action: name, reason: `${issue?.path.join('.') || 'params'}: ${issue?.message ?? 'invalid'}` });
      continue;
    }
    if (perms) {
      const needed = requiredPermissions(name as ActionName, parsed.data as Record<string, unknown>);
      const missing = needed.filter((p) => !perms[p]);
      if (missing.length) {
        rejected.push({ action: name, reason: `Not permitted: ${missing.map((m) => PERMISSION_LABEL[m]).join(', ')}` });
        continue;
      }
    }
    intents.push({ action: name, params: parsed.data } as AIIntent);
  }
  return { intents, rejected };
}

/** Static permissions of an action, plus ones that depend on what it changes. */
export function requiredPermissions(name: ActionName, params: Record<string, unknown>): AIPermission[] {
  const needed = [...ACTIONS[name].permissions] as AIPermission[];
  if (name === 'update_settings') {
    const c = (params.changes ?? {}) as Record<string, unknown>;
    const notif = c.classReminderMinutes !== null && c.classReminderMinutes !== undefined;
    const other = Object.entries(c).some(([k, v]) => k !== 'classReminderMinutes' && v !== null && v !== undefined);
    const out: AIPermission[] = [];
    if (other) out.push('modifySettings');
    if (notif) out.push('modifyNotifications');
    return out.length ? out : needed;
  }
  return needed;
}

export const commandResponseSchema = z.object({
  reply: z.string().max(20_000),
  actions: z.array(z.unknown()).max(20).default([]),
  clarification: z
    .object({ question: z.string().max(1000), options: z.array(z.string().max(300)).max(10).default([]) })
    .nullish()
    .transform((v) => v ?? null),
});

/** Catalog text for the system prompt, limited to what the student allows. */
export function actionCatalog(perms: Partial<Record<AIPermission, boolean>>): string {
  const allowed = (n: ActionName) => (n === 'update_settings' ? !!(perms.modifySettings || perms.modifyNotifications) : actionAllowed(n, perms).ok);
  const list = ACTION_NAMES.filter(allowed)
    .map((n) => `- ${n}: ${ACTIONS[n].description} params ${ACTIONS[n].params}`)
    .join('\n');
  const blocked = ACTION_NAMES.filter((n) => !allowed(n));
  if (!blocked.length) return list;
  // Named so the model can say it isn't allowed instead of improvising with another action.
  return `${list}\n\nTurned off by the student (never return these; if asked, reply that you don't have permission and they can allow it in Settings → AI Pilot, and never claim it was done): ${blocked.join(', ')}`;
}

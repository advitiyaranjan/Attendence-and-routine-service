/**
 * Entity schemas shared by the web client and the server.
 *
 * Every mutable record carries sync metadata (id, timestamps, soft delete,
 * version, deviceId, syncStatus). The server validates every synced payload
 * against these schemas before it touches the database.
 */
import { z } from 'zod';

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
export const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:MM');
export const isoDateTime = z.string().min(10);

export const syncStatus = z.enum(['pending', 'synced', 'conflict', 'failed']);
export type SyncStatus = z.infer<typeof syncStatus>;

export const syncMeta = z.object({
  id: z.string().min(1).max(64),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  deletedAt: isoDateTime.nullable(),
  /** Last version acknowledged by the server. 0 = never synced. */
  version: z.number().int().min(0),
  deviceId: z.string().max(64),
  syncStatus: syncStatus,
});
export type SyncMeta = z.infer<typeof syncMeta>;

const optText = (max = 500) => z.string().max(max).nullable().default(null);
const percent = z.number().min(0).max(100);

// ---------------------------------------------------------------------------

export const subjectSchema = syncMeta.extend({
  name: z.string().min(1).max(200),
  code: optText(50),
  faculty: optText(200),
  credits: z.number().min(0).max(50).nullable().default(null),
  color: z.string().max(20).default('#6366f1'),
  /** Per-subject override; null = use the global setting. */
  minAttendance: percent.nullable().default(null),
  targetAttendance: percent.nullable().default(null),
  active: z.boolean().default(true),
});
export type Subject = z.infer<typeof subjectSchema>;

export const classType = z.enum(['lecture', 'lab', 'tutorial', 'other']);
export type ClassType = z.infer<typeof classType>;

/** A recurring weekly slot ("every Monday 10:00–11:00, DBMS"). */
export const classScheduleSchema = syncMeta.extend({
  subjectId: z.string(),
  weekday: z.number().int().min(0).max(6),
  startTime: hhmm,
  endTime: hhmm,
  room: optText(100),
  faculty: optText(200),
  type: classType.default('lecture'),
  active: z.boolean().default(true),
  validFrom: isoDate.nullable().default(null),
  validUntil: isoDate.nullable().default(null),
});
export type ClassSchedule = z.infer<typeof classScheduleSchema>;

export const attendanceStatus = z.enum(['present', 'absent', 'cancelled', 'rescheduled', 'unsure']);
export type AttendanceStatus = z.infer<typeof attendanceStatus>;

/**
 * A concrete occurrence of a class on a date. Only materialised when something
 * happens to it (attendance marked, cancelled, rescheduled, extra class added);
 * untouched future occurrences are generated on the fly from ClassSchedule.
 */
export const classInstanceSchema = syncMeta.extend({
  scheduleId: z.string().nullable(),
  subjectId: z.string(),
  date: isoDate,
  startTime: hhmm,
  endTime: hhmm,
  room: optText(100),
  status: attendanceStatus.nullable().default(null),
  note: optText(1000),
  /** Set on the original instance when it was moved. */
  rescheduledToId: z.string().nullable().default(null),
  /** Set on the replacement instance. */
  rescheduledFromId: z.string().nullable().default(null),
  /** Extra / makeup class that does not come from a schedule slot. */
  isExtra: z.boolean().default(false),
});
export type ClassInstance = z.infer<typeof classInstanceSchema>;

/** Append-only history of attendance changes, so conflicting edits are never lost. */
export const attendanceRecordSchema = syncMeta.extend({
  instanceId: z.string(),
  subjectId: z.string(),
  date: isoDate,
  status: attendanceStatus,
  markedAt: isoDateTime,
});
export type AttendanceRecord = z.infer<typeof attendanceRecordSchema>;

export const taskPriority = z.enum(['low', 'medium', 'high', 'urgent']);
export type TaskPriority = z.infer<typeof taskPriority>;
export const taskStatus = z.enum(['todo', 'in_progress', 'done']);

export const taskSchema = syncMeta.extend({
  title: z.string().min(1).max(300),
  notes: optText(5000),
  category: z.string().max(50).default('General'),
  priority: taskPriority.default('medium'),
  /** 1 (low) – 5 (critical). Feeds the transparent priority score. */
  importance: z.number().int().min(1).max(5).default(3),
  dueDate: isoDate.nullable().default(null),
  dueTime: hhmm.nullable().default(null),
  plannedDate: isoDate.nullable().default(null),
  estimatedMinutes: z.number().int().min(0).max(10_000).nullable().default(null),
  subjectId: z.string().nullable().default(null),
  status: taskStatus.default('todo'),
  completedAt: isoDateTime.nullable().default(null),
  dependsOn: z.array(z.string()).default([]),
  source: z.enum(['manual', 'ai']).default('manual'),
});
export type Task = z.infer<typeof taskSchema>;

export const eventType = z.enum(['study', 'personal', 'event', 'reminder']);
export type EventType = z.infer<typeof eventType>;

export const calendarEventSchema = syncMeta.extend({
  title: z.string().min(1).max(300),
  type: eventType.default('event'),
  date: isoDate,
  startTime: hhmm.nullable().default(null),
  endTime: hhmm.nullable().default(null),
  subjectId: z.string().nullable().default(null),
  notes: optText(5000),
  completedAt: isoDateTime.nullable().default(null),
  source: z.enum(['manual', 'ai']).default('manual'),
});
export type CalendarEvent = z.infer<typeof calendarEventSchema>;

export const studySessionSchema = syncMeta.extend({
  subjectId: z.string().nullable().default(null),
  topicId: z.string().nullable().default(null),
  date: isoDate,
  durationMinutes: z.number().int().min(1).max(1440),
  notes: optText(2000),
});
export type StudySession = z.infer<typeof studySessionSchema>;

export const topicKind = z.enum(['chapter', 'topic', 'subtopic']);

export const topicSchema = syncMeta.extend({
  subjectId: z.string().nullable().default(null),
  parentId: z.string().nullable().default(null),
  title: z.string().min(1).max(300),
  kind: topicKind.default('topic'),
  learnedOn: isoDate.nullable().default(null),
  /** Spaced-repetition state: completed ladder stage and personal ease multiplier. */
  stage: z.number().int().min(0).default(0),
  ease: z.number().min(0.3).max(5).default(1),
  mastered: z.boolean().default(false),
  notes: optText(5000),
});
export type Topic = z.infer<typeof topicSchema>;

export const recallRating = z.enum(['forgot', 'partial', 'remembered', 'easy']);
export type RecallRating = z.infer<typeof recallRating>;

export const revisionScheduleSchema = syncMeta.extend({
  topicId: z.string(),
  subjectId: z.string().nullable().default(null),
  /** 1-based ladder stage this revision represents. */
  stage: z.number().int().min(1),
  dueDate: isoDate,
  status: z.enum(['pending', 'done', 'skipped']).default('pending'),
  completedAt: isoDateTime.nullable().default(null),
  rating: recallRating.nullable().default(null),
});
export type RevisionSchedule = z.infer<typeof revisionScheduleSchema>;

export const examKind = z.enum(['midsem', 'endsem', 'quiz', 'viva', 'practical', 'project', 'other']);

export const examSchema = syncMeta.extend({
  subjectId: z.string().nullable().default(null),
  title: z.string().min(1).max(300),
  kind: examKind.default('other'),
  date: isoDate,
  startTime: hhmm.nullable().default(null),
  room: optText(100),
  topics: optText(5000),
  notes: optText(5000),
});
export type Exam = z.infer<typeof examSchema>;

export const assignmentSchema = syncMeta.extend({
  subjectId: z.string().nullable().default(null),
  title: z.string().min(1).max(300),
  description: optText(5000),
  deadline: isoDate,
  deadlineTime: hhmm.nullable().default(null),
  priority: taskPriority.default('medium'),
  estimatedMinutes: z.number().int().min(0).max(10_000).nullable().default(null),
  status: z.enum(['todo', 'in_progress', 'submitted']).default('todo'),
});
export type Assignment = z.infer<typeof assignmentSchema>;

export const noteSchema = syncMeta.extend({
  subjectId: z.string().nullable().default(null),
  topicId: z.string().nullable().default(null),
  title: z.string().min(1).max(300),
  body: z.string().max(200_000).default(''),
});
export type Note = z.infer<typeof noteSchema>;

export const flashcardSchema = syncMeta.extend({
  topicId: z.string().nullable().default(null),
  subjectId: z.string().nullable().default(null),
  front: z.string().min(1).max(2000),
  back: z.string().min(1).max(5000),
  stage: z.number().int().min(0).default(0),
  ease: z.number().min(0.3).max(5).default(1),
  dueDate: isoDate.nullable().default(null),
});
export type Flashcard = z.infer<typeof flashcardSchema>;

export const quizAttemptSchema = syncMeta.extend({
  topicId: z.string().nullable().default(null),
  subjectId: z.string().nullable().default(null),
  title: z.string().max(300),
  difficulty: z.enum(['easy', 'medium', 'hard', 'mixed']),
  total: z.number().int().min(0),
  correct: z.number().int().min(0),
  takenAt: isoDateTime,
});
export type QuizAttempt = z.infer<typeof quizAttemptSchema>;

export const dailyReviewSchema = syncMeta.extend({
  date: isoDate,
  wentWell: optText(5000),
  notCompleted: optText(5000),
  carryForward: optText(5000),
  aiSummary: optText(5000),
});
export type DailyReview = z.infer<typeof dailyReviewSchema>;

/** Per-category notification preferences. Offsets are minutes before (or after, for attendance) the event. */
const category = (enabled: boolean, extra: { offsets?: number[]; time?: string; weekday?: number; margin?: number } = {}) =>
  z
    .object({
      enabled: z.boolean().default(enabled),
      offsets: z.array(z.number().int().min(0).max(60 * 24 * 60)).max(8).default(extra.offsets ?? []),
      time: hhmm.default(extra.time ?? '09:00'),
      weekday: z.number().int().min(0).max(6).default(extra.weekday ?? 0),
      /** Attendance risk: alert when you can miss this many classes or fewer. */
      margin: z.number().int().min(0).max(20).default(extra.margin ?? 1),
    })
    .prefault({});

export const notificationSettingsSchema = z.object({
  sound: z.boolean().default(true),
  vibration: z.boolean().default(true),
  /** 'chime' additionally plays a short in-app tone while the app is open. */
  soundType: z.enum(['default', 'chime']).default('default'),
  categories: z
    .object({
      classes: category(true, { offsets: [15] }),
      attendance: category(true, { offsets: [0] }),
      revision: category(true, { time: '08:00' }),
      tasks: category(true, { offsets: [60], time: '18:00' }),
      assignments: category(true, { offsets: [7 * 1440, 3 * 1440, 1440, 60], time: '23:59' }),
      exams: category(true, { offsets: [30 * 1440, 14 * 1440, 7 * 1440, 1440, 60], time: '09:00' }),
      studySessions: category(true, { offsets: [0] }),
      dailyReview: category(true, { time: '21:30' }),
      weeklyReview: category(true, { time: '19:00', weekday: 0 }),
      attendanceRisk: category(true, { time: '08:30', margin: 1 }),
      reminders: category(true),
      aiSuggestions: category(true, { time: '07:30' }),
      sync: category(false),
    })
    .prefault({}),
});
export type NotificationSettings = z.infer<typeof notificationSettingsSchema>;
export type NotificationCategory = keyof NotificationSettings['categories'];

/** Areas of the workspace AI Pilot can act on. Each has its own capabilities and an access level. */
export const AI_AREAS = ['profile', 'tasks', 'schedule', 'attendance', 'learning', 'exams', 'subjects', 'notes', 'settings', 'notifications'] as const;
export type AIArea = (typeof AI_AREAS)[number];

/**
 * Settings AI Pilot may never change, whatever permissions are granted.
 * Enforced in the action schema, server-side intent validation and the
 * client's write path (see guardAiSettingsPatch).
 */
export const AI_PROTECTED_SETTINGS = ['aiPower', 'aiPermissions'] as const;

/** What AI Pilot may read and do. Every capability is an explicit switch. */
export const aiPermissionsSchema = z.object({
  enabled: z.boolean().default(true),
  shareName: z.boolean().default(false),
  // Profile
  readProfile: z.boolean().default(true),
  updateProfile: z.boolean().default(true),
  // Todos
  readTasks: z.boolean().default(true),
  createTasks: z.boolean().default(true),
  modifyTasks: z.boolean().default(true),
  deleteTasks: z.boolean().default(true),
  // Schedule (calendar, timetable, reminders)
  readCalendar: z.boolean().default(true),
  createEvents: z.boolean().default(true),
  modifyEvents: z.boolean().default(true),
  deleteEvents: z.boolean().default(true),
  modifyClasses: z.boolean().default(true),
  createReminders: z.boolean().default(true),
  // Attendance
  readAttendance: z.boolean().default(true),
  modifyAttendance: z.boolean().default(true),
  // Learning (topics, revisions, flashcards)
  readRevision: z.boolean().default(true),
  createRevision: z.boolean().default(true),
  modifyRevision: z.boolean().default(true),
  deleteRevision: z.boolean().default(true),
  // Exams & assignments
  readExams: z.boolean().default(true),
  createExams: z.boolean().default(true),
  modifyExams: z.boolean().default(true),
  deleteExams: z.boolean().default(true),
  // Subjects
  manageSubjects: z.boolean().default(true),
  deleteSubjects: z.boolean().default(true),
  // Notes
  readNotes: z.boolean().default(false),
  createNotes: z.boolean().default(true),
  deleteNotes: z.boolean().default(true),
  // Settings & notifications (never AI Power or these permissions)
  readSettings: z.boolean().default(true),
  modifySettings: z.boolean().default(true),
  modifyNotifications: z.boolean().default(true),
  // Changes to many records at once
  bulkChanges: z.boolean().default(true),
  /**
   * Per area: 'ask' shows a confirmation card first; 'full' applies create/update
   * actions straight away (still logged and undoable). Deletions and bulk changes
   * always ask.
   */
  access: z
    .object(Object.fromEntries(AI_AREAS.map((a) => [a, z.enum(['ask', 'full']).default('ask')])) as Record<AIArea, z.ZodDefault<z.ZodEnum<{ ask: 'ask'; full: 'full' }>>>)
    .prefault({}),
  /** Read-only actions (quiz, open a page) run without an extra tap. */
  instantReadOnly: z.boolean().default(true),
});
export type AIPermissions = z.infer<typeof aiPermissionsSchema>;
export type AIPermission = Exclude<keyof AIPermissions, 'enabled' | 'shareName' | 'instantReadOnly' | 'access'>;

export const recurrenceSchema = z.object({
  freq: z.enum(['none', 'daily', 'weekdays', 'weekly', 'monthly', 'custom']).default('none'),
  /** Repeat every N units (custom: days; weekly/monthly: weeks/months). */
  interval: z.number().int().min(1).max(365).default(1),
  /** For weekly/custom-weekly: which weekdays (0 = Sunday). Empty = the start date's weekday. */
  weekdays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
  unit: z.enum(['day', 'week', 'month']).default('day'),
  until: isoDate.nullable().default(null),
});
export type Recurrence = z.infer<typeof recurrenceSchema>;

export const reminderSchema = syncMeta.extend({
  title: z.string().min(1).max(300),
  notes: optText(2000),
  /** First (or only) occurrence. */
  date: isoDate,
  time: hhmm,
  recurrence: recurrenceSchema.prefault({}),
  active: z.boolean().default(true),
  /** Dates whose occurrence was marked done/dismissed. */
  doneDates: z.array(isoDate).max(400).default([]),
  source: z.enum(['manual', 'ai']).default('manual'),
});
export type Reminder = z.infer<typeof reminderSchema>;

export const recordChangeSchema = z.object({
  entity: z.string().max(40),
  id: z.string().max(64),
  op: z.enum(['create', 'update', 'delete']),
  before: z.record(z.string(), z.unknown()).nullable(),
  after: z.record(z.string(), z.unknown()).nullable(),
});
export type RecordChange = z.infer<typeof recordChangeSchema>;

/** Audit trail of every AI-proposed action the student confirmed (or cancelled), with what it changed. */
export const aiActionLogSchema = syncMeta.extend({
  action: z.string().max(60),
  summary: z.string().max(500),
  details: z.array(z.string().max(500)).max(100).default([]),
  params: z.record(z.string(), z.unknown()).default({}),
  status: z.enum(['confirmed', 'cancelled', 'undone', 'failed']),
  changes: z.array(recordChangeSchema).max(500).default([]),
  executedAt: isoDateTime.nullable().default(null),
  undoneAt: isoDateTime.nullable().default(null),
  error: optText(500),
});
export type AIActionLog = z.infer<typeof aiActionLogSchema>;

export const settingsSchema = syncMeta.extend({
  profile: z
    .object({
      name: z.string().max(100).default(''),
      college: z.string().max(200).default(''),
      course: z.string().max(200).default(''),
      semester: z.string().max(50).default(''),
      academicYear: z.string().max(50).default(''),
      bio: z.string().max(500).default(''),
    })
    .prefault({}),
  workingDays: z.array(z.number().int().min(0).max(6)).default([1, 2, 3, 4, 5]),
  collegeStart: hhmm.default('09:00'),
  collegeEnd: hhmm.default('17:00'),
  semesterStart: isoDate.nullable().default(null),
  semesterEnd: isoDate.nullable().default(null),
  holidays: z.array(isoDate).default([]),
  minAttendance: percent.default(75),
  targetAttendance: percent.default(80),
  safeAttendance: percent.default(85),
  revisionIntervals: z.array(z.number().int().min(1).max(3650)).min(1).max(20).default([1, 3, 7, 30, 90, 180]),
  dailyStudyTargetMinutes: z.number().int().min(0).max(1440).default(240),
  /** When the student prefers to study. A planning preference, not a hard rule. */
  studyTimes: z.array(z.enum(['morning', 'afternoon', 'evening', 'night'])).max(4).default([]),
  /** Exact preferred study hours (e.g. 19:00–23:00), if the student set them. */
  studyWindow: z.object({ start: hhmm, end: hhmm }).nullable().default(null),
  /**
   * How hard AI Pilot works (model tier and context size). USER ONLY:
   * listed in AI_PROTECTED_SETTINGS, so AI Pilot can never change it.
   */
  aiPower: z.enum(['low', 'balanced', 'high', 'maximum']).default('balanced'),
  weekStartsOn: z.union([z.literal(0), z.literal(1)]).default(1),
  theme: z.enum(['system', 'light', 'dark']).default('system'),
  accent: z.string().max(20).default('indigo'),
  /** IANA timezone, used by the server to send push reminders at the right wall-clock time. */
  timezone: z.string().max(64).default('UTC'),
  notifications: notificationSettingsSchema.prefault({}),
  aiPermissions: aiPermissionsSchema.prefault({}),
  onboarded: z.boolean().default(false),
});
export type Settings = z.infer<typeof settingsSchema>;

/** Registry of synchronised entities. Order matters: parents before children. */
export const ENTITY_SCHEMAS = {
  settings: settingsSchema,
  subject: subjectSchema,
  classSchedule: classScheduleSchema,
  classInstance: classInstanceSchema,
  attendanceRecord: attendanceRecordSchema,
  topic: topicSchema,
  revisionSchedule: revisionScheduleSchema,
  task: taskSchema,
  calendarEvent: calendarEventSchema,
  studySession: studySessionSchema,
  exam: examSchema,
  assignment: assignmentSchema,
  note: noteSchema,
  flashcard: flashcardSchema,
  quizAttempt: quizAttemptSchema,
  dailyReview: dailyReviewSchema,
  reminder: reminderSchema,
  aiActionLog: aiActionLogSchema,
} as const;

export type EntityName = keyof typeof ENTITY_SCHEMAS;
export const ENTITY_NAMES = Object.keys(ENTITY_SCHEMAS) as EntityName[];

export type EntityMap = {
  [K in EntityName]: z.infer<(typeof ENTITY_SCHEMAS)[K]>;
};

// ---------------------------------------------------------------------------
// Sync protocol

export const syncOperationSchema = z.object({
  operationId: z.string().min(1).max(64),
  entity: z.enum(ENTITY_NAMES as [EntityName, ...EntityName[]]),
  entityId: z.string().min(1).max(64),
  operation: z.enum(['upsert', 'delete']),
  /** Full record snapshot (record-level last-write-wins). */
  payload: z.record(z.string(), z.unknown()),
  /** Server version the client based this change on. */
  baseVersion: z.number().int().min(0),
  timestamp: isoDateTime,
  deviceId: z.string().max(64),
});
export type SyncOperation = z.infer<typeof syncOperationSchema>;

export const syncRequestSchema = z.object({
  deviceId: z.string().min(1).max(64),
  cursor: z.string().max(40).nullable(),
  operations: z.array(syncOperationSchema).max(500),
});
export type SyncRequest = z.infer<typeof syncRequestSchema>;

export interface SyncOperationResult {
  operationId: string;
  status: 'applied' | 'conflict_won' | 'conflict_lost' | 'rejected';
  version?: number;
  error?: string;
}

export interface SyncResponse {
  results: SyncOperationResult[];
  changes: Array<{ entity: EntityName; record: Record<string, unknown> }>;
  cursor: string | null;
  hasMore: boolean;
  serverTime: string;
}

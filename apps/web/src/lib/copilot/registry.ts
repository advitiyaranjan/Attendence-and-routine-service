/**
 * Client half of the AI action registry: for every action, how to
 *   prepare → resolve targets against real data, check conflicts, build a
 *             human-readable proposal (or ask which record, or refuse)
 *   execute → apply it through the normal local-first write path
 *
 * Nothing in this file runs without the student confirming the proposal,
 * except read-only actions (navigate, quiz) which never modify data.
 */
import { v4 as uuid } from 'uuid';
import {
  ACTIONS,
  PROTECTED_SETTING_MESSAGE,
  protectedSettingsIn,
  addDays,
  describeRecurrence,
  diffDays,
  formatTime12,
  fmtPct,
  initialRevisions,
  localMomentNow,
  minutesToTime,
  overlaps,
  planNotifications,
  refOf,
  timeToMinutes,
  todayISO,
  weekdayOf,
  WEEKDAYS,
  type ActionKind,
  type ActionName,
  type Basket,
  type CalendarEvent,
  type ClassOccurrence,
  type ClassSchedule,
  type ClassTarget,
  type RevisionSchedule,
  type Settings,
  type Subject,
  type Task,
  overlapsSleep,
  sleepLabel,
} from '@student-os/core';
import { addExtraClass, learnTopic, markAttendance, nextSubjectColor, rescheduleClass } from '../actions';
import { flashcards as genFlashcards } from '../ai';
import { db } from '../db';
import { computeAttendance, loadPlannerData, loadSettings, occurrencesBetween } from '../queries';
import { create, createMany, remove, removeMany, update, saveSettings, sortBaskets } from '../repo';
import { REF } from './context';

// ---------------------------------------------------------------------------
// Types

export type FieldType = 'text' | 'date' | 'time' | 'number' | 'textarea' | 'priority';
export interface EditableField {
  path: string;
  label: string;
  type: FieldType;
}
export interface ProposalItem {
  key: string;
  label: string;
  selected: boolean;
  warning?: string;
}
export type ProposalStatus = 'pending' | 'confirmed' | 'cancelled' | 'superseded' | 'failed' | 'undone';

export interface Proposal {
  id: string;
  action: ActionName;
  params: Record<string, unknown>;
  resolved: Record<string, unknown>;
  title: string;
  heading: string;
  lines: string[];
  affects: string[];
  warnings: string[];
  items?: ProposalItem[];
  risk: ActionKind;
  bulk: boolean;
  confirmLabel: string;
  editable: EditableField[];
  status: ProposalStatus;
  result?: string;
  /** Applied without a confirmation tap because its area has "Full access". */
  autoApplied?: boolean;
  logId?: string;
  error?: string;
}

export interface ClarifyOption {
  label: string;
  action?: ActionName;
  params?: Record<string, unknown>;
  /** For AI clarifications: text to send as the student's reply. */
  send?: string;
}

export type Prepared =
  | { kind: 'proposal'; proposal: Proposal }
  | { kind: 'clarify'; question: string; options: ClarifyOption[] }
  | { kind: 'error'; message: string }
  | { kind: 'link'; message: string; href: string; label: string }
  | { kind: 'quiz'; topic: string; count: 5 | 10 | 20; difficulty: 'easy' | 'medium' | 'hard' | 'mixed' };

// ---------------------------------------------------------------------------
// Environment

/** Find a subject by exact name (another confirmed card may have just created it), else create it in `basket`. */
async function ensureSubject(name: string, basket: string | null): Promise<string> {
  const all = (await db.entity('subject').toArray()).filter((s) => !s.deletedAt);
  const hit = all.find((s) => s.name.trim().toLowerCase() === name.toLowerCase());
  if (hit) return hit.id;
  const palette = ['#2a78d6', '#eb6834', '#16a34a', '#9333ea', '#db2777', '#0891b2', '#ca8a04'];
  return (await create('subject', { name, color: palette[all.length % palette.length]!, ...(basket ? { basketId: await ensureBasket(basket) } : {}) })).id;
}

/** Find a basket by exact name (another confirmed card may have just created it), else create it. */
async function ensureBasket(name: string): Promise<string> {
  const all = (await db.entity('basket').toArray()).filter((b) => !b.deletedAt);
  const hit = all.find((b) => b.name.trim().toLowerCase() === name.toLowerCase());
  return hit ? hit.id : (await create('basket', { name, order: all.length })).id;
}

interface Env {
  settings: Settings;
  today: string;
  nowMinutes: number;
  subjects: Subject[];
  baskets: Basket[];
  occurrences(from: string, to: string): Promise<ClassOccurrence[]>;
}

async function loadEnv(): Promise<Env> {
  const settings = await loadSettings();
  const subjects = (await db.entity('subject').toArray()).filter((s) => !s.deletedAt);
  const baskets = sortBaskets((await db.entity('basket').toArray()).filter((b) => !b.deletedAt));
  return {
    settings,
    today: todayISO(),
    nowMinutes: localMomentNow().minutes,
    subjects,
    baskets,
    occurrences: (from, to) => occurrencesBetween(from, to, settings),
  };
}

// ---------------------------------------------------------------------------
// Formatting & matching helpers

export function dayLabel(date: string, today = todayISO()): string {
  const d = diffDays(today, date);
  const nice = new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  if (d === 0) return `Today (${nice})`;
  if (d === 1) return `Tomorrow (${nice})`;
  if (d === -1) return `Yesterday (${nice})`;
  return nice;
}

/** "today", "tomorrow", "yesterday" or "on Fri, 2 Oct" — for use inside sentences. */
export function dayWord(date: string, today = todayISO()): string {
  const d = diffDays(today, date);
  if (d === 0) return 'today';
  if (d === 1) return 'tomorrow';
  if (d === -1) return 'yesterday';
  return `on ${new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}`;
}

const range = (start: string, end: string | null) => (end ? `${formatTime12(start)} – ${formatTime12(end)}` : formatTime12(start));

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const initials = (s: string) =>
  norm(s)
    .split(' ')
    .filter((w) => !['and', 'of', 'the', 'for', '&'].includes(w))
    .map((w) => w[0])
    .join('');

const isSubsequence = (needle: string, hay: string) => {
  let i = 0;
  for (const ch of hay) if (ch === needle[i]) i++;
  return i === needle.length;
};

/**
 * Abbreviation match: "OS" → Operating Systems, "DBMS" → Database Management Systems.
 * Same first letter, every word initial appears in order, and the abbreviation's
 * letters appear in order in the name.
 */
function isAbbreviation(q: string, name: string): boolean {
  if (!/^[a-z]{2,8}$/.test(q)) return false;
  const letters = norm(name).replace(/ /g, '');
  const init = initials(name);
  return q === init || (q[0] === letters[0] && init.length >= 2 && isSubsequence(init, q) && isSubsequence(q, letters));
}

/** Subjects matching a name, code or abbreviation (e.g. "OS", "DBMS"). */
export function findSubjects(name: string | null | undefined, subjects: Subject[]): Subject[] {
  if (!name) return [];
  const q = norm(name);
  const exact = subjects.filter((s) => norm(s.name) === q || (s.code && norm(s.code) === q) || isAbbreviation(q.replace(/ /g, ''), s.name));
  if (exact.length) return exact;
  return subjects.filter((s) => norm(s.name).includes(q) || (q.length > 3 && q.includes(norm(s.name))));
}

function titleMatches<T extends { title: string }>(query: string | null | undefined, rows: T[]): T[] {
  if (!query) return [];
  const q = norm(query);
  const exact = rows.filter((r) => norm(r.title) === q);
  if (exact.length) return exact;
  const words = q.split(' ').filter((w) => w.length > 2);
  return rows.filter((r) => {
    const t = norm(r.title);
    if (t.includes(q) || q.includes(t)) return true;
    const hit = words.filter((w) => t.includes(w)).length;
    return words.length > 0 && hit / words.length >= 0.6;
  });
}

function withRef(params: Record<string, unknown>, ref: string): Record<string, unknown> {
  return { ...params, target: { ...(params.target as object), ref } };
}

/** Nothing may be scheduled during the student's sleep time. */
function sleepConflict(env: Env, start: string, end: string): string | null {
  const sleep = env.settings.sleepWindow;
  return overlapsSleep(start, end, sleep) ? `That's during your sleep time (${sleepLabel(sleep)}). Pick a time outside it, or change sleep time in Settings → Study & revision.` : null;
}

async function conflictsAt(env: Env, date: string, start: string, end: string, excludeIds: string[] = []): Promise<string[]> {
  const out: string[] = [];
  const classes = await env.occurrences(date, date);
  for (const c of classes) {
    if (excludeIds.includes(c.id) || c.status === 'cancelled' || c.status === 'rescheduled') continue;
    if (overlaps({ startTime: start, endTime: end }, c)) {
      out.push(`Clashes with your ${env.subjects.find((s) => s.id === c.subjectId)?.name ?? ''} class ${range(c.startTime, c.endTime)}`);
    }
  }
  const events = (await db.entity('calendarEvent').where('date').equals(date).toArray()).filter((e) => !e.deletedAt && e.startTime && e.endTime && !excludeIds.includes(e.id));
  for (const e of events) {
    if (overlaps({ startTime: start, endTime: end }, { startTime: e.startTime!, endTime: e.endTime! })) out.push(`Overlaps "${e.title}" ${range(e.startTime!, e.endTime)}`);
  }
  return out;
}

function proposal(action: ActionName, params: Record<string, unknown>, p: Partial<Proposal> & Pick<Proposal, 'title' | 'lines'>): Prepared {
  const def = ACTIONS[action];
  return {
    kind: 'proposal',
    proposal: {
      id: uuid(),
      action,
      params,
      resolved: {},
      heading: '',
      affects: def.affects ?? [],
      warnings: [],
      risk: def.kind,
      bulk: !!def.bulk,
      confirmLabel: def.kind === 'delete' ? 'Confirm delete' : def.bulk ? 'Confirm all' : 'Confirm',
      editable: [],
      status: 'pending',
      ...p,
    },
  };
}

const err = (message: string): Prepared => ({ kind: 'error', message });

// ---------------------------------------------------------------------------
// Target resolution

async function resolveClass(env: Env, target: ClassTarget, params: Record<string, unknown>, action: ActionName): Promise<{ occ: ClassOccurrence } | Prepared> {
  const from = target.date ?? (target.ref ? addDays(env.today, -14) : env.today);
  const to = target.date ?? (target.ref ? addDays(env.today, 30) : env.today);
  let list = (await env.occurrences(from, to)).filter((o) => o.status !== 'rescheduled');
  const subjectName = (o: ClassOccurrence) => env.subjects.find((s) => s.id === o.subjectId)?.name ?? 'Class';

  if (target.ref) {
    const hit = list.find((o) => refOf(REF.class, o.id) === target.ref);
    if (hit) return { occ: hit };
  }
  if (target.subject) {
    const subjects = findSubjects(target.subject, env.subjects);
    if (!subjects.length) return err(`You don't have a subject called "${target.subject}".`);
    list = list.filter((o) => subjects.some((s) => s.id === o.subjectId));
  }
  if (target.time) list = list.filter((o) => o.startTime === target.time || (timeToMinutes(o.startTime) <= timeToMinutes(target.time!) && timeToMinutes(target.time!) < timeToMinutes(o.endTime)));

  const when = target.date ? dayWord(target.date, env.today) : 'today';
  if (list.length === 0) return err(`I couldn't find ${target.subject ? `a ${target.subject} class` : 'that class'} ${when}${target.time ? ` at ${formatTime12(target.time)}` : ''}. I won't guess.`);
  if (list.length > 1) {
    return {
      kind: 'clarify',
      question: `I found ${list.length} ${target.subject ?? ''} classes ${when}. Which one?`.replace(/\s+/g, ' '),
      options: list.slice(0, 8).map((o) => ({ label: `${subjectName(o)} — ${o.date === env.today ? '' : `${dayLabel(o.date, env.today)}, `}${range(o.startTime, o.endTime)}`, action, params: withRef(params, refOf(REF.class, o.id)) })),
    };
  }
  return { occ: list[0]! };
}

async function resolveByTitle<T extends { id: string; title: string }>(
  rows: T[],
  prefix: string,
  target: { ref?: string | null; title?: string | null },
  params: Record<string, unknown>,
  action: ActionName,
  noun: string,
  describe: (r: T) => string,
): Promise<{ row: T } | Prepared> {
  if (target.ref) {
    const hit = rows.find((r) => refOf(prefix, r.id) === target.ref);
    if (hit) return { row: hit };
  }
  const matches = titleMatches(target.title, rows);
  if (!matches.length) return err(`I couldn't find a ${noun}${target.title ? ` matching "${target.title}"` : ''}.`);
  if (matches.length > 1) {
    return {
      kind: 'clarify',
      question: `Which ${noun} do you mean?`,
      options: matches.slice(0, 8).map((r) => ({ label: describe(r), action, params: withRef(params, refOf(prefix, r.id)) })),
    };
  }
  return { row: matches[0]! };
}

const isPrepared = (x: unknown): x is Prepared => !!x && typeof x === 'object' && 'kind' in x;

async function openTasks() {
  return (await db.entity('task').toArray()).filter((t) => !t.deletedAt && t.status !== 'done');
}

async function subjectAttendance(env: Env, subjectId: string) {
  const att = await computeAttendance(env.settings, env.today);
  return att.subjects.find((s) => s.subject.id === subjectId)?.summary ?? null;
}

/** When will the planner first remind about this entity? e.g. "tomorrow at 6:00 PM". */
async function firstReminder(entityId: string): Promise<string | null> {
  const data = await loadPlannerData();
  const now = localMomentNow();
  const next = planNotifications(data, now, 0, 60 * 24 * 60).find((n) => n.entityId === entityId);
  if (!next) return null;
  return `${dayWord(next.date)} at ${formatTime12(next.time)}`;
}

const EVENT_TYPE = (t: string): CalendarEvent['type'] => (t === 'personal' || t === 'break' ? 'personal' : t === 'event' ? 'event' : 'study');

function subjectLine(env: Env, name: string | null | undefined, warnings: string[]): string | null {
  if (!name) return null;
  const s = findSubjects(name, env.subjects)[0];
  if (!s) warnings.push(`No subject called "${name}" — it won't be linked to a subject.`);
  return s?.id ?? null;
}

// ---------------------------------------------------------------------------
// Handlers

type Handler = {
  prepare(params: Record<string, unknown>, env: Env): Promise<Prepared>;
  execute(p: Proposal, env: Env): Promise<string>;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
const H: Record<ActionName, Handler> = {
  create_task: {
    async prepare(params: any, env) {
      const warnings: string[] = [];
      const subjectId = subjectLine(env, params.subject, warnings);
      return proposal('create_task', params, {
        title: 'Create task',
        heading: params.title,
        lines: [
          params.dueDate ? `Deadline: ${dayLabel(params.dueDate, env.today)}${params.dueTime ? `, ${formatTime12(params.dueTime)}` : ''}` : 'No deadline',
          `Priority: ${params.priority}`,
          ...(params.estimatedMinutes ? [`Estimated time: ${params.estimatedMinutes >= 60 ? `${+(params.estimatedMinutes / 60).toFixed(1)} h` : `${params.estimatedMinutes} min`}`] : []),
          ...(subjectId ? [`Subject: ${env.subjects.find((s) => s.id === subjectId)!.name}`] : []),
        ],
        warnings,
        resolved: { subjectId },
        editable: [
          { path: 'title', label: 'Title', type: 'text' },
          { path: 'dueDate', label: 'Deadline', type: 'date' },
          { path: 'dueTime', label: 'Time', type: 'time' },
          { path: 'priority', label: 'Priority', type: 'priority' },
          { path: 'estimatedMinutes', label: 'Minutes', type: 'number' },
        ],
      });
    },
    async execute(p) {
      const x = p.params as any;
      const task = await create('task', {
        title: x.title,
        dueDate: x.dueDate,
        dueTime: x.dueTime,
        plannedDate: x.dueDate,
        priority: x.priority,
        estimatedMinutes: x.estimatedMinutes,
        category: x.category ?? 'Study',
        subjectId: (p.resolved.subjectId as string | null) ?? null,
        source: 'ai',
      });
      const when = await firstReminder(task.id);
      return `✓ Task created${when ? ` · Reminder: ${when}` : ''}`;
    },
  },

  update_task: {
    async prepare(params: any, env) {
      const r = await resolveByTitle(await openTasks(), REF.task, params.target, params, 'update_task', 'task', (t) => `${t.title}${t.dueDate ? ` (due ${t.dueDate})` : ''}`);
      if (isPrepared(r)) return r;
      const t = r.row as Task;
      const c = params.changes;
      const lines: string[] = [];
      const diff = (label: string, a: unknown, b: unknown) => b !== null && b !== undefined && a !== b && lines.push(`${label}: ${a ?? '—'} → ${b}`);
      diff('Title', t.title, c.title);
      diff('Deadline', t.dueDate, c.dueDate);
      diff('Time', t.dueTime, c.dueTime);
      diff('Planned for', t.plannedDate, c.plannedDate);
      diff('Priority', t.priority, c.priority);
      diff('Estimate (min)', t.estimatedMinutes, c.estimatedMinutes);
      if (!lines.length) return err(`"${t.title}" already looks like that — nothing to change.`);
      return proposal('update_task', params, { title: 'Update task', heading: t.title, lines, resolved: { taskId: t.id } });
    },
    async execute(p) {
      const c = (p.params as any).changes;
      const patch = Object.fromEntries(Object.entries(c).filter(([, v]) => v !== null && v !== undefined));
      await update('task', p.resolved.taskId as string, patch);
      return '✓ Task updated';
    },
  },

  complete_task: {
    async prepare(params: any) {
      const r = await resolveByTitle(await openTasks(), REF.task, params.target, params, 'complete_task', 'task', (t) => t.title);
      if (isPrepared(r)) return r;
      return proposal('complete_task', params, { title: 'Mark task as done', heading: r.row.title, lines: [], resolved: { taskId: r.row.id } });
    },
    async execute(p) {
      await update('task', p.resolved.taskId as string, { status: 'done', completedAt: new Date().toISOString() });
      return '✓ Task completed';
    },
  },

  delete_task: {
    async prepare(params: any) {
      const all = (await db.entity('task').toArray()).filter((t) => !t.deletedAt);
      const r = await resolveByTitle(all, REF.task, params.target, params, 'delete_task', 'task', (t) => t.title);
      if (isPrepared(r)) return r;
      return proposal('delete_task', params, { title: 'Delete task', heading: r.row.title, lines: ['This removes the task from every device.'], resolved: { taskId: r.row.id } });
    },
    async execute(p) {
      await remove('task', p.resolved.taskId as string);
      return '✓ Task deleted';
    },
  },

  create_class: {
    async prepare(params: any, env) {
      const found = findSubjects(params.subject, env.subjects)[0];
      if (!found && !env.settings.aiPermissions.manageSubjects) return err(`You don't have a subject called "${params.subject}", and AI Pilot isn't allowed to add subjects. Add it on the Subjects page, or allow it in Settings → AI Pilot.`);
      if (params.startTime >= params.endTime) return err('The class must end after it starts.');
      const subject = found ?? { id: '', name: String(params.subject).trim() };
      const newSubject = found ? undefined : subject.name;
      if (newSubject && !params.basket) return askBasket(env, newSubject, 'create_class', params);
      const basket = newSubject ? basketLabel(env, params.basket) : null;
      const warnings: string[] = newSubject ? [`Also adds the new subject “${newSubject}” to ${basket}`] : [];
      if (params.recurring) {
        const weekday = params.weekday ?? weekdayOf(params.date);
        const slots = (await db.entity('classSchedule').toArray()).filter((s) => !s.deletedAt && s.active && s.weekday === weekday && (!s.validUntil || s.validUntil >= env.today));
        for (const s of slots) if (overlaps({ startTime: params.startTime, endTime: params.endTime }, s)) warnings.push(`Clashes with ${env.subjects.find((x) => x.id === s.subjectId)?.name} every ${WEEKDAYS[weekday]} ${range(s.startTime, s.endTime)}`);
        return proposal('create_class', params, {
          title: 'Add weekly class',
          heading: subject.name,
          lines: [`Every ${WEEKDAYS[weekday]![0]!.toUpperCase()}${WEEKDAYS[weekday]!.slice(1)}`, range(params.startTime, params.endTime), ...(params.room ? [`Room ${params.room}`] : []), 'Starts from today'],
          warnings,
          resolved: { subjectId: subject.id, weekday, newSubject },
          confirmLabel: warnings.length > (newSubject ? 1 : 0) ? 'Add anyway' : 'Confirm',
          editable: [
            { path: 'startTime', label: 'Start', type: 'time' },
            { path: 'endTime', label: 'End', type: 'time' },
            { path: 'room', label: 'Room', type: 'text' },
          ],
        });
      }
      warnings.push(...(await conflictsAt(env, params.date, params.startTime, params.endTime)));
      return proposal('create_class', params, {
        title: 'Add extra class',
        heading: subject.name,
        lines: [dayLabel(params.date, env.today), range(params.startTime, params.endTime), ...(params.room ? [`Room ${params.room}`] : [])],
        warnings,
        resolved: { subjectId: subject.id, newSubject },
        confirmLabel: warnings.length > (newSubject ? 1 : 0) ? 'Add anyway' : 'Confirm',
        editable: [
          { path: 'date', label: 'Date', type: 'date' },
          { path: 'startTime', label: 'Start', type: 'time' },
          { path: 'endTime', label: 'End', type: 'time' },
          { path: 'room', label: 'Room', type: 'text' },
        ],
      });
    },
    async execute(p, env) {
      const x = p.params as any;
      if (p.resolved.newSubject) p.resolved.subjectId = await ensureSubject(p.resolved.newSubject as string, x.basket);
      if (x.recurring) {
        await create('classSchedule', { subjectId: p.resolved.subjectId as string, weekday: p.resolved.weekday as number, startTime: x.startTime, endTime: x.endTime, room: x.room, validFrom: env.today });
        return '✓ Weekly class added to your timetable';
      }
      await addExtraClass(p.resolved.subjectId as string, x.date, x.startTime, x.endTime, x.room);
      return '✓ Class added';
    },
  },

  cancel_class: {
    async prepare(params: any, env) {
      const r = await resolveClass(env, params.target, params, 'cancel_class');
      if (isPrepared(r)) return r;
      const o = r.occ;
      if (o.status === 'cancelled') return err('That class is already marked as cancelled.');
      return proposal('cancel_class', params, {
        title: 'Cancel class',
        heading: env.subjects.find((s) => s.id === o.subjectId)?.name ?? 'Class',
        lines: [dayLabel(o.date, env.today), range(o.startTime, o.endTime), "It won't count towards attendance."],
        resolved: { occurrence: o },
      });
    },
    async execute(p) {
      await markAttendance(p.resolved.occurrence as ClassOccurrence, 'cancelled');
      return '✓ Class marked as cancelled';
    },
  },

  reschedule_class: {
    async prepare(params: any, env) {
      const r = await resolveClass(env, params.target, params, 'reschedule_class');
      if (isPrepared(r)) return r;
      const o = r.occ;
      const date = params.newDate ?? o.date;
      const start = params.newStartTime ?? o.startTime;
      const duration = timeToMinutes(o.endTime) - timeToMinutes(o.startTime);
      const end = params.newEndTime ?? minutesToTime(timeToMinutes(start) + duration);
      if (start >= end) return err('The new end time must be after the start time.');
      const warnings = await conflictsAt(env, date, start, end, [o.id]);
      const name = env.subjects.find((s) => s.id === o.subjectId)?.name ?? 'Class';
      return proposal('reschedule_class', params, {
        title: 'Confirm change',
        heading: name,
        lines: [
          date === o.date ? dayLabel(o.date, env.today) : `${dayLabel(o.date, env.today)} → ${dayLabel(date, env.today)}`,
          `${range(o.startTime, o.endTime)} → ${range(start, end)}`,
        ],
        warnings,
        resolved: { occurrence: o, date, start, end },
        confirmLabel: warnings.length ? 'Move anyway' : 'Confirm',
        editable: [
          { path: 'newDate', label: 'New date', type: 'date' },
          { path: 'newStartTime', label: 'New start', type: 'time' },
          { path: 'newEndTime', label: 'New end', type: 'time' },
        ],
      });
    },
    async execute(p) {
      const r = p.resolved as { occurrence: ClassOccurrence; date: string; start: string; end: string };
      await rescheduleClass(r.occurrence, r.date, r.start, r.end, null);
      return '✓ Class moved — calendar, reminders and attendance updated';
    },
  },

  mark_attendance: {
    async prepare(params: any, env) {
      const r = await resolveClass(env, params.target, params, 'mark_attendance');
      if (isPrepared(r)) return r;
      const o = r.occ;
      const started = o.date < env.today || (o.date === env.today && env.nowMinutes >= timeToMinutes(o.startTime));
      if (!started && params.status !== 'cancelled') return err("That class hasn't started yet, so I can't record attendance for it.");
      if (o.status === params.status) return err(`It's already marked ${params.status}.`);
      const name = env.subjects.find((s) => s.id === o.subjectId)?.name ?? 'Class';
      const s = await subjectAttendance(env, o.subjectId);
      let preview: string | null = null;
      if (s) {
        let present = s.present;
        let conducted = s.conducted;
        if (o.status === 'present') (present--, conducted--);
        if (o.status === 'absent') conducted--;
        if (params.status === 'present') (present++, conducted++);
        if (params.status === 'absent') conducted++;
        const after = fmtPct(conducted ? (present / conducted) * 100 : null);
        preview = s.percent === null ? `${name} attendance: ${after} (first class recorded)` : `${name} attendance: ${fmtPct(s.percent)} → ${after}`;
      }
      return proposal('mark_attendance', params, {
        title: `Mark attendance as ${String(params.status).toUpperCase()}?`,
        heading: name,
        lines: [dayLabel(o.date, env.today), range(o.startTime, o.endTime), ...(o.status ? [`Currently: ${o.status}`] : []), ...(preview ? [preview] : [])],
        resolved: { occurrence: o, before: s?.percent ?? null },
      });
    },
    async execute(p, env) {
      const o = p.resolved.occurrence as ClassOccurrence;
      await markAttendance(o, (p.params as any).status);
      const after = await subjectAttendance(env, o.subjectId);
      const name = env.subjects.find((s) => s.id === o.subjectId)?.name ?? 'Class';
      const before = p.resolved.before as number | null;
      return `✓ Attendance recorded · ${name}: ${before === null ? '' : `${fmtPct(before)} → `}${fmtPct(after?.percent ?? null)}`;
    },
  },

  create_event: {
    async prepare(params: any, env) {
      if (params.startTime >= params.endTime) return err('The session must end after it starts.');
      const asleep = sleepConflict(env, params.startTime, params.endTime);
      if (asleep) return err(asleep);
      const warnings = await conflictsAt(env, params.date, params.startTime, params.endTime);
      const subjectId = subjectLine(env, params.subject, warnings);
      return proposal('create_event', params, {
        title: params.type === 'study' || params.type === 'practice' || params.type === 'revision' ? 'Suggested study session' : 'Add to calendar',
        heading: params.title,
        lines: [`${dayLabel(params.date, env.today)}`, range(params.startTime, params.endTime), ...(warnings.length ? [] : ['No existing conflicts found.'])],
        warnings,
        resolved: { subjectId },
        confirmLabel: warnings.length ? 'Schedule anyway' : 'Add to calendar',
        editable: [
          { path: 'title', label: 'Title', type: 'text' },
          { path: 'date', label: 'Date', type: 'date' },
          { path: 'startTime', label: 'Start', type: 'time' },
          { path: 'endTime', label: 'End', type: 'time' },
        ],
      });
    },
    async execute(p) {
      const x = p.params as any;
      const ev = await create('calendarEvent', { title: x.title, type: EVENT_TYPE(x.type), date: x.date, startTime: x.startTime, endTime: x.endTime, subjectId: (p.resolved.subjectId as string) ?? null, source: 'ai' });
      const when = await firstReminder(ev.id);
      return `✓ Added to your calendar${when ? ` · I'll remind you ${when}` : ''}`;
    },
  },

  create_events: {
    async prepare(params: any, env) {
      const items: ProposalItem[] = [];
      for (const [i, e] of (params.events as any[]).entries()) {
        const clash = e.startTime < e.endTime ? (sleepConflict(env, e.startTime, e.endTime) ? `During sleep time (${sleepLabel(env.settings.sleepWindow)})` : (await conflictsAt(env, e.date, e.startTime, e.endTime))[0]) : 'Invalid time range';
        items.push({ key: String(i), label: `${e.date === env.today ? '' : `${dayLabel(e.date, env.today)} · `}${range(e.startTime, e.endTime)} — ${e.title}`, selected: !clash, warning: clash });
      }
      return proposal('create_events', params, {
        title: params.summary || 'Proposed plan',
        heading: `${items.length} session${items.length === 1 ? '' : 's'}`,
        lines: [],
        items,
        warnings: items.some((i) => i.warning) ? ['Sessions with clashes are unticked. Tick them to schedule anyway.'] : [],
        confirmLabel: 'Confirm all',
      });
    },
    async execute(p, env) {
      const events = (p.params as any).events as any[];
      const chosen = (p.items ?? []).filter((i) => i.selected).map((i) => events[Number(i.key)]);
      await createMany(
        'calendarEvent',
        chosen.map((e) => ({ title: e.title, type: EVENT_TYPE(e.type), date: e.date, startTime: e.startTime, endTime: e.endTime, subjectId: findSubjects(e.subject, env.subjects)[0]?.id ?? null, source: 'ai' as const })),
      );
      return `✓ Plan added (${chosen.length} session${chosen.length === 1 ? '' : 's'}) · I'll remind you before each session.`;
    },
  },

  update_event: {
    async prepare(params: any, env) {
      let events = (await db.entity('calendarEvent').toArray()).filter((e) => !e.deletedAt);
      if (params.target.date) events = events.filter((e) => e.date === params.target.date);
      const r = await resolveByTitle(events, REF.event, params.target, params, 'update_event', 'calendar event', (e) => `${e.title} — ${dayLabel(e.date, env.today)}${e.startTime ? ` ${formatTime12(e.startTime)}` : ''}`);
      if (isPrepared(r)) return r;
      const e = r.row as CalendarEvent;
      const c = params.changes;
      const date = c.date ?? e.date;
      let start = c.startTime ?? e.startTime;
      let end = c.endTime ?? e.endTime;
      // Keep the duration when only the start moves.
      if (c.startTime && !c.endTime && e.startTime && e.endTime) end = minutesToTime(timeToMinutes(c.startTime) + timeToMinutes(e.endTime) - timeToMinutes(e.startTime));
      if (start && end && start >= end) return err('The new end time must be after the start time.');
      const asleep = start && end ? sleepConflict(env, start, end) : null;
      if (asleep) return err(asleep);
      const warnings = start && end ? await conflictsAt(env, date, start, end, [e.id]) : [];
      const lines = [
        ...(c.title && c.title !== e.title ? [`Title: ${e.title} → ${c.title}`] : []),
        ...(date !== e.date ? [`${dayLabel(e.date, env.today)} → ${dayLabel(date, env.today)}`] : [dayLabel(date, env.today)]),
        ...(start !== e.startTime || end !== e.endTime ? [`${e.startTime ? range(e.startTime, e.endTime) : 'Any time'} → ${start ? range(start, end) : 'Any time'}`] : []),
      ];
      start ??= null;
      return proposal('update_event', params, {
        title: 'Confirm change',
        heading: e.title,
        lines,
        warnings,
        resolved: { eventId: e.id, patch: { title: c.title ?? e.title, date, startTime: start, endTime: end } },
        confirmLabel: warnings.length ? 'Move anyway' : 'Confirm',
      });
    },
    async execute(p) {
      await update('calendarEvent', p.resolved.eventId as string, p.resolved.patch as Partial<CalendarEvent>);
      return '✓ Calendar updated';
    },
  },

  delete_event: {
    async prepare(params: any, env) {
      let events = (await db.entity('calendarEvent').toArray()).filter((e) => !e.deletedAt);
      if (params.target.date) events = events.filter((e) => e.date === params.target.date);
      const r = await resolveByTitle(events, REF.event, params.target, params, 'delete_event', 'calendar event', (e) => `${e.title} — ${dayLabel(e.date, env.today)}`);
      if (isPrepared(r)) return r;
      const e = r.row as CalendarEvent;
      return proposal('delete_event', params, { title: 'Delete calendar event', heading: e.title, lines: [`${dayLabel(e.date, env.today)}${e.startTime ? `, ${range(e.startTime, e.endTime)}` : ''}`], resolved: { eventId: e.id } });
    },
    async execute(p) {
      await remove('calendarEvent', p.resolved.eventId as string);
      return '✓ Event deleted';
    },
  },

  create_topic: {
    async prepare(params: any, env) {
      const warnings: string[] = [];
      const subjectId = subjectLine(env, params.subject, warnings);
      const learnedOn = params.learnedOn ?? env.today;
      const plan = initialRevisions(learnedOn, env.settings.revisionIntervals);
      return proposal('create_topic', params, {
        title: 'New learning record',
        heading: params.title,
        lines: [
          ...(subjectId ? [`Subject: ${env.subjects.find((s) => s.id === subjectId)!.name}`] : []),
          `Learned: ${dayLabel(learnedOn, env.today)}`,
          `Revision schedule: ${plan.map((x) => new Date(`${x.dueDate}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })).join(' · ')}`,
        ],
        warnings,
        resolved: { subjectId, learnedOn },
        editable: [
          { path: 'title', label: 'Topic', type: 'text' },
          { path: 'learnedOn', label: 'Learned on', type: 'date' },
        ],
      });
    },
    async execute(p) {
      const { plan } = await learnTopic({ title: (p.params as any).title, subjectId: (p.resolved.subjectId as string) ?? null, learnedOn: p.resolved.learnedOn as string });
      return `✓ Topic added with ${plan.length} revision sessions`;
    },
  },

  update_revision: {
    async prepare(params: any, env) {
      const [revs, topics] = await Promise.all([db.entity('revisionSchedule').toArray(), db.entity('topic').toArray()]);
      const topicTitle = new Map(topics.filter((t) => !t.deletedAt).map((t) => [t.id, t.title]));
      let pending = revs.filter((r) => !r.deletedAt && r.status === 'pending' && topicTitle.has(r.topicId)).map((r) => ({ ...r, title: topicTitle.get(r.topicId)! }));
      if (params.target.date) pending = pending.filter((r) => r.dueDate === params.target.date);
      const r = await resolveByTitle(pending, REF.revision, { ref: params.target.ref, title: params.target.topic }, params, 'update_revision', 'revision', (x) => `${x.title} — due ${x.dueDate}`);
      if (isPrepared(r)) return r;
      return proposal('update_revision', params, {
        title: 'Move revision',
        heading: r.row.title,
        lines: [`${dayLabel(r.row.dueDate, env.today)} → ${dayLabel(params.newDate, env.today)}`],
        resolved: { revisionId: r.row.id },
        editable: [{ path: 'newDate', label: 'New date', type: 'date' }],
      });
    },
    async execute(p) {
      await update('revisionSchedule', p.resolved.revisionId as string, { dueDate: (p.params as any).newDate });
      return '✓ Revision moved';
    },
  },

  move_revisions: {
    async prepare(params: any, env) {
      const list = await matchingRevisions(env, { subject: params.subject, fromDate: params.fromDate, toDate: params.fromDate });
      if (isPrepared(list)) return list;
      if (!list.length) return err(`No pending revisions are due ${dayWord(params.fromDate, env.today)}${params.subject ? ` for ${params.subject}` : ''}.`);
      return proposal('move_revisions', params, {
        title: `${list.length} revision session${list.length === 1 ? '' : 's'} will be moved`,
        heading: `${dayLabel(params.fromDate, env.today)} → ${dayLabel(params.toDate, env.today)}`,
        lines: [],
        items: list.map((r) => ({ key: r.id, label: r.label, selected: true })),
        editable: [{ path: 'toDate', label: 'Move to', type: 'date' }],
      });
    },
    async execute(p) {
      const chosen = (p.items ?? []).filter((i) => i.selected);
      for (const i of chosen) await update('revisionSchedule', i.key, { dueDate: (p.params as any).toDate });
      return `✓ Moved ${chosen.length} revision session${chosen.length === 1 ? '' : 's'}`;
    },
  },

  delete_revisions: {
    async prepare(params: any, env) {
      const list = await matchingRevisions(env, params);
      if (isPrepared(list)) return list;
      if (!list.length) return err('No pending revisions match that.');
      return proposal('delete_revisions', params, {
        title: `This will delete ${list.length} revision event${list.length === 1 ? '' : 's'}`,
        heading: [params.subject, params.topic].filter(Boolean).join(' · ') || 'Revisions',
        lines: [],
        items: list.map((r) => ({ key: r.id, label: r.label, selected: true })),
      });
    },
    async execute(p) {
      const ids = (p.items ?? []).filter((i) => i.selected).map((i) => i.key);
      await removeMany('revisionSchedule', ids);
      return `✓ Deleted ${ids.length} revision session${ids.length === 1 ? '' : 's'}`;
    },
  },

  create_exam: {
    async prepare(params: any, env) {
      const warnings: string[] = [];
      const subjectId = subjectLine(env, params.subject, warnings);
      return proposal('create_exam', params, {
        title: 'Add exam',
        heading: params.title,
        lines: [`${dayLabel(params.date, env.today)}${params.startTime ? `, ${formatTime12(params.startTime)}` : ''}`, `${diffDays(env.today, params.date)} days from today`, ...(params.room ? [`Room ${params.room}`] : [])],
        warnings,
        resolved: { subjectId },
        editable: [
          { path: 'title', label: 'Title', type: 'text' },
          { path: 'date', label: 'Date', type: 'date' },
          { path: 'startTime', label: 'Time', type: 'time' },
        ],
      });
    },
    async execute(p) {
      const x = p.params as any;
      await create('exam', { title: x.title, date: x.date, startTime: x.startTime, room: x.room, kind: x.kind, subjectId: (p.resolved.subjectId as string) ?? null });
      return "✓ Exam added · I'll remind you 30, 14, 7 and 1 day(s) before (per your settings)";
    },
  },

  update_exam: {
    async prepare(params: any, env) {
      const exams = (await db.entity('exam').toArray()).filter((e) => !e.deletedAt);
      const r = await resolveByTitle(exams, REF.exam, { ref: params.target.ref, title: params.target.title ?? params.target.subject }, params, 'update_exam', 'exam', (e) => `${e.title} — ${e.date}`);
      if (isPrepared(r)) return r;
      const c = params.changes;
      const lines = [
        ...(c.title && c.title !== r.row.title ? [`Title: ${r.row.title} → ${c.title}`] : []),
        ...(c.date && c.date !== r.row.date ? [`Date: ${dayLabel(r.row.date, env.today)} → ${dayLabel(c.date, env.today)}`] : []),
        ...(c.startTime && c.startTime !== r.row.startTime ? [`Time: ${r.row.startTime ?? '—'} → ${c.startTime}`] : []),
        ...(c.room && c.room !== r.row.room ? [`Room: ${r.row.room ?? '—'} → ${c.room}`] : []),
      ];
      if (!lines.length) return err('Nothing to change.');
      return proposal('update_exam', params, { title: 'Update exam', heading: r.row.title, lines, resolved: { examId: r.row.id } });
    },
    async execute(p) {
      const c = (p.params as any).changes;
      await update('exam', p.resolved.examId as string, Object.fromEntries(Object.entries(c).filter(([, v]) => v !== null && v !== undefined)));
      return '✓ Exam updated · reminders rescheduled';
    },
  },

  create_assignment: {
    async prepare(params: any, env) {
      const warnings: string[] = [];
      const subjectId = subjectLine(env, params.subject, warnings);
      return proposal('create_assignment', params, {
        title: 'Add assignment',
        heading: params.title,
        lines: [`Deadline: ${dayLabel(params.deadline, env.today)}${params.deadlineTime ? `, ${formatTime12(params.deadlineTime)}` : ''}`, `Priority: ${params.priority}`],
        warnings,
        resolved: { subjectId },
        editable: [
          { path: 'title', label: 'Title', type: 'text' },
          { path: 'deadline', label: 'Deadline', type: 'date' },
          { path: 'deadlineTime', label: 'Time', type: 'time' },
        ],
      });
    },
    async execute(p) {
      const x = p.params as any;
      const a = await create('assignment', { title: x.title, deadline: x.deadline, deadlineTime: x.deadlineTime, priority: x.priority, subjectId: (p.resolved.subjectId as string) ?? null });
      const when = await firstReminder(a.id);
      return `✓ Assignment added${when ? ` · First reminder ${when}` : ''}`;
    },
  },

  update_assignment: {
    async prepare(params: any, env) {
      const rows = (await db.entity('assignment').toArray()).filter((a) => !a.deletedAt);
      const r = await resolveByTitle(rows, REF.assignment, params.target, params, 'update_assignment', 'assignment', (a) => `${a.title} — due ${a.deadline}`);
      if (isPrepared(r)) return r;
      const c = params.changes;
      const lines = [
        ...(c.title && c.title !== r.row.title ? [`Title: ${r.row.title} → ${c.title}`] : []),
        ...(c.deadline && c.deadline !== r.row.deadline ? [`Deadline: ${dayLabel(r.row.deadline, env.today)} → ${dayLabel(c.deadline, env.today)}`] : []),
        ...(c.deadlineTime && c.deadlineTime !== r.row.deadlineTime ? [`Time: ${r.row.deadlineTime ?? '—'} → ${c.deadlineTime}`] : []),
        ...(c.status && c.status !== r.row.status ? [`Status: ${r.row.status} → ${c.status}`] : []),
      ];
      if (!lines.length) return err('Nothing to change.');
      return proposal('update_assignment', params, { title: 'Update assignment', heading: r.row.title, lines, resolved: { assignmentId: r.row.id } });
    },
    async execute(p) {
      const c = (p.params as any).changes;
      await update('assignment', p.resolved.assignmentId as string, Object.fromEntries(Object.entries(c).filter(([, v]) => v !== null && v !== undefined)));
      return '✓ Assignment updated';
    },
  },

  create_note: {
    async prepare(params: any, env) {
      const warnings: string[] = [];
      const subjectId = subjectLine(env, params.subject, warnings);
      return proposal('create_note', params, {
        title: 'Create note',
        heading: params.title,
        lines: [params.body ? `${String(params.body).slice(0, 200)}${params.body.length > 200 ? '…' : ''}` : '(empty)'],
        warnings,
        resolved: { subjectId },
        editable: [
          { path: 'title', label: 'Title', type: 'text' },
          { path: 'body', label: 'Body', type: 'textarea' },
        ],
      });
    },
    async execute(p) {
      const x = p.params as any;
      await create('note', { title: x.title, body: x.body ?? '', subjectId: (p.resolved.subjectId as string) ?? null });
      return '✓ Note created';
    },
  },

  create_reminder: {
    async prepare(params: any, env) {
      const rec = { ...params.recurrence, until: null };
      return proposal('create_reminder', params, {
        title: 'Reminder',
        heading: params.title,
        lines: [`${dayLabel(params.date, env.today)}, ${formatTime12(params.time)}`, `Repeats: ${describeRecurrence(rec, params.date)}`, `Notification: ${formatTime12(params.time)}`],
        editable: [
          { path: 'title', label: 'Reminder', type: 'text' },
          { path: 'date', label: 'Date', type: 'date' },
          { path: 'time', label: 'Time', type: 'time' },
        ],
      });
    },
    async execute(p, env) {
      const x = p.params as any;
      await create('reminder', { title: x.title, date: x.date, time: x.time, notes: x.notes, recurrence: { ...x.recurrence, until: null }, source: 'ai' });
      return `✓ Reminder set · I'll notify you ${dayWord(x.date, env.today)} at ${formatTime12(x.time)}`;
    },
  },

  generate_flashcards: {
    async prepare(params: any) {
      const topics = (await db.entity('topic').toArray()).filter((t) => !t.deletedAt);
      const topic = titleMatches(params.topic, topics)[0] ?? null;
      const notes = topic ? (await db.entity('note').where('topicId').equals(topic.id).toArray()).map((n) => n.body).join('\n\n').slice(0, 20_000) : undefined;
      const res = await genFlashcards(topic?.title ?? params.topic, notes || undefined, params.count);
      return proposal('generate_flashcards', params, {
        title: `Save ${res.cards.length} flashcards?`,
        heading: topic?.title ?? params.topic,
        lines: topic ? [] : ['No matching topic — cards will be saved without one.'],
        items: res.cards.map((c, i) => ({ key: String(i), label: `${c.question} → ${c.answer}`, selected: true })),
        resolved: { cards: res.cards, topicId: topic?.id ?? null, subjectId: topic?.subjectId ?? null },
        confirmLabel: 'Save selected',
      });
    },
    async execute(p, env) {
      const cards = p.resolved.cards as Array<{ question: string; answer: string }>;
      const chosen = (p.items ?? []).filter((i) => i.selected).map((i) => cards[Number(i.key)]!);
      await createMany(
        'flashcard',
        chosen.map((c) => ({ topicId: p.resolved.topicId as string | null, subjectId: p.resolved.subjectId as string | null, front: c.question, back: c.answer, dueDate: env.today })),
      );
      return `✓ Saved ${chosen.length} flashcards`;
    },
  },

  generate_quiz: {
    async prepare(params: any) {
      return { kind: 'quiz', topic: params.topic, count: params.count, difficulty: params.difficulty };
    },
    async execute() {
      return '';
    },
  },

  create_subject: {
    async prepare(params: any, env) {
      const dupe = env.subjects.find((s) => s.name.toLowerCase() === String(params.name).toLowerCase() || (params.code && s.code?.toLowerCase() === String(params.code).toLowerCase()));
      if (dupe) return err(`You already have a subject called "${dupe.name}"${dupe.code ? ` (${dupe.code})` : ''}.`);
      if (!params.basket) return askBasket(env, params.name, 'create_subject', params);
      const basket = findBaskets(params.basket, env.baskets)[0];
      return proposal('create_subject', params, {
        title: 'Add subject',
        heading: params.name,
        lines: [
          ...(params.code ? [`Code: ${params.code}`] : []),
          ...(params.faculty ? [`Faculty: ${params.faculty}`] : []),
          ...(params.credits !== null ? [`Credits: ${params.credits}`] : []),
          `Minimum attendance: ${params.minAttendance ?? env.settings.minAttendance}%${params.minAttendance === null ? ' (your default)' : ''}`,
          ...(params.targetAttendance !== null ? [`Target attendance: ${params.targetAttendance}%`] : []),
          ...(params.compulsory ? ['Compulsory: missed classes and revisions are rescheduled automatically'] : []),
          `Basket: ${basketLabel(env, params.basket)}`,
        ],
        resolved: { basketId: basket?.id ?? null },
        editable: [
          { path: 'name', label: 'Name', type: 'text' },
          { path: 'code', label: 'Code', type: 'text' },
          { path: 'faculty', label: 'Faculty', type: 'text' },
          { path: 'minAttendance', label: 'Minimum %', type: 'number' },
        ],
      });
    },
    async execute(p) {
      const x = p.params as any;
      await create('subject', {
        name: x.name,
        code: x.code,
        faculty: x.faculty,
        credits: x.credits,
        minAttendance: x.minAttendance,
        targetAttendance: x.targetAttendance,
        compulsory: !!x.compulsory,
        basketId: (p.resolved.basketId as string | null) ?? (await ensureBasket(x.basket)),
        color: await nextSubjectColor(),
      });
      return `✓ Subject "${x.name}" added`;
    },
  },

  update_subject: {
    async prepare(params: any, env) {
      const r = await resolveSubject(env, params.target, params, 'update_subject');
      if (isPrepared(r)) return r;
      const s = r.subject;
      const c = params.changes;
      const lines: string[] = [];
      const diff = (label: string, a: unknown, b: unknown, suffix = '') => b !== null && b !== undefined && a !== b && lines.push(`${label}: ${a ?? '—'}${a !== null && a !== undefined ? suffix : ''} → ${b}${suffix}`);
      diff('Name', s.name, c.name);
      diff('Code', s.code, c.code);
      diff('Faculty', s.faculty, c.faculty);
      diff('Credits', s.credits, c.credits);
      diff('Minimum attendance', s.minAttendance ?? env.settings.minAttendance, c.minAttendance, '%');
      diff('Target attendance', s.targetAttendance ?? env.settings.targetAttendance, c.targetAttendance, '%');
      if (c.compulsory !== null && c.compulsory !== undefined && c.compulsory !== s.compulsory) lines.push(`Compulsory: ${s.compulsory ? 'yes' : 'no'} → ${c.compulsory ? 'yes (missed work is rescheduled automatically)' : 'no'}`);
      const resolved: Record<string, unknown> = { subjectId: s.id };
      if (c.basket) {
        const current = env.baskets.find((b) => b.id === s.basketId);
        if (/^(none|no basket|null)$/i.test(c.basket)) return err(`Every subject has to be in a basket. Which basket should "${s.name}" move to?`);
        const r = resolveBasket(env, { name: c.basket }, params, 'update_subject');
        if (isPrepared(r)) return r;
        if (r.basket.id !== current?.id) {
          resolved.basketId = r.basket.id;
          lines.push(`Basket: ${current ? current.name : 'none'} → ${r.basket.name}`);
        }
      }
      if (!lines.length) return err(`"${s.name}" already looks like that — nothing to change.`);
      return proposal('update_subject', params, { title: 'Update subject', heading: s.name, lines, resolved });
    },
    async execute(p) {
      const { basket: _basket, ...changes } = (p.params as any).changes;
      const patch = Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== null && v !== undefined));
      if (p.resolved.basketId !== undefined) patch.basketId = p.resolved.basketId;
      await update('subject', p.resolved.subjectId as string, patch);
      return '✓ Subject updated';
    },
  },

  delete_subject: {
    async prepare(params: any, env) {
      const r = await resolveSubject(env, params.target, params, 'delete_subject');
      if (isPrepared(r)) return r;
      const slots = (await db.entity('classSchedule').toArray()).filter((s) => !s.deletedAt && s.subjectId === r.subject.id && (!s.validUntil || s.validUntil >= env.today));
      return proposal('delete_subject', params, {
        title: 'Delete subject',
        heading: r.subject.name,
        lines: [`${slots.length} weekly class${slots.length === 1 ? '' : 'es'} will stop appearing from today.`, 'Past attendance history is kept.'],
        resolved: { subjectId: r.subject.id, slotIds: slots.map((s) => s.id) },
      });
    },
    async execute(p, env) {
      for (const id of p.resolved.slotIds as string[]) await update('classSchedule', id, { validUntil: addDays(env.today, -1) });
      await remove('subject', p.resolved.subjectId as string);
      return '✓ Subject deleted';
    },
  },

  update_weekly_class: {
    async prepare(params: any, env) {
      const r = await resolveSlot(env, params.target, params, 'update_weekly_class');
      if (isPrepared(r)) return r;
      const s = r.slot;
      const c = params.changes;
      const weekday = c.weekday ?? s.weekday;
      const start = c.startTime ?? s.startTime;
      const end = c.endTime ?? (c.startTime ? minutesToTime(timeToMinutes(c.startTime) + timeToMinutes(s.endTime) - timeToMinutes(s.startTime)) : s.endTime);
      const room = c.room ?? s.room;
      if (start >= end) return err('The class must end after it starts.');
      const name = env.subjects.find((x) => x.id === s.subjectId)?.name ?? 'Class';
      const day = (d: number) => WEEKDAYS[d]![0]!.toUpperCase() + WEEKDAYS[d]!.slice(1);
      const lines = [
        ...(weekday !== s.weekday ? [`Every ${day(s.weekday)} → every ${day(weekday)}`] : [`Every ${day(weekday)}`]),
        ...(start !== s.startTime || end !== s.endTime ? [`${range(s.startTime, s.endTime)} → ${range(start, end)}`] : [range(start, end)]),
        ...(room !== s.room ? [`Room: ${s.room ?? '—'} → ${room ?? '—'}`] : []),
        'Applies from today; past attendance is unchanged.',
      ];
      const others = (await db.entity('classSchedule').toArray()).filter((x) => !x.deletedAt && x.active && x.id !== s.id && x.weekday === weekday && (!x.validUntil || x.validUntil >= env.today));
      const warnings = others
        .filter((x) => overlaps({ startTime: start, endTime: end }, x))
        .map((x) => `Clashes with ${env.subjects.find((y) => y.id === x.subjectId)?.name ?? 'a class'} every ${day(weekday)} ${range(x.startTime, x.endTime)}`);
      return proposal('update_weekly_class', params, {
        title: 'Change weekly class',
        heading: name,
        lines,
        warnings,
        resolved: { slotId: s.id, weekday, start, end, room },
        confirmLabel: warnings.length ? 'Change anyway' : 'Confirm',
      });
    },
    async execute(p, env) {
      const r = p.resolved as { slotId: string; weekday: number; start: string; end: string; room: string | null };
      const old = await db.entity('classSchedule').get(r.slotId);
      if (!old) throw new Error('slot missing');
      // End the old slot yesterday and start the new one today, so past attendance stays correct.
      await update('classSchedule', old.id, { validUntil: addDays(env.today, -1) });
      await create('classSchedule', { subjectId: old.subjectId, weekday: r.weekday, startTime: r.start, endTime: r.end, room: r.room, faculty: old.faculty, type: old.type, validFrom: env.today });
      return '✓ Timetable updated — calendar and reminders follow automatically';
    },
  },

  delete_weekly_class: {
    async prepare(params: any, env) {
      const r = await resolveSlot(env, params.target, params, 'delete_weekly_class');
      if (isPrepared(r)) return r;
      const s = r.slot;
      const name = env.subjects.find((x) => x.id === s.subjectId)?.name ?? 'Class';
      return proposal('delete_weekly_class', params, {
        title: 'Remove weekly class',
        heading: name,
        lines: [`Every ${WEEKDAYS[s.weekday]}, ${range(s.startTime, s.endTime)}`, 'Removed from today on; past attendance is kept.'],
        resolved: { slotId: s.id },
      });
    },
    async execute(p, env) {
      await update('classSchedule', p.resolved.slotId as string, { validUntil: addDays(env.today, -1) });
      return '✓ Weekly class removed';
    },
  },

  delete_exam: {
    async prepare(params: any, env) {
      const rows = (await db.entity('exam').toArray()).filter((e) => !e.deletedAt);
      const r = await resolveByTitle(rows, REF.exam, { ref: params.target.ref, title: params.target.title ?? params.target.subject }, params, 'delete_exam', 'exam', (e) => `${e.title} — ${e.date}`);
      if (isPrepared(r)) return r;
      return proposal('delete_exam', params, { title: 'Delete exam', heading: r.row.title, lines: [dayLabel(r.row.date, env.today)], resolved: { id: r.row.id } });
    },
    async execute(p) {
      await remove('exam', p.resolved.id as string);
      return '✓ Exam deleted';
    },
  },

  delete_assignment: {
    async prepare(params: any, env) {
      const rows = (await db.entity('assignment').toArray()).filter((a) => !a.deletedAt);
      const r = await resolveByTitle(rows, REF.assignment, params.target, params, 'delete_assignment', 'assignment', (a) => `${a.title} — due ${a.deadline}`);
      if (isPrepared(r)) return r;
      return proposal('delete_assignment', params, { title: 'Delete assignment', heading: r.row.title, lines: [`Due ${dayLabel(r.row.deadline, env.today)}`], resolved: { id: r.row.id } });
    },
    async execute(p) {
      await remove('assignment', p.resolved.id as string);
      return '✓ Assignment deleted';
    },
  },

  delete_note: {
    async prepare(params: any) {
      const rows = (await db.entity('note').toArray()).filter((n) => !n.deletedAt);
      const r = await resolveByTitle(rows, 'n', params.target, params, 'delete_note', 'note', (n) => n.title);
      if (isPrepared(r)) return r;
      return proposal('delete_note', params, { title: 'Delete note', heading: r.row.title, lines: [r.row.body ? `${r.row.body.slice(0, 120)}${r.row.body.length > 120 ? '…' : ''}` : '(empty note)'], resolved: { id: r.row.id } });
    },
    async execute(p) {
      await remove('note', p.resolved.id as string);
      return '✓ Note deleted';
    },
  },

  update_reminder: {
    async prepare(params: any, env) {
      const rows = (await db.entity('reminder').toArray()).filter((x) => !x.deletedAt);
      const r = await resolveByTitle(rows, REF.reminder, params.target, params, 'update_reminder', 'reminder', (x) => `${x.title} — ${describeRecurrence(x.recurrence, x.date)} ${formatTime12(x.time)}`);
      if (isPrepared(r)) return r;
      const x = r.row;
      const c = params.changes;
      const next = {
        title: c.title ?? x.title,
        date: c.date ?? x.date,
        time: c.time ?? x.time,
        active: c.active ?? x.active,
        recurrence: c.recurrence ? { ...c.recurrence, until: x.recurrence.until } : x.recurrence,
      };
      const lines = [
        ...(next.title !== x.title ? [`Title: ${x.title} → ${next.title}`] : []),
        ...(next.date !== x.date ? [`Date: ${dayLabel(x.date, env.today)} → ${dayLabel(next.date, env.today)}`] : []),
        ...(next.time !== x.time ? [`Time: ${formatTime12(x.time)} → ${formatTime12(next.time)}`] : []),
        ...(c.recurrence ? [`Repeats: ${describeRecurrence(x.recurrence, x.date)} → ${describeRecurrence(next.recurrence, next.date)}`] : []),
        ...(next.active !== x.active ? [next.active ? 'Resume this reminder' : 'Pause this reminder'] : []),
      ];
      if (!lines.length) return err('Nothing to change.');
      return proposal('update_reminder', params, { title: 'Update reminder', heading: x.title, lines, resolved: { id: x.id, patch: next } });
    },
    async execute(p) {
      await update('reminder', p.resolved.id as string, p.resolved.patch as never);
      return '✓ Reminder updated';
    },
  },

  delete_reminder: {
    async prepare(params: any) {
      const rows = (await db.entity('reminder').toArray()).filter((x) => !x.deletedAt);
      const r = await resolveByTitle(rows, REF.reminder, params.target, params, 'delete_reminder', 'reminder', (x) => `${x.title} — ${formatTime12(x.time)}`);
      if (isPrepared(r)) return r;
      return proposal('delete_reminder', params, { title: 'Delete reminder', heading: r.row.title, lines: [`${describeRecurrence(r.row.recurrence, r.row.date)} at ${formatTime12(r.row.time)}`], resolved: { id: r.row.id } });
    },
    async execute(p) {
      await remove('reminder', p.resolved.id as string);
      return '✓ Reminder deleted';
    },
  },

  create_basket: {
    async prepare(params: any, env) {
      const dupe = env.baskets.find((b) => b.name.toLowerCase() === String(params.name).toLowerCase());
      if (dupe) return err(`You already have a basket called "${dupe.name}".`);
      const warnings: string[] = [];
      const subjectIds: string[] = [];
      for (const name of params.subjects as string[]) {
        const hit = findSubjects(name, env.subjects);
        if (hit.length === 1) subjectIds.push(hit[0]!.id);
        else warnings.push(hit.length ? `"${name}" matches several subjects — move it from the Subjects page` : `No subject called "${name}"`);
      }
      const moved = env.subjects.filter((s) => subjectIds.includes(s.id)).map((s) => s.name);
      return proposal('create_basket', params, {
        title: 'Add basket',
        heading: `${params.icon ?? '📚'} ${params.name}`,
        lines: [
          ...(moved.length ? [`Subjects: ${moved.join(', ')}`] : []),
          ...basketRuleLines(env, params),
          ...(params.holidays.length ? [`Own holidays: ${(params.holidays as string[]).join(', ')}`] : []),
        ],
        warnings,
        resolved: { subjectIds },
        editable: [{ path: 'name', label: 'Name', type: 'text' }],
      });
    },
    async execute(p, env) {
      const x = p.params as any;
      const basket = await create('basket', {
        name: x.name,
        icon: x.icon ?? '📚',
        holidays: [...new Set(x.holidays as string[])].sort(),
        termStart: x.termStart,
        termEnd: x.termEnd,
        minAttendance: x.minAttendance,
        targetAttendance: x.targetAttendance,
        order: env.baskets.length,
      });
      for (const id of p.resolved.subjectIds as string[]) await update('subject', id, { basketId: basket.id });
      return `✓ Basket "${x.name}" added`;
    },
  },

  update_basket: {
    async prepare(params: any, env) {
      const r = resolveBasket(env, params.target, params, 'update_basket');
      if (isPrepared(r)) return r;
      const b = r.basket;
      const c = params.changes;
      const patch: Partial<Basket> = {};
      const lines: string[] = [];
      const set = <K extends keyof Basket>(key: K, label: string, value: Basket[K] | null | undefined, fallback: unknown = '—', suffix = '') => {
        if (value === null || value === undefined || value === b[key]) return;
        patch[key] = value;
        lines.push(`${label}: ${b[key] === null ? fallback : `${b[key]}${suffix}`} → ${value}${suffix}`);
      };
      set('name', 'Name', c.name);
      set('icon', 'Icon', c.icon);
      set('termStart', 'Term starts', c.termStart, `${env.settings.semesterStart ?? '—'} (global)`);
      set('termEnd', 'Term ends', c.termEnd, `${env.settings.semesterEnd ?? '—'} (global)`);
      set('minAttendance', 'Minimum attendance', c.minAttendance, `${env.settings.minAttendance}% (global)`, '%');
      set('targetAttendance', 'Target attendance', c.targetAttendance, `${env.settings.targetAttendance}% (global)`, '%');
      const added = ((c.addHolidays ?? []) as string[]).filter((d) => !b.holidays.includes(d));
      const removed = ((c.removeHolidays ?? []) as string[]).filter((d) => b.holidays.includes(d));
      if (added.length || removed.length) {
        patch.holidays = [...new Set([...b.holidays.filter((d) => !removed.includes(d)), ...added])].sort();
        if (added.length) lines.push(`Add holidays: ${added.join(', ')}`);
        if (removed.length) lines.push(`Remove holidays: ${removed.join(', ')}`);
      }
      if (!lines.length) return err(`"${b.name}" already looks like that — nothing to change.`);
      return proposal('update_basket', params, { title: 'Update basket', heading: `${b.icon} ${b.name}`, lines, resolved: { basketId: b.id, patch } });
    },
    async execute(p) {
      await update('basket', p.resolved.basketId as string, p.resolved.patch as Partial<Basket>);
      return '✓ Basket updated';
    },
  },

  update_settings: {
    async prepare(params: any, env) {
      // Hard rule (also enforced in validateIntents and the write path): user-only settings.
      if (protectedSettingsIn(params.changes).length) return err(PROTECTED_SETTING_MESSAGE);
      const s = env.settings;
      const c = params.changes;
      const lines: string[] = [];
      const patch: Partial<Settings> = {};
      const set = <K extends keyof Settings>(key: K, label: string, value: Settings[K] | null | undefined, fmt = (v: unknown) => String(v)) => {
        if (value === null || value === undefined || JSON.stringify(value) === JSON.stringify(s[key])) return;
        patch[key] = value;
        lines.push(`${label}: ${s[key] === null ? '—' : fmt(s[key])} → ${fmt(value)}`);
      };
      set('minAttendance', 'Minimum attendance', c.minAttendance, (v) => `${v}%`);
      set('targetAttendance', 'Target attendance', c.targetAttendance, (v) => `${v}%`);
      set('safeAttendance', 'Safe attendance', c.safeAttendance, (v) => `${v}%`);
      set('dailyStudyTargetMinutes', 'Daily study target', c.dailyStudyTargetMinutes, (v) => `${v} min`);
      set('semesterStart', 'Semester starts', c.semesterStart);
      set('semesterEnd', 'Semester ends', c.semesterEnd);
      if (c.addHolidays?.length || c.removeHolidays?.length) {
        const removed = new Set<string>(c.removeHolidays ?? []);
        set('holidays', 'Holidays (every basket)', [...new Set([...s.holidays.filter((d) => !removed.has(d)), ...(c.addHolidays ?? [])])].sort(), (v) => (v as string[]).join(', ') || 'none');
      }
      set('revisionIntervals', 'Revision days', c.revisionIntervals ? [...new Set(c.revisionIntervals as number[])].sort((a, b) => a - b) : null, (v) => (v as number[]).join(', '));
      set('theme', 'Theme', c.theme);
      if (c.sleepStart || c.sleepEnd) set('sleepWindow', 'Sleep time', { start: c.sleepStart ?? s.sleepWindow.start, end: c.sleepEnd ?? s.sleepWindow.end }, (v) => `${(v as Settings['sleepWindow']).start}–${(v as Settings['sleepWindow']).end}`);
      if (c.classReminderMinutes) {
        const cats = s.notifications.categories;
        const offsets = [...new Set(c.classReminderMinutes as number[])].sort((a, b) => b - a);
        patch.notifications = { ...s.notifications, categories: { ...cats, classes: { ...cats.classes, enabled: offsets.length > 0, offsets } } };
        lines.push(`Class reminders: ${cats.classes.offsets.join(', ') || 'off'} → ${offsets.join(', ') || 'off'} min before`);
      }
      if (!lines.length) return err('Your settings already look like that.');
      return proposal('update_settings', params, { title: 'Change settings', heading: 'Settings', lines, resolved: { patch } });
    },
    async execute(p) {
      await saveSettings(p.resolved.patch as Partial<Settings>);
      return '✓ Settings updated';
    },
  },

  update_profile: {
    async prepare(params: any, env) {
      const p = env.settings.profile;
      const c = params.changes;
      const lines: string[] = [];
      const profile: Partial<Settings['profile']> = {};
      const field = (key: keyof Settings['profile'], label: string) => {
        const v = c[key];
        if (v === null || v === undefined || v === p[key]) return;
        profile[key] = v;
        lines.push(`${label}: ${p[key] || '—'} → ${v}`);
      };
      field('name', 'Name');
      field('college', 'College');
      field('course', 'Course');
      field('semester', 'Semester');
      field('academicYear', 'Academic year');
      field('bio', 'Bio');
      const patch: Partial<Settings> = {};
      if (Object.keys(profile).length) patch.profile = { ...p, ...profile };
      if (c.studyTimes && JSON.stringify(c.studyTimes) !== JSON.stringify(env.settings.studyTimes)) {
        patch.studyTimes = c.studyTimes;
        lines.push(`Preferred study times: ${env.settings.studyTimes.join(', ') || '—'} → ${c.studyTimes.join(', ')}`);
      }
      if (c.studyStart && c.studyEnd) {
        const w = env.settings.studyWindow;
        patch.studyWindow = { start: c.studyStart, end: c.studyEnd };
        lines.push(`Study hours: ${w ? range(w.start, w.end) : '—'} → ${range(c.studyStart, c.studyEnd)}`);
      }
      if (!lines.length) return err('Your profile already looks like that — nothing to change.');
      return proposal('update_profile', params, { title: 'Update profile', heading: p.name || 'Your profile', lines, resolved: { patch } });
    },
    async execute(p) {
      await saveSettings(p.resolved.patch as Partial<Settings>);
      return '✓ Profile updated';
    },
  },

  navigate: {
    async prepare(params: any) {
      const labels: Record<string, string> = { today: "Today's plan", classes: 'Timetable', review: 'Review' };
      const page = params.page as string;
      return { kind: 'link', message: '', href: `/${page}`, label: `Open ${labels[page] ?? page[0]!.toUpperCase() + page.slice(1)}` };
    },
    async execute() {
      return '';
    },
  },
};
/* eslint-enable @typescript-eslint/no-explicit-any */

async function resolveSubject(
  env: Env,
  target: { ref?: string | null; name?: string | null },
  params: Record<string, unknown>,
  action: ActionName,
): Promise<{ subject: Subject } | Prepared> {
  if (target.ref) {
    const hit = env.subjects.find((s) => refOf(REF.subject, s.id) === target.ref);
    if (hit) return { subject: hit };
  }
  const matches = findSubjects(target.name, env.subjects);
  if (!matches.length) return err(`You don't have a subject called "${target.name ?? ''}".`);
  if (matches.length > 1) {
    return {
      kind: 'clarify',
      question: 'Which subject do you mean?',
      options: matches.slice(0, 8).map((s) => ({ label: `${s.name}${s.code ? ` (${s.code})` : ''}`, action, params: withRef(params, refOf(REF.subject, s.id)) })),
    };
  }
  return { subject: matches[0]! };
}

export function findBaskets(name: string | null | undefined, baskets: Basket[]): Basket[] {
  const q = norm(name ?? '');
  if (!q) return [];
  const exact = baskets.filter((b) => norm(b.name) === q);
  return exact.length ? exact : baskets.filter((b) => norm(b.name).includes(q) || q.includes(norm(b.name)));
}

function resolveBasket(env: Env, target: { ref?: string | null; name?: string | null }, params: Record<string, unknown>, action: ActionName): { basket: Basket } | Prepared {
  if (target.ref) {
    const hit = env.baskets.find((b) => refOf(REF.basket, b.id) === target.ref);
    if (hit) return { basket: hit };
  }
  const matches = findBaskets(target.name, env.baskets);
  if (!matches.length) return err(`You don't have a basket called "${target.name ?? ''}".`);
  if (matches.length > 1) {
    return { kind: 'clarify', question: 'Which basket do you mean?', options: matches.map((b) => ({ label: `${b.icon} ${b.name}`, action, params: withRef(params, refOf(REF.basket, b.id)) })) };
  }
  return { basket: matches[0]! };
}

/** Ask which basket a new subject goes in, offering each basket (or common ones when there are none yet). */
function askBasket(env: Env, subject: string, action: ActionName, params: Record<string, unknown>): Prepared {
  const names = env.baskets.length ? env.baskets.map((b) => ({ label: `${b.icon} ${b.name}`, name: b.name })) : [
    { label: '🏫 College', name: 'College' },
    { label: '📘 Coaching', name: 'Coaching' },
    { label: '🎒 School', name: 'School' },
  ];
  return {
    kind: 'clarify',
    question: `Which basket should “${subject}” go in?`,
    options: [
      ...names.map((n) => ({ label: n.label, action, params: { ...params, basket: n.name } })),
      ...(env.baskets.length ? [{ label: '➕ A new basket', send: `Put ${subject} in a new basket` }] : []),
    ],
  };
}

/** "🏫 College", or "Name (new basket)" when it doesn't exist yet. */
function basketLabel(env: Env, name: string): string {
  const b = findBaskets(name, env.baskets)[0];
  return b ? `${b.icon} ${b.name}` : `${name} (new basket)`;
}

/** Proposal lines for a new basket's own rules (anything unset follows the global settings). */
function basketRuleLines(env: Env, x: { termStart: string | null; termEnd: string | null; minAttendance: number | null; targetAttendance: number | null }): string[] {
  const s = env.settings;
  return [
    x.termStart || x.termEnd ? `Term: ${x.termStart ?? s.semesterStart ?? '—'} → ${x.termEnd ?? s.semesterEnd ?? '—'}` : 'Term: same as your semester',
    `Minimum attendance: ${x.minAttendance ?? s.minAttendance}%${x.minAttendance === null ? ' (global)' : ''}`,
    ...(x.targetAttendance !== null ? [`Target attendance: ${x.targetAttendance}%`] : []),
  ];
}

async function resolveSlot(
  env: Env,
  target: { ref?: string | null; subject?: string | null; weekday?: number | null; time?: string | null },
  params: Record<string, unknown>,
  action: ActionName,
): Promise<{ slot: ClassSchedule } | Prepared> {
  let slots = (await db.entity('classSchedule').toArray()).filter((s) => !s.deletedAt && s.active && (!s.validUntil || s.validUntil >= env.today));
  if (target.ref) {
    const hit = slots.find((s) => refOf('w', s.id) === target.ref);
    if (hit) return { slot: hit };
  }
  if (target.subject) {
    const subjects = findSubjects(target.subject, env.subjects);
    if (!subjects.length) return err(`You don't have a subject called "${target.subject}".`);
    slots = slots.filter((s) => subjects.some((x) => x.id === s.subjectId));
  }
  if (target.weekday !== null && target.weekday !== undefined) slots = slots.filter((s) => s.weekday === target.weekday);
  if (target.time) slots = slots.filter((s) => s.startTime === target.time);
  const name = (s: ClassSchedule) => env.subjects.find((x) => x.id === s.subjectId)?.name ?? 'Class';
  if (!slots.length) return err("I couldn't find that weekly class in your timetable. I won't guess.");
  if (slots.length > 1) {
    return {
      kind: 'clarify',
      question: 'Which weekly class do you mean?',
      options: slots.slice(0, 10).map((s) => ({ label: `${name(s)} — ${WEEKDAYS[s.weekday]!.slice(0, 3)} ${range(s.startTime, s.endTime)}`, action, params: withRef(params, refOf('w', s.id)) })),
    };
  }
  return { slot: slots[0]! };
}

async function matchingRevisions(env: Env, f: { subject?: string | null; topic?: string | null; fromDate?: string | null; toDate?: string | null }) {
  const [revs, topics] = await Promise.all([db.entity('revisionSchedule').toArray(), db.entity('topic').toArray()]);
  const topicById = new Map(topics.filter((t) => !t.deletedAt).map((t) => [t.id, t]));
  let list = revs.filter((r) => !r.deletedAt && r.status === 'pending' && topicById.has(r.topicId)) as RevisionSchedule[];
  if (f.subject) {
    const subjects = findSubjects(f.subject, env.subjects);
    if (!subjects.length) return err(`You don't have a subject called "${f.subject}".`);
    list = list.filter((r) => subjects.some((s) => s.id === r.subjectId));
  }
  if (f.topic) {
    const hits = new Set(titleMatches(f.topic, [...topicById.values()]).map((t) => t.id));
    list = list.filter((r) => hits.has(r.topicId));
  }
  if (f.fromDate) list = list.filter((r) => r.dueDate >= f.fromDate!);
  if (f.toDate) list = list.filter((r) => r.dueDate <= f.toDate!);
  return list
    .map((r) => ({ id: r.id, due: r.dueDate, label: `${env.subjects.find((s) => s.id === r.subjectId)?.name ?? 'No subject'} — ${topicById.get(r.topicId)!.title} (${r.dueDate})` }))
    .sort((a, b) => a.due.localeCompare(b.due) || a.label.localeCompare(b.label));
}

// ---------------------------------------------------------------------------
// Public API

export async function prepareAction(action: ActionName, params: Record<string, unknown>): Promise<Prepared> {
  const env = await loadEnv();
  try {
    return await H[action].prepare(params, env);
  } catch (e) {
    console.error('prepare failed', action, e);
    return err((e as Error).message?.includes('offline') ? 'That needs an internet connection.' : "I couldn't prepare that action.");
  }
}

export async function executeProposal(p: Proposal): Promise<string> {
  return H[p.action].execute(p, await loadEnv());
}

/** Apply an edited field to params and re-validate with the action's schema. */
export function editParams(action: ActionName, params: Record<string, unknown>, path: string, value: string, type: FieldType): { ok: true; params: Record<string, unknown> } | { ok: false; error: string } {
  const next = structuredClone(params);
  const keys = path.split('.');
  let cur = next as Record<string, unknown>;
  for (const k of keys.slice(0, -1)) cur = (cur[k] ??= {}) as Record<string, unknown>;
  cur[keys.at(-1)!] = value === '' ? null : type === 'number' ? Number(value) : value;
  const parsed = ACTIONS[action].schema.safeParse(next);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid value' };
  return { ok: true, params: parsed.data as Record<string, unknown> };
}

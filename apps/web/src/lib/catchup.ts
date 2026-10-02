/**
 * Catch-up for compulsory subjects, run in the background on every device:
 *  - an absent class gets one catch-up study session in the next free slot;
 *  - a study session that didn't happen moves to the next free slot;
 *  - an overdue revision moves to the next day with free time (max 3 moved per day).
 * Free slots skip classes, other events and the student's sleep time.
 */
import { addDays, catchUpIdFor, findRevisionDay, findSlot, localMomentNow, timeToMinutes, todayISO, type Slot } from '@student-os/core';
import { db } from './db';
import { occurrencesBetween, loadSettings } from './queries';
import { create, update } from './repo';
import { toast } from './store';

const LOOKBACK_DAYS = 7;
const AHEAD_DAYS = 14;
let running = false;

export async function runCatchUp(): Promise<number> {
  if (running) return 0;
  running = true;
  try {
    return await catchUp();
  } finally {
    running = false;
  }
}

async function catchUp(): Promise<number> {
  const settings = await loadSettings();
  if (!settings.onboarded) return 0;
  const subjects = (await db.entity('subject').toArray()).filter((s) => !s.deletedAt && s.compulsory);
  if (!subjects.length) return 0;
  const compulsory = new Map(subjects.map((s) => [s.id, s]));

  const today = todayISO();
  const now = localMomentNow().minutes;
  const notBefore = now + 15;
  const sleep = settings.sleepWindow;
  const from = addDays(today, -LOOKBACK_DAYS);
  const classes = await occurrencesBetween(from, addDays(today, AHEAD_DAYS), settings);
  const allEvents = await db.entity('calendarEvent').where('date').between(from, addDays(today, AHEAD_DAYS), true, true).toArray();
  const events = allEvents.filter((e) => !e.deletedAt);
  const taken: Slot[] = [];
  let moved = 0;

  // 1. Missed study sessions of compulsory subjects → next free slot.
  const ended = (date: string, end: string | null) => date < today || (date === today && !!end && timeToMinutes(end) <= now);
  for (const e of events) {
    if (e.type !== 'study' || e.completedAt || !e.subjectId || !compulsory.has(e.subjectId) || !e.startTime || !e.endTime) continue;
    if (!ended(e.date, e.endTime)) continue;
    const minutes = timeToMinutes(e.endTime) - timeToMinutes(e.startTime);
    if (minutes <= 0) continue;
    const others = events.filter((x) => x.id !== e.id);
    const slot = findSlot({ from: today, notBefore, minutes, classes, events: others, sleep, taken });
    if (!slot) continue;
    taken.push(slot);
    await update('calendarEvent', e.id, { date: slot.date, startTime: slot.start, endTime: slot.end, notes: appendNote(e.notes, `Moved from ${e.date} (missed).`) });
    Object.assign(e, { date: slot.date, startTime: slot.start, endTime: slot.end });
    moved++;
  }

  // 2. Absent classes of compulsory subjects → one catch-up session each.
  const known = new Set(allEvents.map((e) => e.id));
  for (const c of classes) {
    if (c.status !== 'absent' || c.date > today || !compulsory.has(c.subjectId)) continue;
    const id = catchUpIdFor(c.id);
    if (known.has(id) || (await db.entity('calendarEvent').get(id))) continue; // already planned (or deleted by the student)
    const minutes = Math.max(30, timeToMinutes(c.endTime) - timeToMinutes(c.startTime));
    const slot = findSlot({ from: today, notBefore, minutes, classes, events, sleep, taken });
    if (!slot) continue;
    taken.push(slot);
    const name = compulsory.get(c.subjectId)!.name;
    const ev = await create('calendarEvent', {
      id,
      title: `Catch up: ${name}`,
      type: 'study',
      date: slot.date,
      startTime: slot.start,
      endTime: slot.end,
      subjectId: c.subjectId,
      notes: `You missed the ${name} class on ${c.date}. ${name} is marked compulsory, so this catch-up was added automatically.`,
    } as never);
    events.push(ev);
    known.add(id);
    moved++;
  }

  // 3. Overdue revisions of compulsory subjects → next day with free time.
  const revisions = (await db.entity('revisionSchedule').toArray()).filter((r) => !r.deletedAt && r.status === 'pending' && r.dueDate < today && r.subjectId && compulsory.has(r.subjectId));
  const load = new Map<string, number>();
  for (const r of revisions.sort((a, b) => a.dueDate.localeCompare(b.dueDate))) {
    const day = findRevisionDay({ from: today, notBefore, classes, events, sleep, load });
    load.set(day, (load.get(day) ?? 0) + 1);
    await update('revisionSchedule', r.id, { dueDate: day });
    moved++;
  }

  return moved;
}

function appendNote(notes: string | null, line: string) {
  return (notes ? `${notes}\n${line}` : line).slice(-5000);
}

/** Run now, then every 10 minutes and whenever the app comes back to the foreground. */
export function startCatchUp() {
  const run = () =>
    void runCatchUp()
      .then((n) => n > 0 && toast(`Rescheduled ${n} missed item${n === 1 ? '' : 's'} for compulsory subjects`, 'info'))
      .catch((e) => console.warn('catch-up failed', e));
  setTimeout(run, 5_000);
  setInterval(run, 10 * 60_000);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && run());
}

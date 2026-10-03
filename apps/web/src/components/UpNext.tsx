import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { AlarmClock, AlertTriangle, Ban, CalendarClock, Check, ChevronLeft, ChevronRight, Clock, ListChecks, MapPin, X } from 'lucide-react';
import {
  fmtPct,
  formatMinutes,
  formatTime12,
  reminderDates,
  timeToMinutes,
  type SubjectAttendanceSummary,
  type CalendarEvent,
  type ClassOccurrence,
  type ISODate,
  type Reminder,
  type Settings,
  type Subject,
  type Task,
} from '@student-os/core';
import { update } from '../lib/repo';
import { cancelTarget, completeTarget, FeedbackSheet, notDoneTarget, type FeedbackTarget } from './ItemFeedback';
import { cn } from './ui';

type Item =
  | { kind: 'class'; key: string; start: number; end: number; occ: ClassOccurrence }
  | { kind: 'task'; key: string; start: number; end: number; task: Task }
  | { kind: 'event'; key: string; start: number; end: number; event: CalendarEvent }
  | { kind: 'reminder'; key: string; start: number; end: number; reminder: Reminder };

/** Today's timed items (classes, plus tasks/events/reminders the student opted into), in time order. */
export function upNextItems(
  today: ISODate,
  data: { classes: ClassOccurrence[]; tasks: Task[]; events: CalendarEvent[]; reminders: Reminder[] },
  include: Settings['app']['upNext'],
): Item[] {
  const items: Item[] = data.classes
    .filter((c) => c.status !== 'cancelled' && c.status !== 'rescheduled')
    .map((occ) => ({ kind: 'class', key: `c${occ.id}`, start: timeToMinutes(occ.startTime), end: timeToMinutes(occ.endTime), occ }));
  if (include.tasks) {
    for (const task of data.tasks) {
      if (task.status === 'done' || task.dueDate !== today || !task.dueTime) continue;
      const due = timeToMinutes(task.dueTime);
      items.push({ kind: 'task', key: `t${task.id}`, start: due, end: due, task });
    }
  }
  if (include.events) {
    for (const event of data.events) {
      if (event.date !== today || !event.startTime || event.completedAt) continue;
      const start = timeToMinutes(event.startTime);
      items.push({ kind: 'event', key: `e${event.id}`, start, end: event.endTime ? timeToMinutes(event.endTime) : start, event });
    }
  }
  if (include.reminders) {
    for (const reminder of data.reminders) {
      if (!reminder.active || reminder.doneDates.includes(today) || !reminderDates(reminder.date, reminder.recurrence, today, today).length) continue;
      const at = timeToMinutes(reminder.time);
      items.push({ kind: 'reminder', key: `m${reminder.id}`, start: at, end: at, reminder });
    }
  }
  // Same start: a task due at 10:00 comes before the 10:00 class, since it has to be done by then.
  const rank = { task: 0, reminder: 1, class: 2, event: 3 };
  return items.sort((a, b) => a.start - b.start || rank[a.kind] - rank[b.kind]);
}

/**
 * Home hero: whatever is next today, by time. Swipe left for the next item,
 * right for the previous one. Neighbours stay hidden until you swipe.
 */
export function UpNext({
  items,
  minutesNow,
  hadClasses,
  subjects,
  attendanceFor,
  today,
  alsoFor = () => [],
}: {
  items: Item[];
  minutesNow: number;
  hadClasses: boolean;
  subjects: Map<string, Subject>;
  attendanceFor: (subjectId: string) => SubjectAttendanceSummary | undefined;
  today: ISODate;
  /** Duplicate copies (task / revision) of an item, answered together with it. */
  alsoFor?: (target: FeedbackTarget) => FeedbackTarget[];
}) {
  // Position is kept relative to "now", so the card follows the clock unless you swipe.
  const [offset, setOffset] = useState(0);
  const [dir, setDir] = useState<'left' | 'right' | null>(null);
  const [drag, setDrag] = useState(0);
  const startX = useRef<number | null>(null);

  const firstUpcoming = items.findIndex((i) => i.end > minutesNow || (i.kind === 'class' && i.end === minutesNow));
  const base = firstUpcoming === -1 ? items.length : firstUpcoming;
  // One extra slide at the end ("nothing else today") when everything is behind us.
  const count = items.length + (firstUpcoming === -1 ? 1 : 0);
  const index = Math.min(Math.max(base + offset, 0), count - 1);
  const item = items[index];

  const go = (step: 1 | -1) => {
    const next = index + step;
    if (next < 0 || next >= count) return;
    setDir(step === 1 ? 'right' : 'left');
    setOffset(next - base);
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    // Buttons, and the feedback sheet (React events bubble out of its portal-less <dialog>).
    if ((e.target as HTMLElement).closest('button, dialog')) return;
    startX.current = e.clientX;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    if (startX.current === null) return;
    const dx = e.clientX - startX.current;
    // Resist at the ends so it's clear there's nothing more that way.
    const atEnd = (dx < 0 && index === count - 1) || (dx > 0 && index === 0);
    setDrag(atEnd ? dx / 4 : dx);
  };
  const onPointerEnd = () => {
    if (startX.current === null) return;
    startX.current = null;
    if (drag < -50) go(1);
    else if (drag > 50) go(-1);
    setDrag(0);
  };

  return (
    <section
      aria-roledescription="carousel"
      aria-label="Up next today"
      tabIndex={0}
      onKeyDown={(e) => {
        if ((e.target as HTMLElement).closest('dialog')) return;
        if (e.key === 'ArrowRight') go(1);
        if (e.key === 'ArrowLeft') go(-1);
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      className="relative touch-pan-y select-none overflow-hidden rounded-3xl bg-accent p-5 text-accent-ink shadow-pop outline-none focus-visible:ring-2 focus-visible:ring-ink sm:p-6"
    >
      <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 size-56 rounded-full bg-white/10" />
      <div aria-hidden className="pointer-events-none absolute -bottom-20 right-20 size-40 rounded-full bg-white/5" />
      <div
        key={index}
        className={cn('relative', drag === 0 && dir === 'right' && 'animate-slide-from-right', drag === 0 && dir === 'left' && 'animate-slide-from-left')}
        style={drag ? { transform: `translateX(${drag}px)`, opacity: Math.max(0.3, 1 - Math.abs(drag) / 300) } : undefined}
      >
        {item ? (
          <Slide item={item} minutesNow={minutesNow} subjects={subjects} attendanceFor={attendanceFor} today={today} alsoFor={alsoFor} />
        ) : (
          <>
            <Label>{items.length ? 'Up next' : 'Next class'}</Label>
            <div className="mt-2 text-lg font-semibold">{items.length || hadClasses ? 'Nothing else today 🎉' : 'No classes today'}</div>
          </>
        )}
      </div>
      {count > 1 && (
        <div className="relative mt-4 flex items-center justify-between gap-2">
          <button onClick={() => go(-1)} disabled={index === 0} aria-label="Previous" className="rounded-full p-1 opacity-80 hover:bg-white/15 disabled:opacity-30">
            <ChevronLeft className="size-4" />
          </button>
          <div className="flex items-center gap-1.5" aria-label={`${index + 1} of ${count}`}>
            {Array.from({ length: count }, (_, i) => (
              <span key={i} className={cn('h-1.5 rounded-full bg-white transition-all', i === index ? 'w-4' : 'w-1.5 opacity-40')} />
            ))}
          </div>
          <button onClick={() => go(1)} disabled={index === count - 1} aria-label="Next" className="rounded-full p-1 opacity-80 hover:bg-white/15 disabled:opacity-30">
            <ChevronRight className="size-4" />
          </button>
        </div>
      )}
    </section>
  );
}

function Label({ children }: { children: string }) {
  return <div className="text-xs font-semibold uppercase tracking-wider opacity-80">{children}</div>;
}

function Meta({ children }: { children: ReactNode }) {
  return <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm opacity-90">{children}</div>;
}

function Slide({
  item,
  minutesNow,
  subjects,
  attendanceFor,
  today,
  alsoFor,
}: {
  item: Item;
  minutesNow: number;
  subjects: Map<string, Subject>;
  attendanceFor: (subjectId: string) => SubjectAttendanceSummary | undefined;
  today: ISODate;
  alsoFor: (target: FeedbackTarget) => FeedbackTarget[];
}) {
  const past = item.end < minutesNow || (item.end === minutesNow && item.kind !== 'class');
  const now = !past && item.start <= minutesNow;
  const until = !past && !now && <span>in {formatMinutes(item.start - minutesNow)}</span>;

  if (item.kind === 'class') {
    const { occ } = item;
    const summary = attendanceFor(occ.subjectId);
    return (
      <>
        <Label>{past ? 'Earlier today' : now ? 'Happening now' : 'Next class'}</Label>
        <div className="mt-2 text-2xl font-semibold tracking-tight">{subjects.get(occ.subjectId)?.name ?? 'Class'}</div>
        <Meta>
          <span className="inline-flex items-center gap-1.5">
            <Clock className="size-4" /> {formatTime12(occ.startTime)} – {formatTime12(occ.endTime)}
          </span>
          {occ.room && (
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="size-4" /> Room {occ.room}
            </span>
          )}
          {until}
        </Meta>
        {summary && summary.conducted > 0 && (
          <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-sm">
            Attendance <strong className="tabular">{fmtPct(summary.percent)}</strong>
            {(summary.risk === 'at_risk' || summary.risk === 'below_min') && <AlertTriangle className="size-4" aria-label="Below target" />}
          </div>
        )}
      </>
    );
  }

  if (item.kind === 'task') {
    const { task } = item;
    const subject = task.subjectId ? subjects.get(task.subjectId)?.name : null;
    return (
      <>
        <Label>{past ? 'Task overdue' : 'Next task'}</Label>
        <div className="mt-2 text-2xl font-semibold tracking-tight">{task.title}</div>
        <Meta>
          <span className="inline-flex items-center gap-1.5">
            <ListChecks className="size-4" /> Due {formatTime12(task.dueTime!)}
          </span>
          {subject && <span>{subject}</span>}
          {task.estimatedMinutes ? <span>~{formatMinutes(task.estimatedMinutes)}</span> : null}
          {until}
        </Meta>
        <Actions target={{ kind: 'task', task }} alsoFor={alsoFor} />
      </>
    );
  }

  if (item.kind === 'event') {
    const { event } = item;
    return (
      <>
        <Label>{past ? 'Earlier today' : now ? 'Happening now' : `Next ${event.type === 'study' ? 'study session' : event.type}`}</Label>
        <div className="mt-2 text-2xl font-semibold tracking-tight">{event.title}</div>
        <Meta>
          <span className="inline-flex items-center gap-1.5">
            <CalendarClock className="size-4" /> {formatTime12(event.startTime!)}
            {event.endTime && ` – ${formatTime12(event.endTime)}`}
          </span>
          {event.subjectId && subjects.get(event.subjectId) && <span>{subjects.get(event.subjectId)!.name}</span>}
          {until}
        </Meta>
        <Actions target={{ kind: 'event', event }} alsoFor={alsoFor} />
      </>
    );
  }

  const { reminder } = item;
  return (
    <>
      <Label>{past ? 'Earlier reminder' : 'Reminder'}</Label>
      <div className="mt-2 text-2xl font-semibold tracking-tight">{reminder.title}</div>
      <Meta>
        <span className="inline-flex items-center gap-1.5">
          <AlarmClock className="size-4" /> {formatTime12(reminder.time)}
        </span>
        {until}
      </Meta>
      <DoneButton onClick={() => void update('reminder', reminder.id, { doneDates: [...new Set([...reminder.doneDates, today])].slice(-400) })} />
    </>
  );
}

function DoneButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-sm font-medium hover:bg-white/25">
      <Check className="size-4" /> Mark done
    </button>
  );
}

/** The four answers, right on the card. */
function Actions({ target, alsoFor }: { target: FeedbackTarget; alsoFor: (target: FeedbackTarget) => FeedbackTarget[] }) {
  const [reschedule, setReschedule] = useState(false);
  const also = alsoFor(target);
  return (
    <div className="mt-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
      <Pill icon={<Check className="size-4" />} onClick={() => void completeTarget(target, also)}>
        Completed
      </Pill>
      <Pill icon={<X className="size-4" />} onClick={() => void notDoneTarget(target, also)}>
        Not completed
      </Pill>
      <Pill icon={<CalendarClock className="size-4" />} onClick={() => setReschedule(true)}>
        Reschedule
      </Pill>
      <Pill icon={<Ban className="size-4" />} onClick={() => void cancelTarget(target, also)}>
        Cancel
      </Pill>
      <FeedbackSheet target={reschedule ? target : null} also={also} start="reschedule" onClose={() => setReschedule(false)} />
    </div>
  );
}

function Pill({ icon, onClick, children }: { icon: ReactNode; onClick: () => void; children: string }) {
  return (
    <button onClick={onClick} className="inline-flex items-center justify-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-sm font-medium hover:bg-white/25">
      {icon} {children}
    </button>
  );
}

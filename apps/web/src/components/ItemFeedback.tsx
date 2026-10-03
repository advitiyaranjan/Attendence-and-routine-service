/**
 * "How did it go?" for anything on the plan (not just classes): completed, not completed,
 * reschedule or cancel. Every answer can be undone from the toast.
 */
import { useEffect, useState } from 'react';
import { Ban, CalendarClock, Check, MessageSquareMore, X } from 'lucide-react';
import { addDays, minutesToTime, timeToMinutes, todayISO, type Assignment, type CalendarEvent, type Exam, type ISODate, type RecallRating, type RevisionSchedule, type Task } from '@student-os/core';
import { completeRevision } from '../lib/actions';
import { remove, update } from '../lib/repo';
import { toast } from '../lib/store';
import { RatingButtons } from '../pages/Revision';
import { Button, cn, Field, Input, Modal } from './ui';

export type FeedbackTarget =
  | { kind: 'task'; task: Task }
  | { kind: 'event'; event: CalendarEvent }
  | { kind: 'revision'; revision: RevisionSchedule; title: string }
  | { kind: 'assignment'; assignment: Assignment }
  | { kind: 'exam'; exam: Exam };

type Step = 'menu' | 'reschedule' | 'rate';

export function targetTitle(t: FeedbackTarget): string {
  switch (t.kind) {
    case 'task':
      return t.task.title;
    case 'event':
      return t.event.title;
    case 'revision':
      return t.title;
    case 'assignment':
      return t.assignment.title;
    case 'exam':
      return t.exam.title;
  }
}

/** Current date and time of the item, used to prefill "Reschedule". */
function when(t: FeedbackTarget): { date: ISODate | null; time: string | null } {
  switch (t.kind) {
    case 'task':
      return { date: t.task.plannedDate ?? t.task.dueDate, time: t.task.dueTime };
    case 'event':
      return { date: t.event.date, time: t.event.startTime };
    case 'revision':
      return { date: t.revision.dueDate, time: null };
    case 'assignment':
      return { date: t.assignment.deadline, time: t.assignment.deadlineTime };
    case 'exam':
      return { date: t.exam.date, time: t.exam.startTime };
  }
}

const hasTime = (t: FeedbackTarget) => t.kind !== 'revision';

/** Moves the item to a new date (and time). Returns an undo. */
async function moveTo(t: FeedbackTarget, date: ISODate, time: string | null): Promise<() => void> {
  switch (t.kind) {
    case 'task': {
      const { id, plannedDate, dueDate, dueTime } = t.task;
      await update('task', id, { plannedDate: date, dueDate: dueDate && dueDate < date ? date : dueDate, dueTime: time ?? dueTime, status: 'todo', completedAt: null });
      return () => void update('task', id, { plannedDate, dueDate, dueTime });
    }
    case 'event': {
      const { id, date: oldDate, startTime, endTime } = t.event;
      let end = endTime;
      if (time && startTime && endTime) end = minutesToTime(Math.min(timeToMinutes(time) + timeToMinutes(endTime) - timeToMinutes(startTime), 23 * 60 + 59));
      await update('calendarEvent', id, { date, startTime: time ?? startTime, endTime: time && !startTime ? null : end, completedAt: null });
      return () => void update('calendarEvent', id, { date: oldDate, startTime, endTime });
    }
    case 'revision': {
      const { id, dueDate } = t.revision;
      await update('revisionSchedule', id, { dueDate: date });
      return () => void update('revisionSchedule', id, { dueDate });
    }
    case 'assignment': {
      const { id, deadline, deadlineTime } = t.assignment;
      await update('assignment', id, { deadline: date, deadlineTime: time ?? deadlineTime });
      return () => void update('assignment', id, { deadline, deadlineTime });
    }
    case 'exam': {
      const { id, date: oldDate, startTime } = t.exam;
      await update('exam', id, { date, startTime: time ?? startTime });
      return () => void update('exam', id, { date: oldDate, startTime });
    }
  }
}

type Undo = () => void;
const noop: Undo = () => {};

/** Marks one item done without a toast. */
export async function complete(t: FeedbackTarget): Promise<Undo> {
  switch (t.kind) {
    case 'task':
      await update('task', t.task.id, { status: 'done', completedAt: new Date().toISOString() });
      return () => void update('task', t.task.id, { status: 'todo', completedAt: null });
    case 'event':
      await update('calendarEvent', t.event.id, { completedAt: new Date().toISOString() });
      return () => void update('calendarEvent', t.event.id, { completedAt: null });
    case 'assignment': {
      const prev = t.assignment.status;
      await update('assignment', t.assignment.id, { status: 'submitted' });
      return () => void update('assignment', t.assignment.id, { status: prev });
    }
    case 'revision':
      // Only reached for a revision folded into another row; the row itself asks for a rating.
      await completeRevision(t.revision, 'remembered');
      return noop;
    case 'exam':
      return noop;
  }
}

async function notDone(t: FeedbackTarget): Promise<Undo> {
  if (t.kind === 'assignment') {
    // The deadline isn't ours to move: keep it open and mark it as started.
    const prev = t.assignment.status;
    await update('assignment', t.assignment.id, { status: 'in_progress' });
    return () => void update('assignment', t.assignment.id, { status: prev });
  }
  if (t.kind === 'exam') return noop;
  return moveTo(t, addDays(todayISO(), 1), null);
}

async function cancel(t: FeedbackTarget): Promise<Undo> {
  switch (t.kind) {
    case 'task':
      await remove('task', t.task.id);
      return () => void update('task', t.task.id, { deletedAt: null });
    case 'event':
      // Deleting a catch-up session also stops it from being planned again.
      await remove('calendarEvent', t.event.id);
      return () => void update('calendarEvent', t.event.id, { deletedAt: null });
    case 'revision':
      await update('revisionSchedule', t.revision.id, { status: 'skipped' });
      return () => void update('revisionSchedule', t.revision.id, { status: 'pending' });
    case 'assignment':
      await remove('assignment', t.assignment.id);
      return () => void update('assignment', t.assignment.id, { deletedAt: null });
    case 'exam':
      await remove('exam', t.exam.id);
      return () => void update('exam', t.exam.id, { deletedAt: null });
  }
}

/** Applies one answer to the item and any duplicates folded into it, with a single Undo. */
async function apply(op: (t: FeedbackTarget) => Promise<Undo>, targets: FeedbackTarget[], message: string) {
  const undos: Undo[] = [];
  for (const t of targets) undos.push(await op(t));
  toast(message, 'success', { label: 'Undo', run: () => undos.forEach((u) => u()) });
}

/** One-tap "done" (checkboxes, the Up next card). */
export function completeTarget(t: FeedbackTarget, also: FeedbackTarget[] = []): Promise<void> {
  return apply(complete, [t, ...also], `${t.kind === 'assignment' ? 'Submitted' : 'Completed'}: ${targetTitle(t)}`);
}

export function notDoneTarget(t: FeedbackTarget, also: FeedbackTarget[] = []): Promise<void> {
  return apply(notDone, [t, ...also], t.kind === 'assignment' ? `${targetTitle(t)}: still open` : `Not done: ${targetTitle(t)} moved to tomorrow`);
}

export function cancelTarget(t: FeedbackTarget, also: FeedbackTarget[] = []): Promise<void> {
  return apply(cancel, [t, ...also], `Cancelled: ${targetTitle(t)}`);
}

/** Small button that opens the feedback sheet. */
export function FeedbackButton({ target, also, className, label = 'Feedback' }: { target: FeedbackTarget; also?: FeedbackTarget[]; className?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className={cn('inline-flex shrink-0 items-center justify-center rounded-lg p-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-ink', className)}
        aria-label={`${label}: ${targetTitle(target)}`}
        title="Done, not done, reschedule or cancel"
      >
        <MessageSquareMore className="size-4" />
      </button>
      <FeedbackSheet target={open ? target : null} also={also} onClose={() => setOpen(false)} />
    </>
  );
}

/** `start="reschedule"` opens straight on the date/time picker. */
export function FeedbackSheet({ target, also = [], onClose, start = 'menu' }: { target: FeedbackTarget | null; also?: FeedbackTarget[]; onClose: () => void; start?: 'menu' | 'reschedule' }) {
  const [step, setStep] = useState<Step>('menu');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  useEffect(() => {
    if (!target || start !== 'reschedule') return;
    const w = when(target);
    const today = todayISO();
    setDate(w.date && w.date > today ? w.date : addDays(today, 1));
    setTime(w.time ?? '');
    setStep('reschedule');
    // Only when the sheet opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!target, start]);
  const close = () => {
    setStep('menu');
    onClose();
  };
  const run = (fn: () => Promise<void>) => async () => {
    try {
      await fn();
      close();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not save that', 'error');
    }
  };
  if (!target) return null;

  const title = targetTitle(target);
  const all = [target, ...also];
  const isExam = target.kind === 'exam';
  const openReschedule = () => {
    const w = when(target);
    const today = todayISO();
    setDate(w.date && w.date > today ? w.date : addDays(today, 1));
    setTime(w.time ?? '');
    setStep('reschedule');
  };

  return (
    <Modal open onClose={close} title={step === 'rate' ? `How well did you remember it?` : step === 'reschedule' ? `Reschedule ${title}` : title}>
      {step === 'menu' && (
        <div className="grid grid-cols-2 gap-2">
          {!isExam && (
            <Option
              icon={<Check className="size-5" style={{ color: 'var(--color-good)' }} />}
              label={target.kind === 'assignment' ? 'Submitted' : 'Completed'}
              onClick={target.kind === 'revision' ? () => setStep('rate') : run(() => completeTarget(target, also))}
            />
          )}
          {!isExam && (
            <Option
              icon={<X className="size-5" style={{ color: 'var(--color-critical)' }} />}
              label="Not completed"
              hint={target.kind === 'assignment' ? 'Keep it open' : 'Moves to tomorrow'}
              onClick={run(() => notDoneTarget(target, also))}
            />
          )}
          <Option icon={<CalendarClock className="size-5 text-accent" />} label="Reschedule" hint="Pick a new time" onClick={openReschedule} />
          <Option icon={<Ban className="size-5 text-muted" />} label="Cancel it" hint={target.kind === 'revision' ? 'Skip this revision' : 'Remove from plan'} onClick={run(() => cancelTarget(target, also))} />
        </div>
      )}

      {step === 'reschedule' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date" className={hasTime(target) ? '' : 'col-span-2'}>
              <Input type="date" value={date} min={todayISO()} onChange={(e) => setDate(e.target.value)} />
            </Field>
            {hasTime(target) && (
              <Field label="Time">
                <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
              </Field>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => (start === 'reschedule' ? close() : setStep('menu'))}>
              {start === 'reschedule' ? 'Cancel' : 'Back'}
            </Button>
            <Button
              variant="primary"
              disabled={!date}
              onClick={run(() =>
                apply((t) => moveTo(t, date, time || null), all, `${title} moved to ${new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}`),
              )}
            >
              Reschedule
            </Button>
          </div>
        </div>
      )}

      {step === 'rate' && target.kind === 'revision' && (
        <RatingButtons
          onRate={async (r: RecallRating) => {
            const msg = await completeRevision(target.revision, r);
            for (const t of also) await complete(t);
            toast(msg, 'success');
            close();
          }}
        />
      )}
    </Modal>
  );
}

function Option({ icon, label, hint, onClick }: { icon: React.ReactNode; label: string; hint?: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex flex-col items-center gap-1.5 rounded-2xl bg-surface-2 px-2 py-4 text-sm font-medium transition-colors hover:bg-accent-soft active:scale-[0.98]">
      {icon}
      {label}
      {hint && <span className="text-xs font-normal text-muted">{hint}</span>}
    </button>
  );
}

/**
 * Todos: every actionable thing in one list — today's classes, tasks, study and
 * catch-up sessions, due revisions, assignments and personal items, each listed
 * once. Revisions created by the spaced-repetition schedule appear here
 * automatically on their due date. Every row has feedback: done, not done,
 * reschedule or cancel.
 */
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { BookOpenCheck, CalendarClock, CheckSquare, ClipboardList, FilePlus2, Plus, Repeat, Timer, UserRound } from 'lucide-react';
import { addDays, diffDays, formatTime12, rankTasks, type RecallRating, type RevisionSchedule, type Task } from '@student-os/core';
import { AskAI } from '../components/AskAI';
import { ClassRow } from '../components/ClassRow';
import { complete, completeTarget, FeedbackButton, type FeedbackTarget } from '../components/ItemFeedback';
import { Card, Checkbox, Chip, cn, EmptyState, Modal, PageHeader, SubjectDot, Tabs } from '../components/ui';
import { completeRevision } from '../lib/actions';
import { normTitle } from '../lib/plan';
import { useAll, useOccurrences, useSubjectMap, useToday } from '../lib/hooks';
import { create, update } from '../lib/repo';
import { toast } from '../lib/store';
import { RatingButtons } from './Revision';

type View = 'today' | 'upcoming' | 'overdue';
type Filter = 'all' | 'study' | 'revision' | 'assignments' | 'personal';

const PERSONAL = new Set(['Personal', 'Health']);
const isPersonal = (t: Task) => PERSONAL.has(t.category);

interface Item {
  key: string;
  kind: 'task' | 'session' | 'revision' | 'assignment' | 'exam';
  title: string;
  date: string | null;
  time?: string | null;
  subjectId: string | null;
  done: boolean;
  personal?: boolean;
  task?: Task;
  revision?: RevisionSchedule;
  meta?: string;
  target: FeedbackTarget;
  /** Duplicates folded into this row; feedback applies to them too. */
  also?: FeedbackTarget[];
}

const KIND_ICON = { task: CheckSquare, session: Timer, revision: Repeat, assignment: FilePlus2, exam: ClipboardList } as const;

/** Missed study sessions stay on the list this long, so they can be rescheduled or cancelled. */
const SESSION_LOOKBACK = 14;

/**
 * The same piece of work can exist twice (e.g. a "Study Maths" task and a "Study Maths"
 * session, or a "Revise X" task next to the scheduled revision). Keep one per title and day,
 * preferring the scheduled one; feedback on the row applies to the copies too.
 */
const KIND_RANK = { session: 0, revision: 1, assignment: 2, exam: 3, task: 4 } as const;

function dedupe(items: Item[]): Item[] {
  const groups = new Map<string, Item[]>();
  for (const i of items) {
    const key = i.kind === 'exam' ? i.key : `${normTitle(i.title)}|${i.date ?? ''}`;
    groups.set(key, [...(groups.get(key) ?? []), i]);
  }
  return [...groups.values()].map((group) => {
    // An open copy wins over a finished one, so nothing unfinished is hidden behind a tick.
    const [main, ...rest] = [...group].sort((a, b) => Number(a.done) - Number(b.done) || KIND_RANK[a.kind] - KIND_RANK[b.kind]);
    return rest.length ? { ...main!, also: rest.filter((i) => !i.done).map((i) => i.target) } : main!;
  });
}

function dayLabel(date: string, today: string) {
  const d = diffDays(today, date);
  if (d === 0) return 'Today';
  if (d === 1) return 'Tomorrow';
  if (d === -1) return 'Yesterday';
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

export default function Todos() {
  const today = useToday();
  const subjects = useSubjectMap();
  const classes = useOccurrences(today, today) ?? [];
  const tasks = useAll('task') ?? [];
  const revisions = useAll('revisionSchedule') ?? [];
  const topics = useAll('topic') ?? [];
  const assignments = useAll('assignment') ?? [];
  const exams = useAll('exam') ?? [];
  const events = useAll('calendarEvent') ?? [];
  const [view, setView] = useState<View>('today');
  const [filter, setFilter] = useState<Filter>('all');
  const [rating, setRating] = useState<RevisionSchedule | null>(null);
  const [ratingAlso, setRatingAlso] = useState<FeedbackTarget[]>([]);
  const [title, setTitle] = useState('');

  const topicTitle = (id: string) => topics.find((t) => t.id === id)?.title ?? 'Topic';
  const horizon = addDays(today, 14);

  // Build one list of everything actionable.
  const sessionFrom = addDays(today, -SESSION_LOOKBACK);
  const items: Item[] = dedupe([
    ...rankTasks(tasks, today).map(
      (t): Item => ({ key: `t${t.id}`, kind: 'task', title: t.title, date: t.plannedDate ?? t.dueDate, time: t.dueTime, subjectId: t.subjectId, done: false, personal: isPersonal(t), task: t, target: { kind: 'task', task: t } }),
    ),
    ...tasks
      .filter((t) => t.status === 'done' && t.completedAt?.slice(0, 10) === today)
      .map((t): Item => ({ key: `t${t.id}`, kind: 'task', title: t.title, date: today, subjectId: t.subjectId, done: true, personal: isPersonal(t), task: t, target: { kind: 'task', task: t } })),
    // Study and catch-up sessions, plus personal plans. Missed study sessions stay (as overdue)
    // until answered; other events simply pass.
    ...events
      .filter((e) =>
        e.completedAt
          ? e.completedAt.slice(0, 10) === today || e.date === today
          : e.type === 'study'
            ? e.date >= sessionFrom
            : e.date >= today,
      )
      .map(
        (e): Item => ({
          key: `e${e.id}`,
          kind: 'session',
          title: e.title,
          date: e.completedAt ? today : e.date,
          time: e.startTime,
          subjectId: e.subjectId,
          done: !!e.completedAt,
          personal: e.type !== 'study',
          meta: e.type === 'study' ? (e.title.startsWith('Catch up') ? 'Catch-up session' : 'Study session') : e.type === 'reminder' ? 'Reminder' : e.type === 'personal' ? 'Personal' : 'Event',
          target: { kind: 'event', event: e },
        }),
      ),
    ...revisions
      .filter((r) => r.status === 'pending' || (r.status === 'done' && r.completedAt?.slice(0, 10) === today))
      .map(
        (r): Item => ({
          key: `r${r.id}`,
          kind: 'revision',
          title: `Revise ${topicTitle(r.topicId)}`,
          date: r.status === 'done' ? today : r.dueDate,
          subjectId: r.subjectId,
          done: r.status === 'done',
          revision: r,
          meta: `Revision ${r.stage}`,
          target: { kind: 'revision', revision: r, title: `Revise ${topicTitle(r.topicId)}` },
        }),
      ),
    ...assignments.map(
      (a): Item => ({ key: `a${a.id}`, kind: 'assignment', title: a.title, date: a.deadline, time: a.deadlineTime, subjectId: a.subjectId, done: a.status === 'submitted', meta: a.status === 'in_progress' ? 'In progress' : undefined, target: { kind: 'assignment', assignment: a } }),
    ),
    ...exams.map((e): Item => ({ key: `x${e.id}`, kind: 'exam', title: e.title, date: e.date, time: e.startTime, subjectId: e.subjectId, done: e.date < today, target: { kind: 'exam', exam: e } })),
  ]);

  const matches = (i: Item) =>
    filter === 'all' ||
    (filter === 'study' && (i.kind === 'task' || i.kind === 'session') && !i.personal) ||
    (filter === 'revision' && i.kind === 'revision') ||
    (filter === 'assignments' && (i.kind === 'assignment' || i.kind === 'exam')) ||
    (filter === 'personal' && !!i.personal);

  const visible = items.filter(matches);
  const overdue = visible.filter((i) => !i.done && i.date && i.date < today && i.kind !== 'exam');
  const todayItems = visible.filter((i) => (i.date ? i.date <= today : i.kind === 'task') && !(i.kind === 'assignment' && i.done && i.date !== today) && !(i.kind === 'exam' && i.date !== today));
  const upcoming = visible.filter((i) => !i.done && i.date && i.date > today && i.date <= horizon);

  async function check(i: Item, value: boolean) {
    if (i.kind === 'revision' && i.revision) {
      if (value) {
        setRating(i.revision);
        setRatingAlso(i.also ?? []);
      }
      return;
    }
    if (value) return completeTarget(i.target, i.also);
    // Unticking: back to open.
    const t = i.target;
    if (t.kind === 'task') await update('task', t.task.id, { status: 'todo', completedAt: null });
    if (t.kind === 'event') await update('calendarEvent', t.event.id, { completedAt: null });
    if (t.kind === 'assignment') await update('assignment', t.assignment.id, { status: 'todo' });
  }

  async function addTask(e: React.FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;
    const date = view === 'upcoming' ? addDays(today, 1) : today;
    await create('task', { title: t, plannedDate: date, category: filter === 'personal' ? 'Personal' : 'Study' });
    setTitle('');
    toast(`Added to ${view === 'upcoming' ? 'tomorrow' : 'today'}`, 'success');
  }

  const row = (i: Item, showDate = false) => {
    const Icon = KIND_ICON[i.kind];
    const subject = i.subjectId ? subjects.get(i.subjectId) : undefined;
    const late = !i.done && i.date && i.date < today && i.kind !== 'exam';
    return (
      <li key={i.key} className="flex items-start gap-3 py-2.5">
        {i.kind === 'exam' ? (
          <span className="flex size-5 shrink-0 items-center justify-center text-muted">
            <Icon className="size-4" />
          </span>
        ) : (
          <Checkbox checked={i.done} label={`${i.done ? 'Undo' : 'Complete'} ${i.title}`} onChange={(v) => void check(i, v)} />
        )}
        <div className="min-w-0 flex-1">
          <div className={cn('text-sm font-medium', i.done && 'text-muted line-through')}>{i.title}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
            {subject && (
              <span className="inline-flex items-center gap-1">
                <SubjectDot color={subject.color} className="size-2" /> {subject.name}
              </span>
            )}
            {i.meta && <span>{i.meta}</span>}
            {i.kind === 'exam' && <span>Exam</span>}
            {(showDate || late) && i.date && <span className={cn(late && 'font-medium text-critical-ink')}>{late ? `${dayLabel(i.date, today)} · overdue` : dayLabel(i.date, today)}</span>}
            {i.time && <span>{formatTime12(i.time)}</span>}
          </div>
        </div>
        <Icon className="mt-1.5 size-4 shrink-0 text-muted/70" aria-hidden />
        <FeedbackButton target={i.target} also={i.also} className="-my-1 -mr-1.5" />
      </li>
    );
  };

  const section = (label: string, icon: ReactNode, list: Item[], showDate = false) =>
    list.length > 0 && (
      <Card key={label} className="py-3 sm:py-4">
        <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
          {icon} {label} <span className="ml-auto font-medium normal-case tracking-normal">{list.filter((i) => !i.done).length} open</span>
        </h2>
        <ul className="divide-y divide-line">{list.map((i) => row(i, showDate))}</ul>
      </Card>
    );

  const showClasses = view === 'today' && (filter === 'all' || filter === 'study') && classes.length > 0;
  const groups =
    view === 'today'
      ? [
          section('Study sessions', <Timer className="size-3.5" />, todayItems.filter((i) => i.kind === 'session' && !i.personal)),
          section('Tasks', <CheckSquare className="size-3.5" />, todayItems.filter((i) => i.kind === 'task' && !i.personal)),
          section('Revision', <Repeat className="size-3.5" />, todayItems.filter((i) => i.kind === 'revision')),
          section('Assignments & exams', <ClipboardList className="size-3.5" />, todayItems.filter((i) => i.kind === 'assignment' || i.kind === 'exam')),
          section('Personal', <UserRound className="size-3.5" />, todayItems.filter((i) => (i.kind === 'task' || i.kind === 'session') && i.personal)),
        ]
      : view === 'overdue'
        ? [section('Overdue', <CalendarClock className="size-3.5" />, overdue, true)]
        : [...new Set(upcoming.map((i) => i.date!))].sort().map((d) => section(dayLabel(d, today), <CalendarClock className="size-3.5" />, upcoming.filter((i) => i.date === d)));
  const empty = groups.every((g) => !g) && !showClasses;
  const openToday = todayItems.filter((i) => !i.done && i.kind !== 'exam').length;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Todos"
        subtitle={`${new Date(`${today}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })} · ${openToday} open today${overdue.length ? ` · ${overdue.length} overdue` : ''}`}
        actions={
          <Link to="/tasks" className="text-sm font-medium text-accent hover:underline">
            All tasks
          </Link>
        }
      />

      <AskAI placeholder="Prioritize my tasks…" prompts={['Prioritize my tasks for today', 'Plan my evening', 'Show all my pending work']} />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs
          value={view}
          onChange={setView}
          options={[
            { value: 'today', label: 'Today' },
            { value: 'upcoming', label: 'Upcoming' },
            { value: 'overdue', label: overdue.length ? `Overdue · ${overdue.length}` : 'Overdue' },
          ]}
        />
        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          {(['all', 'study', 'revision', 'assignments', 'personal'] as Filter[]).map((f) => (
            <Chip key={f} selected={filter === f} onClick={() => setFilter(f)} className="shrink-0">
              {f[0]!.toUpperCase() + f.slice(1)}
            </Chip>
          ))}
        </div>
      </div>

      {view !== 'overdue' && (
        <form onSubmit={addTask} className="flex items-center gap-2 rounded-2xl border border-dashed border-line bg-surface/60 px-3 py-1.5 focus-within:border-accent">
          <Plus className="size-4 shrink-0 text-muted" />
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={`Add a ${filter === 'personal' ? 'personal' : ''} task for ${view === 'upcoming' ? 'tomorrow' : 'today'}…`.replace('  ', ' ')}
            className="h-9 min-w-0 flex-1 bg-transparent text-base placeholder:text-muted focus:outline-none sm:text-sm"
            aria-label="New task"
          />
          {title.trim() && (
            <button type="submit" className="rounded-lg px-2 py-1 text-sm font-medium text-accent hover:bg-accent-soft">
              Add
            </button>
          )}
        </form>
      )}

      {showClasses && (
        <Card className="py-3 sm:py-4">
          <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
            <BookOpenCheck className="size-3.5" /> Classes
          </h2>
          <div className="divide-y divide-line">
            {classes.map((c) => (
              <ClassRow key={c.id} occ={c} subject={subjects.get(c.subjectId)} compact />
            ))}
          </div>
        </Card>
      )}

      <div className="space-y-4">{groups}</div>

      {empty && (
        <EmptyState
          title={view === 'overdue' ? 'Nothing overdue' : view === 'upcoming' ? 'Nothing planned for the next two weeks' : 'All clear for today'}
          body={view === 'today' ? 'Add a task above, or log a topic you learned to get revisions scheduled automatically.' : undefined}
        />
      )}

      <Modal open={!!rating} onClose={() => setRating(null)} title={`How well did you remember ${rating ? topicTitle(rating.topicId) : ''}?`}>
        <RatingButtons
          onRate={async (r: RecallRating) => {
            const msg = await completeRevision(rating!, r);
            for (const t of ratingAlso) await complete(t);
            toast(msg, 'success');
            setRating(null);
          }}
        />
      </Modal>
    </div>
  );
}

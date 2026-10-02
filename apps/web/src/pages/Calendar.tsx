import { useMemo, useState } from 'react';
import { BookOpen, CalendarClock, CheckSquare, ChevronLeft, ChevronRight, FileText, GraduationCap, Repeat, User, Bell, Star } from 'lucide-react';
import {
  addDays,
  addMonths,
  eachDay,
  endOfMonth,
  formatTime12,
  startOfMonth,
  startOfWeek,
  timeToMinutes,
  todayISO,
  WEEKDAY_SHORT,
  type ClassOccurrence,
  type ISODate,
} from '@student-os/core';
import { ClassRow } from '../components/ClassRow';
import { EventForm } from '../components/forms';
import { Button, Card, cn, Modal, PageHeader, Tabs } from '../components/ui';
import { useAll, useOccurrences, useSettings, useSubjectMap } from '../lib/hooks';

type View = 'day' | 'week' | 'month' | 'agenda';
type Kind = 'class' | 'study' | 'revision' | 'task' | 'exam' | 'assignment' | 'personal' | 'event' | 'reminder';

interface CalItem {
  id: string;
  date: ISODate;
  start: string | null;
  end: string | null;
  title: string;
  kind: Kind;
  color: string;
  done: boolean;
  occ?: ClassOccurrence;
}

const KIND_META: Record<Kind, { label: string; Icon: typeof BookOpen }> = {
  class: { label: 'Class', Icon: GraduationCap },
  study: { label: 'Study', Icon: BookOpen },
  revision: { label: 'Revision', Icon: Repeat },
  task: { label: 'Task', Icon: CheckSquare },
  exam: { label: 'Exam', Icon: Star },
  assignment: { label: 'Assignment', Icon: FileText },
  personal: { label: 'Personal', Icon: User },
  event: { label: 'Event', Icon: CalendarClock },
  reminder: { label: 'Reminder', Icon: Bell },
};

function useCalendarItems(from: ISODate, to: ISODate): CalItem[] {
  const subjects = useSubjectMap();
  const classes = useOccurrences(from, to) ?? [];
  const events = useAll('calendarEvent') ?? [];
  const revisions = useAll('revisionSchedule') ?? [];
  const topics = useAll('topic') ?? [];
  const tasks = useAll('task') ?? [];
  const exams = useAll('exam') ?? [];
  const assignments = useAll('assignment') ?? [];

  return useMemo(() => {
    const color = (id: string | null) => (id ? (subjects.get(id)?.color ?? '#888') : 'var(--muted)');
    const inRange = (d: string | null) => !!d && d >= from && d <= to;
    const topicTitle = new Map(topics.map((t) => [t.id, t.title]));
    const items: CalItem[] = [];
    for (const c of classes) {
      items.push({
        id: c.id,
        date: c.date,
        start: c.startTime,
        end: c.endTime,
        title: subjects.get(c.subjectId)?.name ?? 'Class',
        kind: 'class',
        color: color(c.subjectId),
        done: c.status === 'present',
        occ: c,
      });
    }
    for (const e of events) {
      if (!inRange(e.date)) continue;
      items.push({ id: e.id, date: e.date, start: e.startTime, end: e.endTime, title: e.title, kind: e.type, color: color(e.subjectId), done: !!e.completedAt });
    }
    for (const r of revisions) {
      if (r.status === 'skipped' || !topicTitle.has(r.topicId)) continue;
      const date = r.status === 'done' ? (r.completedAt?.slice(0, 10) ?? r.dueDate) : r.dueDate;
      if (!inRange(date)) continue;
      items.push({ id: r.id, date, start: null, end: null, title: `Revise ${topicTitle.get(r.topicId)}`, kind: 'revision', color: color(r.subjectId), done: r.status === 'done' });
    }
    for (const t of tasks) {
      const date = t.plannedDate ?? t.dueDate;
      if (!inRange(date)) continue;
      items.push({ id: t.id, date: date!, start: null, end: null, title: t.title, kind: 'task', color: color(t.subjectId), done: t.status === 'done' });
    }
    for (const e of exams) {
      if (!inRange(e.date)) continue;
      items.push({ id: e.id, date: e.date, start: e.startTime, end: null, title: e.title, kind: 'exam', color: color(e.subjectId), done: false });
    }
    for (const a of assignments) {
      if (!inRange(a.deadline)) continue;
      items.push({ id: a.id, date: a.deadline, start: null, end: null, title: `Due: ${a.title}`, kind: 'assignment', color: color(a.subjectId), done: a.status === 'submitted' });
    }
    return items.sort((a, b) => a.date.localeCompare(b.date) || (a.start ? timeToMinutes(a.start) : 9999) - (b.start ? timeToMinutes(b.start) : 9999));
  }, [classes, events, revisions, topics, tasks, exams, assignments, subjects, from, to]);
}

function ItemChip({ item, compact }: { item: CalItem; compact?: boolean }) {
  const { Icon, label } = KIND_META[item.kind];
  return (
    <div
      className={cn(
        'flex gap-1 rounded border-l-2 bg-surface-2 px-1 text-left',
        compact ? 'items-center truncate' : 'items-start',
        compact ? 'py-px text-[11px]' : 'py-1 text-xs',
        item.done && 'opacity-60',
        item.occ?.status === 'cancelled' || item.occ?.status === 'rescheduled' ? 'line-through opacity-50' : '',
      )}
      style={{ borderLeftColor: item.color }}
      title={`${label}: ${item.title}${item.start ? ` at ${formatTime12(item.start)}` : ''}`}
    >
      <Icon className={cn('size-3 shrink-0 text-muted', !compact && 'mt-0.5')} aria-label={label} />
      {!compact && item.start && <span className="shrink-0 text-ink-2 tabular">{formatTime12(item.start).replace(':00', '')}</span>}
      <span className={compact ? 'truncate' : 'line-clamp-2 break-words'}>{item.title}</span>
    </div>
  );
}

export default function CalendarPage() {
  const settings = useSettings();
  const subjects = useSubjectMap();
  const [view, setView] = useState<View>(() => (window.innerWidth < 768 ? 'agenda' : 'week'));
  const [cursor, setCursor] = useState(todayISO());
  const [adding, setAdding] = useState<ISODate | null>(null);
  const today = todayISO();
  const wk = settings.weekStartsOn;

  const [from, to] =
    view === 'day'
      ? [cursor, cursor]
      : view === 'week'
        ? [startOfWeek(cursor, wk), addDays(startOfWeek(cursor, wk), 6)]
        : view === 'month'
          ? [startOfWeek(startOfMonth(cursor), wk), addDays(startOfWeek(endOfMonth(cursor), wk), 6)]
          : [cursor, addDays(cursor, 20)];
  const items = useCalendarItems(from, to);
  const byDate = new Map<string, CalItem[]>();
  for (const i of items) {
    if (!byDate.has(i.date)) byDate.set(i.date, []);
    byDate.get(i.date)!.push(i);
  }

  const step = (dir: number) =>
    setCursor(view === 'day' ? addDays(cursor, dir) : view === 'week' ? addDays(cursor, 7 * dir) : view === 'month' ? addMonths(cursor, dir) : addDays(cursor, 21 * dir));
  const title =
    view === 'month'
      ? new Date(`${cursor}T12:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
      : view === 'day'
        ? new Date(`${cursor}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
        : `${from} – ${to}`;

  const dayLabel = (d: ISODate) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Calendar"
        actions={
          <Button variant="primary" size="sm" onClick={() => setAdding(view === 'day' ? cursor : today)}>
            Add session
          </Button>
        }
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button size="sm" variant="secondary" onClick={() => step(-1)} aria-label="Previous">
            <ChevronLeft className="size-4" />
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setCursor(today)}>
            Today
          </Button>
          <Button size="sm" variant="secondary" onClick={() => step(1)} aria-label="Next">
            <ChevronRight className="size-4" />
          </Button>
          <span className="ml-2 text-sm font-medium">{title}</span>
        </div>
        <Tabs
          value={view}
          onChange={setView}
          options={[
            { value: 'day', label: 'Day' },
            { value: 'week', label: 'Week' },
            { value: 'month', label: 'Month' },
            { value: 'agenda', label: 'Agenda' },
          ]}
        />
      </div>

      <div className="flex flex-wrap gap-3 text-xs text-ink-2">
        {(['class', 'study', 'revision', 'task', 'exam', 'assignment'] as Kind[]).map((k) => {
          const { Icon, label } = KIND_META[k];
          return (
            <span key={k} className="flex items-center gap-1">
              <Icon className="size-3.5 text-muted" /> {label}
            </span>
          );
        })}
      </div>

      {view === 'month' && (
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: 7 }, (_, i) => (
            <div key={i} className="py-1 text-center text-xs text-muted">
              {WEEKDAY_SHORT[(i + wk) % 7]}
            </div>
          ))}
          {eachDay(from, to).map((d) => {
            const list = byDate.get(d) ?? [];
            return (
              <button
                key={d}
                onClick={() => {
                  setCursor(d);
                  setView('day');
                }}
                className={cn(
                  'min-h-24 rounded-lg border border-line bg-surface p-1 text-left align-top hover:bg-surface-2',
                  !d.startsWith(cursor.slice(0, 7)) && 'opacity-40',
                  d === today && 'border-accent',
                )}
              >
                <div className={cn('mb-0.5 text-xs', d === today ? 'font-semibold text-accent' : 'text-ink-2')}>{Number(d.slice(8))}</div>
                <div className="space-y-0.5">
                  {list.slice(0, 3).map((i) => (
                    <ItemChip key={i.id} item={i} compact />
                  ))}
                  {list.length > 3 && <div className="text-[11px] text-muted">+{list.length - 3} more</div>}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {view === 'week' && (
        <div className="grid gap-2 md:grid-cols-7">
          {eachDay(from, to).map((d) => (
            <div key={d} className={cn('rounded-lg border border-line bg-surface p-2', d === today && 'border-accent')}>
              <button
                className={cn('mb-1.5 text-xs font-medium hover:underline', d === today ? 'text-accent' : 'text-ink-2')}
                onClick={() => {
                  setCursor(d);
                  setView('day');
                }}
              >
                {dayLabel(d)}
              </button>
              <div className="space-y-1">
                {(byDate.get(d) ?? []).map((i) => (
                  <ItemChip key={i.id} item={i} />
                ))}
                {!(byDate.get(d) ?? []).length && <div className="text-xs text-muted">—</div>}
              </div>
            </div>
          ))}
        </div>
      )}

      {view === 'day' && (
        <Card>
          {(byDate.get(cursor) ?? []).length === 0 ? (
            <p className="text-sm text-ink-2">Nothing scheduled.</p>
          ) : (
            <div className="divide-y divide-line">
              {(byDate.get(cursor) ?? []).map((i) =>
                i.occ ? (
                  <ClassRow key={i.id} occ={i.occ} subject={subjects.get(i.occ.subjectId)} />
                ) : (
                  <div key={i.id} className="flex items-center gap-3 py-2 text-sm">
                    <span className="w-16 shrink-0 text-xs text-ink-2 tabular">{i.start ? formatTime12(i.start) : 'Any time'}</span>
                    <div className="flex-1">
                      <ItemChip item={i} />
                    </div>
                  </div>
                ),
              )}
            </div>
          )}
        </Card>
      )}

      {view === 'agenda' && (
        <div className="space-y-3">
          {eachDay(from, to)
            .filter((d) => (byDate.get(d) ?? []).length)
            .map((d) => (
              <Card key={d}>
                <h3 className={cn('mb-2 text-sm font-semibold', d === today && 'text-accent')}>{d === today ? `Today · ${dayLabel(d)}` : dayLabel(d)}</h3>
                <div className="space-y-1">
                  {(byDate.get(d) ?? []).map((i) => (
                    <ItemChip key={i.id} item={i} />
                  ))}
                </div>
              </Card>
            ))}
          {items.length === 0 && <p className="text-sm text-ink-2">Nothing in the next three weeks.</p>}
        </div>
      )}

      <Modal open={!!adding} onClose={() => setAdding(null)} title="New study session or event">
        {adding && <EventForm onDone={() => setAdding(null)} defaultDate={adding} />}
      </Modal>
    </div>
  );
}

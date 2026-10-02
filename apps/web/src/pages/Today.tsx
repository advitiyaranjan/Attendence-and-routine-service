import { useState } from 'react';
import { Link } from 'react-router';
import { ChevronLeft, ChevronRight, Plus, Sparkles, Trash2 } from 'lucide-react';
import { addDays, formatTime12, todayISO, type ISODate, type RecallRating, type RevisionSchedule } from '@student-os/core';
import { ClassRow } from '../components/ClassRow';
import { EventForm, TaskForm } from '../components/forms';
import { RatingButtons } from './Revision';
import { Button, Card, Checkbox, EmptyState, Modal, PageHeader, SectionTitle, SubjectDot, Textarea } from '../components/ui';
import { completeRevision } from '../lib/actions';
import { useCopilot } from '../lib/copilot/store';
import { useAll, useOccurrences, useSubjectMap } from '../lib/hooks';
import { remove, update } from '../lib/repo';
import { toast, useApp } from '../lib/store';

/**
 * Natural-language capture, e.g. "finish OS scheduling and solve 15 DSA questions today".
 * Goes through Study Copilot, so every change is proposed and confirmed first.
 */
export function NaturalTaskInput({ date }: { date: ISODate }) {
  const [text, setText] = useState('');
  const online = useApp((s) => s.online);
  const { send, setOpen } = useCopilot();

  function run() {
    const t = text.trim();
    if (!t) return;
    setOpen(true);
    void send(date === todayISO() ? t : `For ${date}: ${t}`);
    setText('');
  }

  return (
    <Card>
      <SectionTitle>Plan in plain words</SectionTitle>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              run();
            }
          }}
          placeholder="Today I need to finish operating systems process scheduling and solve 15 DSA questions."
          className="min-h-12 flex-1"
          aria-label="Describe your plans"
        />
        <Button variant="primary" disabled={!online || !text.trim()} onClick={run} icon={<Sparkles className="size-4" />}>
          Create tasks
        </Button>
      </div>
      <p className="mt-1 text-xs text-muted">{online ? 'Copilot proposes the tasks; you confirm before anything is added.' : 'AI requires an internet connection. You can still add tasks with the + button.'}</p>
    </Card>
  );
}

export default function Today() {
  const [date, setDate] = useState(todayISO());
  const [adding, setAdding] = useState<'task' | 'event' | null>(null);
  const [rating, setRating] = useState<RevisionSchedule | null>(null);
  const subjects = useSubjectMap();
  const classes = useOccurrences(date, date) ?? [];
  const tasks = useAll('task') ?? [];
  const revisions = useAll('revisionSchedule') ?? [];
  const topics = useAll('topic') ?? [];
  const events = (useAll('calendarEvent') ?? []).filter((e) => e.date === date).sort((a, b) => (a.startTime ?? '99').localeCompare(b.startTime ?? '99'));
  const isToday = date === todayISO();

  const dayTasks = tasks.filter((t) => {
    const day = t.plannedDate ?? t.dueDate;
    if (t.status === 'done') return t.completedAt?.slice(0, 10) === date;
    return isToday ? !!day && day <= date : day === date;
  });
  const study = dayTasks.filter((t) => t.category !== 'Personal' && t.category !== 'Health');
  const personal = dayTasks.filter((t) => t.category === 'Personal' || t.category === 'Health');
  const dayRevisions = revisions.filter((r) =>
    r.status === 'done' ? r.completedAt?.slice(0, 10) === date : isToday ? r.dueDate <= date : r.dueDate === date,
  );
  const topicTitle = (id: string) => topics.find((t) => t.id === id)?.title ?? 'Topic';
  const label = new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  const toggleTask = (id: string, done: boolean) =>
    void update('task', id, done ? { status: 'done', completedAt: new Date().toISOString() } : { status: 'todo', completedAt: null });

  return (
    <div className="space-y-5">
      <PageHeader
        title={isToday ? "Today's plan" : 'Daily plan'}
        subtitle={label}
        actions={
          <>
            <Button size="sm" variant="secondary" onClick={() => setDate(addDays(date, -1))} aria-label="Previous day">
              <ChevronLeft className="size-4" />
            </Button>
            {!isToday && (
              <Button size="sm" variant="secondary" onClick={() => setDate(todayISO())}>
                Today
              </Button>
            )}
            <Button size="sm" variant="secondary" onClick={() => setDate(addDays(date, 1))} aria-label="Next day">
              <ChevronRight className="size-4" />
            </Button>
            <Link to="/review">
              <Button size="sm" variant="secondary">
                Daily review
              </Button>
            </Link>
          </>
        }
      />

      <NaturalTaskInput date={date} />

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <SectionTitle>Classes</SectionTitle>
          {classes.length === 0 ? (
            <p className="text-sm text-ink-2">No classes.</p>
          ) : (
            <div className="divide-y divide-line">
              {classes.map((c) => (
                <ClassRow key={c.id} occ={c} subject={subjects.get(c.subjectId)} compact />
              ))}
            </div>
          )}
        </Card>

        <Card>
          <SectionTitle
            action={
              <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => setAdding('event')}>
                Session
              </Button>
            }
          >
            Schedule
          </SectionTitle>
          {events.length === 0 ? (
            <p className="text-sm text-ink-2">No study sessions or events planned.</p>
          ) : (
            <ul className="space-y-1.5">
              {events.map((e) => (
                <li key={e.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={!!e.completedAt}
                    label={`Complete ${e.title}`}
                    onChange={(v) => void update('calendarEvent', e.id, { completedAt: v ? new Date().toISOString() : null })}
                  />
                  <span className="w-28 shrink-0 text-xs text-ink-2 tabular">
                    {e.startTime ? `${formatTime12(e.startTime)}${e.endTime ? `–${formatTime12(e.endTime)}` : ''}` : 'Any time'}
                  </span>
                  {e.subjectId && <SubjectDot color={subjects.get(e.subjectId)?.color ?? '#888'} />}
                  <span className={e.completedAt ? 'text-muted line-through' : ''}>{e.title}</span>
                  <button className="ml-auto text-muted hover:text-ink" aria-label="Delete" onClick={() => void remove('calendarEvent', e.id)}>
                    <Trash2 className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <SectionTitle
            action={
              <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => setAdding('task')}>
                Task
              </Button>
            }
          >
            Study goals
          </SectionTitle>
          <TaskChecklist tasks={study} onToggle={toggleTask} empty="No study goals yet." />
        </Card>

        <Card>
          <SectionTitle>Revision</SectionTitle>
          {dayRevisions.length === 0 ? (
            <p className="text-sm text-ink-2">No revisions due.</p>
          ) : (
            <ul className="space-y-1.5">
              {dayRevisions.map((r) => (
                <li key={r.id} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={r.status === 'done'} label={`Revise ${topicTitle(r.topicId)}`} onChange={(v) => v && setRating(r)} />
                  {r.subjectId && <SubjectDot color={subjects.get(r.subjectId)?.color ?? '#888'} />}
                  <span className={r.status === 'done' ? 'text-muted line-through' : ''}>Revise {topicTitle(r.topicId)}</span>
                  {r.status === 'pending' && r.dueDate < date && <span className="text-xs text-critical-ink">overdue</span>}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <SectionTitle>Personal</SectionTitle>
          <TaskChecklist tasks={personal} onToggle={toggleTask} empty='Add tasks in the "Personal" or "Health" category to see them here.' />
        </Card>
      </div>

      {classes.length === 0 && dayTasks.length === 0 && events.length === 0 && dayRevisions.length === 0 && (
        <EmptyState title="A clear day" body="Use the box above or the + button to plan it." />
      )}

      <Modal open={adding === 'task'} onClose={() => setAdding(null)} title="New task">
        <TaskForm onDone={() => setAdding(null)} defaultDate={date} />
      </Modal>
      <Modal open={adding === 'event'} onClose={() => setAdding(null)} title="New study session">
        <EventForm onDone={() => setAdding(null)} defaultDate={date} />
      </Modal>
      <Modal open={!!rating} onClose={() => setRating(null)} title={`How well did you remember ${rating ? topicTitle(rating.topicId) : ''}?`}>
        <RatingButtons
          onRate={async (r: RecallRating) => {
            const msg = await completeRevision(rating!, r);
            toast(msg, 'success');
            setRating(null);
          }}
        />
      </Modal>
    </div>
  );
}

function TaskChecklist({ tasks, onToggle, empty }: { tasks: Array<{ id: string; title: string; status: string; dueDate: string | null }>; onToggle: (id: string, done: boolean) => void; empty: string }) {
  if (tasks.length === 0) return <p className="text-sm text-ink-2">{empty}</p>;
  return (
    <ul className="space-y-1.5">
      {tasks.map((t) => (
        <li key={t.id} className="flex items-center gap-2 text-sm">
          <Checkbox checked={t.status === 'done'} label={`Complete ${t.title}`} onChange={(v) => onToggle(t.id, v)} />
          <span className={t.status === 'done' ? 'text-muted line-through' : ''}>{t.title}</span>
        </li>
      ))}
    </ul>
  );
}

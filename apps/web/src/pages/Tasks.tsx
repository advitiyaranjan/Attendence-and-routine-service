import { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { formatMinutes, rankTasks, type PriorityLevel, type Task } from '@student-os/core';
import { TaskForm } from '../components/forms';
import { Badge, Button, Card, Checkbox, EmptyState, Modal, PageHeader, SubjectDot, Tabs, cn } from '../components/ui';
import { useAll, useSubjectMap, useToday } from '../lib/hooks';
import { remove, update } from '../lib/repo';
import { toast } from '../lib/store';
import { NaturalTaskInput } from './Today';

type Filter = 'priority' | 'today' | 'upcoming' | 'done';

const LEVEL_LABEL: Record<PriorityLevel, string> = { critical: 'Top priority', high: 'High', medium: 'Medium', low: 'Low' };

export default function Tasks() {
  const today = useToday();
  const tasks = useAll('task') ?? [];
  const subjects = useSubjectMap();
  const [filter, setFilter] = useState<Filter>('priority');
  const [editing, setEditing] = useState<Task | 'new' | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const ranked = rankTasks(tasks, today);
  const list =
    filter === 'priority'
      ? ranked
      : filter === 'today'
        ? ranked.filter((t) => (t.plannedDate ?? t.dueDate ?? '9999') <= today)
        : filter === 'upcoming'
          ? ranked.filter((t) => (t.plannedDate ?? t.dueDate ?? '') > today)
          : [];
  const done = tasks.filter((t) => t.status === 'done').sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));
  const overdue = tasks.filter((t) => t.status !== 'done' && t.dueDate && t.dueDate < today).length;
  const dueToday = tasks.filter((t) => t.status !== 'done' && t.dueDate === today).length;

  async function toggle(t: Task, value: boolean) {
    await update('task', t.id, value ? { status: 'done', completedAt: new Date().toISOString() } : { status: 'todo', completedAt: null });
    if (value) toast(`Completed: ${t.title}`, 'success', { label: 'Undo', run: () => void update('task', t.id, { status: t.status, completedAt: null }) });
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Tasks"
        subtitle={`${dueToday} due today · ${overdue} overdue`}
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
            Task
          </Button>
        }
      />
      <NaturalTaskInput date={today} />
      <Tabs
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'priority', label: 'By priority' },
          { value: 'today', label: 'Today' },
          { value: 'upcoming', label: 'Upcoming' },
          { value: 'done', label: 'Completed' },
        ]}
      />

      <Card className="p-0">
        {filter !== 'done' && list.length === 0 && (
          <div className="p-4">
            <EmptyState title="Nothing here" body="Add a task, or describe your plans in plain words above." />
          </div>
        )}
        <ul className="divide-y divide-line">
          {filter !== 'done' &&
            list.map((t) => {
              const subject = t.subjectId ? subjects.get(t.subjectId) : undefined;
              const open = expanded === t.id;
              return (
                <li key={t.id} className="px-4 py-3">
                  <div className="flex items-start gap-3">
                    <div className="pt-0.5">
                      <Checkbox checked={false} onChange={(v) => void toggle(t, v)} label={`Complete ${t.title}`} />
                    </div>
                    <button className="min-w-0 flex-1 text-left" onClick={() => setExpanded(open ? null : t.id)} aria-expanded={open}>
                      <div className="text-sm font-medium">{t.title}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                        <Badge className={cn(t.priorityScore.level === 'critical' && 'text-critical-ink')}>{LEVEL_LABEL[t.priorityScore.level]}</Badge>
                        {subject && (
                          <span className="flex items-center gap-1">
                            <SubjectDot color={subject.color} className="size-2" /> {subject.name}
                          </span>
                        )}
                        {t.dueDate && <span className={cn(t.dueDate < today && 'text-critical-ink')}>Due {t.dueDate}</span>}
                        {t.estimatedMinutes ? <span>~{formatMinutes(t.estimatedMinutes)}</span> : null}
                        <span>{t.category}</span>
                        {t.source === 'ai' && <span>· AI</span>}
                      </div>
                      {open && (
                        <div className="mt-2 rounded-lg bg-surface-2 p-2 text-xs text-ink-2">
                          <div className="mb-1 font-medium text-ink">Why it's ranked here (score {t.priorityScore.score})</div>
                          <ul className="list-disc pl-4">
                            {t.priorityScore.reasons.map((r) => (
                              <li key={r}>{r}</li>
                            ))}
                          </ul>
                          {t.notes && <p className="mt-2 whitespace-pre-wrap">{t.notes}</p>}
                        </div>
                      )}
                    </button>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" aria-label="Edit task" onClick={() => setEditing(t)}>
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label="Delete task"
                        onClick={async () => {
                          await remove('task', t.id);
                          toast('Task deleted', 'info', { label: 'Undo', run: () => void update('task', t.id, { deletedAt: null }) });
                        }}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>
                </li>
              );
            })}
          {filter === 'done' &&
            done.slice(0, 100).map((t) => (
              <li key={t.id} className="flex items-center gap-3 px-4 py-2.5">
                <Checkbox checked onChange={(v) => void toggle(t, v)} label={`Mark ${t.title} not done`} />
                <span className="flex-1 text-sm text-muted line-through">{t.title}</span>
                <span className="text-xs text-muted">{t.completedAt?.slice(0, 10)}</span>
              </li>
            ))}
        </ul>
        {filter === 'done' && done.length === 0 && <p className="p-4 text-sm text-ink-2">No completed tasks yet.</p>}
      </Card>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing === 'new' ? 'New task' : 'Edit task'}>
        {editing && <TaskForm initial={editing === 'new' ? undefined : editing} onDone={() => setEditing(null)} />}
      </Modal>
    </div>
  );
}

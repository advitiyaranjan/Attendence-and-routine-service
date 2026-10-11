/** Create/edit forms for goals and milestones. */
import { useState, type FormEvent, type ReactNode } from 'react';
import { ArrowLeft, Plus, Sparkles, Trash2, Wand2 } from 'lucide-react';
import { addDays, diffDays, GOAL_CATEGORIES, goalCategory, MILESTONE_TEMPLATES, todayISO, type Goal, type Milestone, type TaskPriority } from '@student-os/core';
import { createGoal, updateGoal, addMilestone, updateMilestone, type MilestoneDraft } from '../../lib/goals';
import { useAll } from '../../lib/hooks';
import { toast } from '../../lib/store';
import { Button, Chip, cn, Field, Input, Select, Textarea } from '../ui';

const PRIORITIES: TaskPriority[] = ['low', 'medium', 'high', 'urgent'];
const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);

function PriorityPicker({ value, onChange }: { value: TaskPriority; onChange: (p: TaskPriority) => void }) {
  return (
    <div className="grid grid-cols-4 gap-1 rounded-xl bg-surface-2 p-1">
      {PRIORITIES.map((p) => (
        <button
          key={p}
          type="button"
          aria-pressed={value === p}
          onClick={() => onChange(p)}
          className={cn('rounded-lg py-1.5 text-sm transition-colors', value === p ? 'bg-surface font-medium text-ink shadow-card' : 'text-ink-2 hover:text-ink')}
        >
          {cap(p)}
        </button>
      ))}
    </div>
  );
}

/** Built-in categories plus the student's own (from earlier goals), and a field for a new one. */
function CategoryPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  const goals = useAll('goal') ?? [];
  const builtIn = new Set(GOAL_CATEGORIES.map((c) => c.key));
  const custom = [...new Set(goals.map((g) => g.category).filter((c) => !builtIn.has(c)))];
  const [typing, setTyping] = useState(!builtIn.has(value) && !custom.includes(value));
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {[...GOAL_CATEGORIES, ...custom.map(goalCategory)].map((c) => (
          <Chip
            key={c.key}
            selected={!typing && value === c.key}
            onClick={() => {
              setTyping(false);
              onChange(c.key);
            }}
            className="h-8 px-3 text-[13px]"
          >
            <span aria-hidden>{c.icon}</span> {c.label}
          </Chip>
        ))}
        <Chip selected={typing} onClick={() => setTyping(true)} className="h-8 px-3 text-[13px]">
          <Plus className="size-3.5" /> Custom
        </Chip>
      </div>
      {typing && <Input autoFocus value={builtIn.has(value) ? '' : value} onChange={(e) => onChange(e.target.value.slice(0, 50))} placeholder="Name your category, e.g. Music" />}
    </div>
  );
}

/** Spreads n milestones evenly between start and target (or a week apart with no target). */
function spreadDates(n: number, start: string, target: string | null): Array<string | null> {
  if (!target) return Array.from({ length: n }, () => null);
  const span = Math.max(n, diffDays(start, target));
  return Array.from({ length: n }, (_, i) => addDays(start, Math.round((span * (i + 1)) / n)));
}

function Footer({ children }: { children: ReactNode }) {
  return <div className="flex items-center justify-between gap-2 pt-3">{children}</div>;
}

/** New goal in two light steps: what and when, then (optional) milestones. */
export function NewGoalForm({ onDone, initialTitle = '', initialCategory = 'career' }: { onDone: (goal: Goal | null) => void; initialTitle?: string; initialCategory?: string }) {
  const [step, setStep] = useState<1 | 2>(1);
  const [title, setTitle] = useState(initialTitle);
  const [category, setCategory] = useState(initialCategory);
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [startDate, setStartDate] = useState(todayISO());
  const [targetDate, setTargetDate] = useState('');
  const [description, setDescription] = useState('');
  const [milestones, setMilestones] = useState<MilestoneDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const template = MILESTONE_TEMPLATES[category];
  const dateError = targetDate && targetDate < startDate ? 'The target date is before the start date.' : null;

  const suggest = () => {
    if (!template) return;
    const dates = spreadDates(template.length, startDate, targetDate || null);
    setMilestones(template.map((t, i) => ({ title: t, startDate: i === 0 ? startDate : dates[i - 1] ? addDays(dates[i - 1]!, 1) : null, targetDate: dates[i] ?? null })));
  };
  const setRow = (i: number, patch: Partial<MilestoneDraft>) => setMilestones((ms) => ms.map((m, k) => (k === i ? { ...m, ...patch } : m)));

  async function save() {
    if (busy) return;
    setBusy(true);
    try {
      const goal = await createGoal(
        { title: title.trim(), category: category.trim() || 'career', priority, startDate, targetDate: targetDate || null, description: description.trim() || null },
        milestones,
      );
      toast(`Goal created: ${goal.title}`, 'success');
      onDone(goal);
    } catch (e) {
      console.error(e);
      toast("Couldn't save the goal. Check the fields and try again.", 'error');
      setBusy(false);
    }
  }

  function next(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || dateError) return;
    setStep(2);
  }

  if (step === 1) {
    return (
      <form onSubmit={next} className="space-y-4">
        <Field label="What do you want to achieve?">
          <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Land a software engineering internship" maxLength={200} required />
        </Field>
        <Field label="Category" group>
          <CategoryPicker value={category} onChange={setCategory} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start">
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value || todayISO())} />
          </Field>
          <Field label="Target date">
            <Input type="date" value={targetDate} min={startDate} onChange={(e) => setTargetDate(e.target.value)} />
          </Field>
        </div>
        {dateError && <p className="text-xs text-critical-ink">{dateError}</p>}
        <Field label="Priority" group>
          <PriorityPicker value={priority} onChange={setPriority} />
        </Field>
        <Field label="Why it matters (optional)">
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What does reaching it look like?" maxLength={5000} />
        </Field>
        <Footer>
          <span className="text-xs text-muted">Step 1 of 2</span>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={() => onDone(null)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={!title.trim() || !!dateError}>
              Next: milestones
            </Button>
          </div>
        </Footer>
      </form>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-surface-2 p-3">
        <div className="text-xs text-muted">{goalCategory(category).label}</div>
        <div className="font-medium">{title}</div>
        <div className="text-xs text-ink-2">{targetDate ? `By ${new Date(`${targetDate}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}` : 'No target date'}</div>
      </div>
      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Milestones</h3>
          {template && milestones.length === 0 && (
            <Button size="sm" variant="secondary" icon={<Wand2 className="size-4 text-accent" />} onClick={suggest}>
              Suggest
            </Button>
          )}
        </div>
        <p className="mb-3 text-xs text-ink-2">The big stages between today and your goal, each with a start and end date. You can add tasks to each one later.{template && milestones.length === 0 ? ' Tap Suggest for a starting point you can edit.' : ''}</p>
        <ol className="space-y-2">
          {milestones.map((m, i) => (
            <li key={i} className="flex items-start gap-2 rounded-2xl border border-line p-2 sm:items-center sm:border-0 sm:p-0">
              <span className="mt-2 flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent tabular sm:mt-0">{i + 1}</span>
              <div className="flex min-w-0 flex-1 flex-col gap-1.5 sm:flex-row sm:items-center">
                <Input value={m.title} onChange={(e) => setRow(i, { title: e.target.value })} placeholder="Milestone" aria-label={`Milestone ${i + 1}`} maxLength={200} className="min-w-0 sm:flex-1" />
                <div className="flex items-center gap-1.5">
                  <Input type="date" value={m.startDate ?? ''} onChange={(e) => setRow(i, { startDate: e.target.value || null })} aria-label={`Milestone ${i + 1} start date`} title="Start" className="min-w-0 flex-1 px-2 sm:w-[9.5rem] sm:flex-none" />
                  <span className="text-xs text-muted" aria-hidden>
                    →
                  </span>
                  <Input type="date" value={m.targetDate ?? ''} min={m.startDate ?? undefined} onChange={(e) => setRow(i, { targetDate: e.target.value || null })} aria-label={`Milestone ${i + 1} end date`} title="End" className="min-w-0 flex-1 px-2 sm:w-[9.5rem] sm:flex-none" />
                  <Button size="icon" variant="ghost" className="size-9" aria-label={`Remove milestone ${i + 1}`} onClick={() => setMilestones((ms) => ms.filter((_, k) => k !== i))}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ol>
        <Button size="sm" variant="ghost" className="mt-2" icon={<Plus className="size-4" />} onClick={() => setMilestones((ms) => [...ms, { title: '', targetDate: null }])}>
          Add milestone
        </Button>
      </div>
      <Footer>
        <Button variant="ghost" icon={<ArrowLeft className="size-4" />} onClick={() => setStep(1)}>
          Back
        </Button>
        <Button variant="primary" loading={busy} icon={<Sparkles className="size-4" />} onClick={() => void save()}>
          {milestones.some((m) => m.title.trim()) ? 'Create goal' : 'Create without milestones'}
        </Button>
      </Footer>
    </div>
  );
}

/** Edit a goal's details, status and how its progress is measured. */
export function EditGoalForm({ goal, onDone }: { goal: Goal; onDone: () => void }) {
  const [title, setTitle] = useState(goal.title);
  const [icon, setIcon] = useState(goal.icon);
  const [category, setCategory] = useState(goal.category);
  const [priority, setPriority] = useState(goal.priority);
  const [startDate, setStartDate] = useState(goal.startDate);
  const [targetDate, setTargetDate] = useState(goal.targetDate ?? '');
  const [description, setDescription] = useState(goal.description ?? '');
  const [mode, setMode] = useState(goal.progressMode);
  const [manual, setManual] = useState(goal.manualProgress);
  const [busy, setBusy] = useState(false);
  const dateError = targetDate && targetDate < startDate ? 'The target date is before the start date.' : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !title.trim() || dateError) return;
    setBusy(true);
    try {
      await updateGoal(goal.id, {
        title: title.trim(),
        icon: icon.trim() || goalCategory(category).icon,
        category: category.trim() || 'career',
        color: goalCategory(category).color,
        priority,
        startDate,
        targetDate: targetDate || null,
        description: description.trim() || null,
        progressMode: mode,
        manualProgress: Math.round(manual),
      });
      toast('Goal updated', 'success');
      onDone();
    } catch (err) {
      console.error(err);
      toast("Couldn't save. Check the fields and try again.", 'error');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="flex gap-2">
        <Field label="Icon" className="w-16 shrink-0">
          <Input value={icon} onChange={(e) => setIcon([...e.target.value].slice(-2).join(''))} className="text-center" aria-label="Goal icon (emoji)" />
        </Field>
        <Field label="Goal" className="flex-1">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required />
        </Field>
      </div>
      <Field label="Category" group>
        <CategoryPicker value={category} onChange={setCategory} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Start">
          <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value || goal.startDate)} />
        </Field>
        <Field label="Target date" hint="Missed it? Move it here and keep going.">
          <Input type="date" value={targetDate} min={startDate} onChange={(e) => setTargetDate(e.target.value)} />
        </Field>
      </div>
      {dateError && <p className="text-xs text-critical-ink">{dateError}</p>}
      <Field label="Priority" group>
        <PriorityPicker value={priority} onChange={setPriority} />
      </Field>
      <Field label="Description">
        <Textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={5000} />
      </Field>
      <Field label="Progress" group hint={mode === 'auto' ? 'Calculated from milestones and their tasks.' : 'Set by you, for goals a checklist can’t measure. Milestones and tasks still show on the roadmap.'}>
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-surface-2 p-1">
          {(['auto', 'manual'] as const).map((m) => (
            <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)} className={cn('rounded-lg py-1.5 text-sm', mode === m ? 'bg-surface font-medium shadow-card' : 'text-ink-2')}>
              {m === 'auto' ? 'Automatic' : 'Manual'}
            </button>
          ))}
        </div>
        {mode === 'manual' && (
          <div className="mt-3 flex items-center gap-3">
            <input type="range" min={0} max={100} step={5} value={manual} onChange={(e) => setManual(Number(e.target.value))} className="flex-1 accent-[var(--accent)]" aria-label="Manual progress" />
            <span className="w-12 text-right text-sm font-semibold tabular">{manual}%</span>
          </div>
        )}
      </Field>
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={busy} disabled={!title.trim() || !!dateError}>
          Save
        </Button>
      </div>
    </form>
  );
}

export function MilestoneForm({ goal, initial, onDone }: { goal: Goal; initial?: Milestone; onDone: () => void }) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [startDate, setStartDate] = useState(initial?.startDate ?? '');
  const [targetDate, setTargetDate] = useState(initial?.targetDate ?? '');
  const [priority, setPriority] = useState<TaskPriority>(initial?.priority ?? 'medium');
  const [status, setStatus] = useState<Milestone['status']>(initial?.status ?? 'todo');
  const [manual, setManual] = useState(initial?.manualProgress ?? null);
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const afterGoal = targetDate && goal.targetDate && targetDate > goal.targetDate;
  const dateError = startDate && targetDate && targetDate < startDate ? 'The end date is before the start date.' : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !title.trim() || dateError) return;
    setBusy(true);
    try {
      const data = {
        title: title.trim(),
        description: description.trim() || null,
        startDate: startDate || null,
        targetDate: targetDate || null,
        priority,
        status,
        manualProgress: manual,
        notes: notes.trim() || null,
        completedAt: status === 'done' ? (initial?.completedAt ?? new Date().toISOString()) : null,
      };
      if (initial) await updateMilestone(initial.id, data);
      else await addMilestone(goal.id, data);
      toast(initial ? 'Milestone updated' : 'Milestone added', 'success');
      onDone();
    } catch (err) {
      console.error(err);
      toast("Couldn't save. Check the fields and try again.", 'error');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Milestone">
        <Input autoFocus={!initial} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Finish 150 DSA problems" maxLength={200} required />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Start date">
          <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </Field>
        <Field label="End date">
          <Input type="date" value={targetDate} min={startDate || undefined} onChange={(e) => setTargetDate(e.target.value)} />
        </Field>
      </div>
      {dateError && <p className="text-xs text-critical-ink">{dateError}</p>}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Status">
          <Select value={status} onChange={(e) => setStatus(e.target.value as Milestone['status'])}>
            <option value="todo">Not started</option>
            <option value="in_progress">In progress</option>
            <option value="blocked">Blocked</option>
            <option value="done">Completed</option>
          </Select>
        </Field>
      </div>
      {afterGoal && <p className="text-xs text-warning-ink">This date is after the goal's target date ({goal.targetDate}).</p>}
      <Field label="Priority" group>
        <PriorityPicker value={priority} onChange={setPriority} />
      </Field>
      <Field label="Description">
        <Textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={5000} />
      </Field>
      <Field label="Progress without tasks" hint="Used only while this milestone has no tasks." group>
        <div className="flex items-center gap-3">
          <input type="range" min={0} max={100} step={5} value={manual ?? 0} onChange={(e) => setManual(Number(e.target.value))} className="flex-1 accent-[var(--accent)]" aria-label="Milestone progress" />
          <span className="w-12 text-right text-sm font-semibold tabular">{manual ?? 0}%</span>
        </div>
      </Field>
      <Field label="Notes">
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={5000} placeholder="Links, resources, what you learned…" />
      </Field>
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={busy} disabled={!title.trim() || !!dateError}>
          {initial ? 'Save' : 'Add milestone'}
        </Button>
      </div>
    </form>
  );
}

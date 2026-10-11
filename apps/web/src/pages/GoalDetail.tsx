/**
 * One goal: the journey from its start to its target as an interactive roadmap,
 * a date strip, a transparent pace check, every linked task, and notes/resources.
 */
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import {
  ArrowDown,
  ArrowUp,
  Ban,
  CalendarPlus,
  Check,
  ChevronDown,
  Clock3,
  ExternalLink,
  Flag,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  Trophy,
} from 'lucide-react';
import { diffDays, formatMinutes, milestoneProgress, milestoneState, WEEKDAY_SHORT, type Goal, type Milestone, type Task } from '@student-os/core';
import { EditGoalForm, MilestoneForm } from '../components/goals/GoalForms';
import { celebrate, CategoryTag, dueLabel, fmtDate, HealthPill, healthColor, MilestoneMarker, PriorityTag, ProgressRing, STATE_STYLE } from '../components/goals/visuals';
import { BackButton, Button, Card, Checkbox, cn, EmptyState, Field, Input, Meter, Modal, Select, Spinner, Tabs, Textarea, Toggle } from '../components/ui';
import { addGoalTask, deleteGoal, deleteMilestone, moveMilestone, planToday, setGoalStatus, setMilestoneStatus, summarizeGoal, toggleTask, updateGoal, useGoalData, type GoalSummary } from '../lib/goals';
import { useAll, useToday } from '../lib/hooks';
import { toast } from '../lib/store';

type View = 'roadmap' | 'tasks' | 'notes';

export default function GoalDetail() {
  const { id } = useParams();
  const data = useGoalData();
  const today = useToday();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const sessions = useAll('studySession') ?? [];
  const [view, setView] = useState<View>('roadmap');
  const [editing, setEditing] = useState(false);
  const [menu, setMenu] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [milestoneForm, setMilestoneForm] = useState<{ initial?: Milestone } | null>(null);
  const [achieved, setAchieved] = useState(false);
  const [open, setOpen] = useState<string | null>(params.get('m'));

  const goal = data?.goals.find((g) => g.id === id);
  const s = useMemo(() => (goal && data ? summarizeGoal(goal, data, today) : null), [goal, data, today]);

  // Opened from a link to one milestone (?m=): expand it once, then drop the parameter.
  useEffect(() => {
    const m = params.get('m');
    if (!m) return;
    setOpen(m);
    setView('roadmap');
    params.delete('m');
    setParams(params, { replace: true });
    setTimeout(() => document.getElementById(`ms-${m}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 150);
  }, [params, setParams]);

  if (!data) return <Spinner />;
  if (!goal || !s) {
    return (
      <EmptyState
        title="This goal doesn't exist any more"
        body="It may have been deleted on another device."
        action={
          <Link to="/goals">
            <Button>All goals</Button>
          </Link>
        }
      />
    );
  }

  const studied = sessions.filter((x) => x.goalId === goal.id).reduce((a, x) => a + x.durationMinutes, 0);
  const allMilestonesDone = s.milestones.length > 0 && s.milestones.every((m) => m.status === 'done');

  async function changeStatus(status: Goal['status']) {
    setMenu(false);
    await setGoalStatus(goal!, status);
    if (status === 'completed') {
      celebrate();
      setAchieved(true);
    } else toast(status === 'paused' ? 'Goal paused. Its deadlines are on hold.' : 'Goal is active again', 'success');
  }

  async function onMilestoneStatus(m: Milestone, status: Milestone['status']) {
    await setMilestoneStatus(m, status);
    if (status === 'done') {
      celebrate();
      const others = s!.milestones.filter((x) => x.id !== m.id);
      const last = others.every((x) => x.status === 'done');
      toast(
        last ? `Every milestone done! Ready to complete "${goal!.title}"?` : `Milestone reached: ${m.title}`,
        'success',
        last && goal!.status !== 'completed' ? { label: 'Complete goal', run: () => void changeStatus('completed') } : undefined,
      );
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1 text-sm text-ink-2">
          <BackButton fallback="/goals" />
          <Link to="/goals" className="hover:text-ink">
            Goals
          </Link>
        </div>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="secondary" icon={<Pencil className="size-3.5" />} onClick={() => setEditing(true)}>
            Edit
          </Button>
          <Button size="sm" variant="ghost" aria-label="More goal actions" onClick={() => setMenu(true)}>
            <MoreHorizontal className="size-4" />
          </Button>
        </div>
      </div>

      <Hero s={s} today={today} studied={studied} onComplete={allMilestonesDone && goal.status === 'active' ? () => void changeStatus('completed') : undefined} />

      {goal.targetDate && s.milestones.length > 0 && goal.status !== 'completed' && <DateStrip s={s} today={today} onPick={(mid) => { setView('roadmap'); setOpen(mid); setTimeout(() => document.getElementById(`ms-${mid}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50); }} />}

      <Tabs
        value={view}
        onChange={setView}
        options={[
          { value: 'roadmap', label: 'Roadmap' },
          { value: 'tasks', label: `Tasks${s.tasks.length ? ` · ${s.tasks.filter((t) => t.status !== 'done').length}` : ''}` },
          { value: 'notes', label: 'Notes' },
        ]}
      />

      {view === 'roadmap' && (
        <Roadmap
          s={s}
          today={today}
          open={open}
          setOpen={setOpen}
          onStatus={(m, st) => void onMilestoneStatus(m, st)}
          onEdit={(m) => setMilestoneForm({ initial: m })}
          onAdd={() => setMilestoneForm({})}
        />
      )}
      {view === 'tasks' && (
        <>
          <LinkedLectures goalId={goal.id} />
          <TaskList s={s} today={today} />
        </>
      )}
      {view === 'notes' && <NotesPanel goal={goal} />}

      <Modal open={editing} onClose={() => setEditing(false)} title="Edit goal">
        {editing && <EditGoalForm goal={goal} onDone={() => setEditing(false)} />}
      </Modal>

      <Modal open={!!milestoneForm} onClose={() => setMilestoneForm(null)} title={milestoneForm?.initial ? 'Edit milestone' : 'New milestone'}>
        {milestoneForm && (
          <MilestoneForm
            goal={goal}
            initial={milestoneForm.initial}
            onDone={() => setMilestoneForm(null)}
          />
        )}
      </Modal>

      <Modal open={menu} onClose={() => setMenu(false)} title={goal.title}>
        <div className="space-y-1">
          {goal.status !== 'completed' && (
            <MenuRow icon={<Trophy className="size-4 text-good-ink" />} onClick={() => void changeStatus('completed')}>
              Mark goal as achieved
            </MenuRow>
          )}
          {goal.status === 'active' && (
            <MenuRow icon={<Pause className="size-4" />} onClick={() => void changeStatus('paused')}>
              Pause goal
            </MenuRow>
          )}
          {goal.status !== 'active' && (
            <MenuRow icon={goal.status === 'completed' ? <RotateCcw className="size-4" /> : <Play className="size-4" />} onClick={() => void changeStatus('active')}>
              {goal.status === 'completed' ? 'Reopen goal' : 'Resume goal'}
            </MenuRow>
          )}
          <MenuRow
            icon={<Plus className="size-4" />}
            onClick={() => {
              setMenu(false);
              setMilestoneForm({});
            }}
          >
            Add milestone
          </MenuRow>
          <MenuRow
            icon={<Trash2 className="size-4 text-critical-ink" />}
            onClick={() => {
              setMenu(false);
              setDeleting(true);
            }}
          >
            <span className="text-critical-ink">Delete goal</span>
          </MenuRow>
        </div>
      </Modal>

      <DeleteGoal s={s} open={deleting} onClose={() => setDeleting(false)} onDeleted={() => navigate('/goals', { replace: true })} />

      <Modal open={achieved} onClose={() => setAchieved(false)} title="Goal achieved">
        <div className="text-center">
          <span className="mx-auto flex size-16 items-center justify-center rounded-2xl bg-good/15 text-good-ink">
            <Trophy className="size-8" />
          </span>
          <h3 className="mt-3 text-lg font-semibold">{goal.title}</h3>
          <p className="mt-1 text-sm text-ink-2">
            {diffDays(goal.startDate, today) > 0 ? `${diffDays(goal.startDate, today)} days from start to finish.` : 'Done.'} Well earned.
          </p>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <SummaryStat value={`${s.progress.milestonesDone}/${s.progress.milestonesTotal}`} label="milestones" />
            <SummaryStat value={String(s.progress.tasksDone)} label="tasks done" />
            <SummaryStat value={studied ? formatMinutes(studied) : '—'} label="studied" />
          </div>
          <Button variant="primary" className="mt-5 w-full" onClick={() => setAchieved(false)}>
            Close
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function SummaryStat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-xl bg-surface-2 px-2 py-2.5">
      <div className="text-lg font-semibold tabular">{value}</div>
      <div className="text-[11px] text-muted">{label}</div>
    </div>
  );
}

function MenuRow({ icon, onClick, children }: { icon: ReactNode; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm hover:bg-surface-2">
      {icon}
      {children}
    </button>
  );
}

function Hero({ s, today, studied, onComplete }: { s: GoalSummary; today: string; studied: number; onComplete?: () => void }) {
  const { goal, progress, health } = s;
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
      <div className="p-4 sm:p-6" style={{ background: `linear-gradient(135deg, color-mix(in srgb, ${goal.color} 12%, var(--surface)) 0%, var(--surface) 65%)` }}>
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-2xl" aria-hidden>
                {goal.icon}
              </span>
              <CategoryTag category={goal.category} />
            </div>
            <h1 className="mt-1.5 text-xl font-semibold leading-tight tracking-tight sm:text-2xl">{goal.title}</h1>
            {goal.description && <p className="mt-1.5 line-clamp-3 text-sm text-ink-2">{goal.description}</p>}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <HealthPill health={health} />
              <PriorityTag priority={goal.priority} />
              {goal.status === 'paused' && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-ink-2">Paused</span>}
            </div>
          </div>
          <div className="flex flex-col items-center gap-1">
            <ProgressRing value={progress.percent} size={84} stroke={8} color={goal.color} label={`${goal.title} progress`}>
              <span className="text-lg font-semibold tabular">{Math.round(progress.percent)}%</span>
            </ProgressRing>
            <span className="text-[11px] text-muted">{progress.mode === 'manual' ? 'set manually' : 'calculated'}</span>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <HeroStat label={goal.status === 'completed' ? 'Achieved' : 'Target'} value={goal.status === 'completed' ? (goal.completedAt ? fmtDate(goal.completedAt.slice(0, 10), true) : '—') : goal.targetDate ? fmtDate(goal.targetDate, true) : 'Not set'} sub={goal.status === 'active' && goal.targetDate ? dueLabel(goal.targetDate, today) : `Started ${fmtDate(goal.startDate)}`} />
          <HeroStat label="Milestones" value={`${progress.milestonesDone}/${progress.milestonesTotal}`} sub={s.current ? `Now: ${s.current.title}` : progress.milestonesTotal ? 'All done' : 'None yet'} />
          <HeroStat label="Tasks" value={`${progress.tasksDone}/${progress.tasksTotal}`} sub={progress.tasksTotal - progress.tasksDone ? `${progress.tasksTotal - progress.tasksDone} to go` : 'Nothing open'} />
          <HeroStat label="Study time" value={studied ? formatMinutes(studied) : '—'} sub="logged for this goal" />
        </div>
      </div>

      {goal.status === 'active' && (
        <div className="border-t border-line px-4 py-3 sm:px-6">
          {health.timeUsed !== null ? (
            <div className="space-y-2">
              <PaceBar label="Progress" value={progress.percent} color={goal.color} />
              <PaceBar label="Time used" value={health.timeUsed} color="var(--muted)" />
            </div>
          ) : null}
          <ul className="mt-2 space-y-0.5 text-xs text-ink-2">
            {health.reasons.map((r) => (
              <li key={r} className="flex items-start gap-1.5">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full" style={{ background: healthColor(health.level) }} aria-hidden />
                {r}
              </li>
            ))}
          </ul>
          {onComplete && (
            <Button variant="primary" size="sm" className="mt-3" icon={<Trophy className="size-4" />} onClick={onComplete}>
              Every milestone is done. Mark goal achieved
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function HeroStat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-line/70 bg-surface/80 px-3 py-2 backdrop-blur-sm">
      <div className="text-[11px] font-medium text-muted">{label}</div>
      <div className="truncate text-sm font-semibold tabular">{value}</div>
      <div className="truncate text-[11px] text-ink-2">{sub}</div>
    </div>
  );
}

function PaceBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-3 text-xs">
      <span className="w-16 shrink-0 text-ink-2">{label}</span>
      <div className="flex-1">
        <Meter value={value} color={color} label={label} />
      </div>
      <span className="w-9 shrink-0 text-right font-medium tabular">{Math.round(value)}%</span>
    </div>
  );
}

/** Start → target as a line, with each dated milestone placed on it and a "today" marker. */
function DateStrip({ s, today, onPick }: { s: GoalSummary; today: string; onPick: (id: string) => void }) {
  const { goal } = s;
  const start = goal.startDate;
  const end = goal.targetDate!;
  const dated = s.milestones.filter((m) => m.targetDate);
  const last = [end, ...dated.map((m) => m.targetDate!)].sort().at(-1)!;
  const span = Math.max(1, diffDays(start, last));
  const pos = (d: string) => Math.max(0, Math.min(100, (diffDays(start, d) / span) * 100));
  const todayPos = pos(today);
  return (
    <Card className="px-4 py-4 sm:px-6">
      <div className="mb-3 flex items-center justify-between text-xs text-ink-2">
        <span>Timeline</span>
        <span className="text-muted">{dated.length < s.milestones.length ? `${s.milestones.length - dated.length} milestone(s) without a date` : 'Tap a point to open it'}</span>
      </div>
      <div className="relative mx-2 h-10">
        <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-surface-2" />
        <div className="absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full" style={{ width: `${todayPos}%`, background: `color-mix(in srgb, ${goal.color} 55%, transparent)` }} />
        {last > end && <div className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-critical/40" style={{ left: `${pos(end)}%`, right: 0 }} title="After the target date" />}
        <div className="absolute top-0 h-full w-0.5 -translate-x-1/2 bg-ink" style={{ left: `${todayPos}%` }} title={`Today, ${fmtDate(today)}`} />
        <Flag className="absolute top-0 size-4 -translate-x-1/2 -translate-y-1" style={{ left: `${pos(end)}%`, color: goal.color }} aria-label={`Target ${fmtDate(end, true)}`} />
        {dated.map((m) => {
          const st = milestoneState(m, today, s.current?.id ?? null);
          return (
            <button
              key={m.id}
              onClick={() => onPick(m.id)}
              className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface shadow-sm transition-transform hover:scale-125 focus-visible:scale-125"
              style={{ left: `${pos(m.targetDate!)}%`, background: st === 'upcoming' ? 'var(--muted)' : STATE_STYLE[st].color }}
              aria-label={`${m.title}, ${fmtDate(m.targetDate!)}, ${STATE_STYLE[st].label}`}
              title={`${m.title} · ${fmtDate(m.targetDate!)}`}
            />
          );
        })}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-muted tabular">
        <span>{fmtDate(start)}</span>
        <span className="font-medium text-ink">Today</span>
        <span>{fmtDate(last, true)}</span>
      </div>
    </Card>
  );
}

function Roadmap({
  s,
  today,
  open,
  setOpen,
  onStatus,
  onEdit,
  onAdd,
}: {
  s: GoalSummary;
  today: string;
  open: string | null;
  setOpen: (id: string | null) => void;
  onStatus: (m: Milestone, status: Milestone['status']) => void;
  onEdit: (m: Milestone) => void;
  onAdd: () => void;
}) {
  const { goal, milestones } = s;
  const loose = s.tasks.filter((t) => !t.milestoneId || !milestones.some((m) => m.id === t.milestoneId));
  return (
    <div>
      <ol className="relative">
        <PathNode
          marker={<span className="flex size-8 items-center justify-center rounded-full bg-surface-2 text-ink-2"><Play className="size-3.5" /></span>}
          lineDone
        >
          <div className="pb-5 pt-1.5">
            <div className="text-sm font-medium">Start</div>
            <div className="text-xs text-muted">{fmtDate(goal.startDate, true)}</div>
          </div>
        </PathNode>

        {milestones.map((m, i) => {
          const st = milestoneState(m, today, s.current?.id ?? null);
          return (
            <PathNode key={m.id} marker={<MilestoneMarker state={st} index={i} />} lineDone={m.status === 'done'}>
              <MilestoneCard
                m={m}
                index={i}
                count={milestones.length}
                state={st}
                goal={goal}
                tasks={s.tasks.filter((t) => t.milestoneId === m.id)}
                today={today}
                expanded={open === m.id}
                onToggle={() => setOpen(open === m.id ? null : m.id)}
                onStatus={(x) => onStatus(m, x)}
                onEdit={() => onEdit(m)}
              />
            </PathNode>
          );
        })}

        <PathNode
          last
          marker={
            <span className="flex size-8 items-center justify-center rounded-full text-white shadow-sm" style={{ background: goal.status === 'completed' ? 'var(--color-good)' : goal.color }}>
              {goal.status === 'completed' ? <Trophy className="size-4" /> : <Flag className="size-4" />}
            </span>
          }
        >
          <div className="pt-1.5">
            <div className="text-sm font-semibold">{goal.status === 'completed' ? 'Goal achieved' : goal.title}</div>
            <div className="text-xs text-muted">
              {goal.status === 'completed' && goal.completedAt
                ? fmtDate(goal.completedAt.slice(0, 10), true)
                : goal.targetDate
                  ? `${fmtDate(goal.targetDate, true)} · ${dueLabel(goal.targetDate, today)}`
                  : 'No target date yet'}
            </div>
          </div>
        </PathNode>
      </ol>

      {milestones.length === 0 && <p className="mb-3 mt-2 text-sm text-ink-2">No milestones yet. Add the big stages between today and your goal, and the roadmap will draw itself.</p>}
      <Button variant="secondary" className="mt-4 w-full sm:w-auto" icon={<Plus className="size-4" />} onClick={onAdd}>
        Add milestone
      </Button>

      {loose.length > 0 && (
        <Card className="mt-5">
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Other tasks for this goal</h3>
          <ul className="divide-y divide-line">
            {loose.map((t) => (
              <GoalTaskRow key={t.id} task={t} today={today} />
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

/** One step on the vertical path: a marker, the connector to the next step, and content. */
function PathNode({ marker, children, lineDone, last }: { marker: ReactNode; children: ReactNode; lineDone?: boolean; last?: boolean }) {
  return (
    <li className="relative flex gap-3">
      <div className="relative flex w-8 shrink-0 flex-col items-center">
        <div className="relative z-10">{marker}</div>
        {!last && <div className={cn('mt-1 w-0.5 flex-1', lineDone ? 'bg-good' : 'border-l-2 border-dashed border-line bg-transparent')} aria-hidden />}
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </li>
  );
}

function MilestoneCard({
  m,
  index,
  count,
  state,
  goal,
  tasks,
  today,
  expanded,
  onToggle,
  onStatus,
  onEdit,
}: {
  m: Milestone;
  index: number;
  count: number;
  state: ReturnType<typeof milestoneState>;
  goal: Goal;
  tasks: Task[];
  today: string;
  expanded: boolean;
  onToggle: () => void;
  onStatus: (s: Milestone['status']) => void;
  onEdit: () => void;
}) {
  const p = milestoneProgress(m, tasks);
  const style = STATE_STYLE[state];
  const allTasksDone = tasks.length > 0 && p.tasksDone === tasks.length && m.status !== 'done';
  const [confirmDelete, setConfirmDelete] = useState(false);
  return (
    <div id={`ms-${m.id}`} className="pb-4">
      <div
        className={cn(
          'rounded-2xl border bg-surface shadow-card transition-colors',
          state === 'active' ? 'border-accent/40 ring-3 ring-accent/10' : 'border-line',
          state === 'done' && !expanded && 'bg-surface/70',
        )}
      >
        <button onClick={onToggle} className="flex w-full items-start gap-3 p-3.5 text-left" aria-expanded={expanded}>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: state === 'upcoming' ? 'var(--muted)' : style.color }}>
                {style.label}
              </span>
              {m.targetDate ? (
                <span className={cn('text-xs', state === 'overdue' ? 'font-medium text-critical-ink' : 'text-muted')}>
                  {state === 'done'
                    ? m.completedAt
                      ? `Done ${fmtDate(m.completedAt.slice(0, 10))}`
                      : fmtDate(m.targetDate)
                    : `${m.startDate ? `${fmtDate(m.startDate)} → ` : ''}${fmtDate(m.targetDate)} · ${dueLabel(m.targetDate, today)}`}
                </span>
              ) : (
                m.startDate && state !== 'done' && <span className="text-xs text-muted">{m.startDate > today ? `Starts ${fmtDate(m.startDate)}` : `From ${fmtDate(m.startDate)}`}</span>
              )}
            </div>
            <div className={cn('mt-0.5 font-medium leading-snug', state === 'done' && 'text-ink-2')}>{m.title}</div>
            {(p.tasksTotal > 0 || p.source === 'manual') && state !== 'done' && (
              <div className="mt-2 flex items-center gap-2">
                <div className="flex-1">
                  <Meter value={p.percent} color={goal.color} label={`${m.title} progress`} />
                </div>
                <span className="text-xs text-ink-2 tabular">{p.source === 'tasks' ? `${p.tasksDone}/${p.tasksTotal}` : `${Math.round(p.percent)}%`}</span>
              </div>
            )}
          </div>
          <ChevronDown className={cn('mt-1 size-4 shrink-0 text-muted transition-transform', expanded && 'rotate-180')} />
        </button>

        {expanded && (
          <div className="space-y-3 border-t border-line px-3.5 pb-3.5 pt-3">
            {m.description && <p className="whitespace-pre-wrap text-sm text-ink-2">{m.description}</p>}
            {allTasksDone && (
              <div className="flex items-center justify-between gap-2 rounded-xl bg-good/10 px-3 py-2 text-sm">
                <span>All tasks done.</span>
                <Button size="sm" variant="primary" icon={<Check className="size-4" />} onClick={() => onStatus('done')}>
                  Complete milestone
                </Button>
              </div>
            )}
            <div>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Tasks</div>
              {tasks.length > 0 ? (
                <ul className="divide-y divide-line">
                  {tasks.map((t) => (
                    <GoalTaskRow key={t.id} task={t} today={today} />
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted">Break this milestone into tasks; its progress then follows them.</p>
              )}
              <AddTaskInline goal={goal} milestoneId={m.id} />
            </div>
            {m.notes && (
              <div>
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Notes</div>
                <p className="whitespace-pre-wrap text-sm text-ink-2">{m.notes}</p>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-1.5 border-t border-line pt-3">
              {m.status !== 'done' ? (
                <Button size="sm" variant="primary" icon={<Check className="size-4" />} onClick={() => onStatus('done')}>
                  Complete
                </Button>
              ) : (
                <Button size="sm" variant="secondary" icon={<RotateCcw className="size-4" />} onClick={() => onStatus('todo')}>
                  Reopen
                </Button>
              )}
              {m.status === 'todo' && (
                <Button size="sm" variant="secondary" icon={<Play className="size-3.5" />} onClick={() => onStatus('in_progress')}>
                  Start
                </Button>
              )}
              {m.status !== 'done' && (
                <Button size="sm" variant="secondary" icon={<Ban className="size-3.5" />} onClick={() => onStatus(m.status === 'blocked' ? 'in_progress' : 'blocked')}>
                  {m.status === 'blocked' ? 'Unblock' : 'Blocked'}
                </Button>
              )}
              <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={onEdit}>
                Edit
              </Button>
              <span className="ml-auto flex items-center">
                <Button size="sm" variant="ghost" aria-label="Move up" disabled={index === 0} onClick={() => void moveMilestone(m, -1)}>
                  <ArrowUp className="size-4" />
                </Button>
                <Button size="sm" variant="ghost" aria-label="Move down" disabled={index === count - 1} onClick={() => void moveMilestone(m, 1)}>
                  <ArrowDown className="size-4" />
                </Button>
                <Button size="sm" variant="ghost" aria-label="Delete milestone" onClick={() => setConfirmDelete(true)}>
                  <Trash2 className="size-4 text-critical-ink" />
                </Button>
              </span>
            </div>
          </div>
        )}
      </div>
      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete milestone?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                setConfirmDelete(false);
                await deleteMilestone(m);
                toast(`Deleted milestone: ${m.title}`);
              }}
            >
              Delete
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-2">"{m.title}" will be removed from the roadmap.{tasks.length ? ` Its ${tasks.length} task(s) stay on the goal.` : ''}</p>
      </Modal>
    </div>
  );
}

function GoalTaskRow({ task, today, milestoneTitle }: { task: Task; today: string; milestoneTitle?: string }) {
  const day = task.plannedDate ?? task.dueDate;
  const done = task.status === 'done';
  const late = !done && task.dueDate && task.dueDate < today;
  return (
    <li className="flex items-center gap-3 py-2">
      <Checkbox checked={done} label={`${done ? 'Reopen' : 'Complete'} ${task.title}`} onChange={(v) => void toggleTask(task, v)} />
      <div className="min-w-0 flex-1">
        <div className={cn('text-sm', done && 'text-muted line-through')}>{task.title}</div>
        <div className="flex flex-wrap gap-x-2 text-xs text-muted">
          {milestoneTitle && <span className="truncate">{milestoneTitle}</span>}
          {task.plannedDate === today && !done && <span className="font-medium text-accent">On today's plan</span>}
          {day && !(task.plannedDate === today) && <span className={cn(late && 'font-medium text-critical-ink')}>{task.dueDate && !task.plannedDate ? `Due ${fmtDate(task.dueDate)}` : `Planned ${fmtDate(day)}`}{late ? ' · overdue' : ''}</span>}
          {!day && !done && <span>Not scheduled</span>}
        </div>
      </div>
      {!done && task.plannedDate !== today && (
        <Button
          size="sm"
          variant="ghost"
          className="shrink-0 text-accent"
          icon={<CalendarPlus className="size-3.5" />}
          onClick={async () => {
            await planToday(task);
            toast(`Added to today: ${task.title}`, 'success');
          }}
        >
          Today
        </Button>
      )}
    </li>
  );
}

function AddTaskInline({ goal, milestoneId }: { goal: Goal; milestoneId: string | null }) {
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    try {
      await addGoalTask(goal, milestoneId, { title, dueDate: due || null });
      setTitle('');
      setDue('');
      ref.current?.focus();
    } catch {
      toast("Couldn't add the task", 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="mt-2 flex items-center gap-2 rounded-xl border border-dashed border-line px-2.5 py-1 focus-within:border-accent">
      <Plus className="size-4 shrink-0 text-muted" />
      <input ref={ref} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a task…" maxLength={300} aria-label="New task" className="h-9 min-w-0 flex-1 bg-transparent text-base placeholder:text-muted focus:outline-none sm:text-sm" />
      {title.trim() && (
        <>
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Deadline (optional)" className="h-8 w-[7.5rem] rounded-lg bg-surface-2 px-1.5 text-xs" />
          <button type="submit" disabled={busy} className="rounded-lg px-2 py-1 text-sm font-medium text-accent hover:bg-accent-soft">
            Add
          </button>
        </>
      )}
    </form>
  );
}

function TaskList({ s, today }: { s: GoalSummary; today: string }) {
  const [milestoneId, setMilestoneId] = useState<string>(s.current?.id ?? '');
  const title = (id: string | null) => s.milestones.find((m) => m.id === id)?.title;
  const key = (t: Task) => t.plannedDate ?? t.dueDate ?? '9999';
  const open = s.tasks.filter((t) => t.status !== 'done').sort((a, b) => key(a).localeCompare(key(b)));
  const done = s.tasks.filter((t) => t.status === 'done').sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));
  const unscheduled = open.filter((t) => !t.plannedDate && !t.dueDate).length;
  return (
    <div className="space-y-4">
      <Card>
        {s.milestones.length > 0 && (
          <Field label="Add to">
            <Select value={milestoneId} onChange={(e) => setMilestoneId(e.target.value)}>
              <option value="">The goal (no milestone)</option>
              {s.milestones.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <AddTaskInline goal={s.goal} milestoneId={milestoneId || null} />
        {unscheduled > 0 && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-muted">
            <Clock3 className="size-3.5" /> {unscheduled} task{unscheduled === 1 ? '' : 's'} not scheduled yet. Tap "Today" to put one on your daily plan.
          </p>
        )}
      </Card>
      {open.length > 0 && (
        <Card>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Open · {open.length}</h3>
          <ul className="divide-y divide-line">
            {open.map((t) => (
              <GoalTaskRow key={t.id} task={t} today={today} milestoneTitle={title(t.milestoneId)} />
            ))}
          </ul>
        </Card>
      )}
      {done.length > 0 && (
        <Card>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Done · {done.length}</h3>
          <ul className="divide-y divide-line">
            {done.map((t) => (
              <GoalTaskRow key={t.id} task={t} today={today} milestoneTitle={title(t.milestoneId)} />
            ))}
          </ul>
        </Card>
      )}
      {!s.tasks.length && <EmptyState icon={<Sparkles className="size-6" />} title="No tasks yet" body="Tasks are the everyday steps. Add them here or inside a milestone, then plan them into your day." />}
    </div>
  );
}

function NotesPanel({ goal }: { goal: Goal }) {
  const [notes, setNotes] = useState(goal.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [rTitle, setRTitle] = useState('');
  const [rUrl, setRUrl] = useState('');
  const dirty = notes !== (goal.notes ?? '');

  async function saveNotes() {
    setSaving(true);
    try {
      await updateGoal(goal.id, { notes: notes.trim() ? notes : null });
      toast('Notes saved', 'success');
    } finally {
      setSaving(false);
    }
  }
  async function addResource(e: FormEvent) {
    e.preventDefault();
    if (!rTitle.trim()) return;
    let url = rUrl.trim() || null;
    if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`;
    await updateGoal(goal.id, { resources: [...goal.resources, { title: rTitle.trim().slice(0, 200), url }] });
    setRTitle('');
    setRUrl('');
  }

  return (
    <div className="space-y-4">
      <Card>
        <Field label="Notes">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-40" maxLength={10_000} placeholder="Strategy, reflections, what's working and what isn't…" />
        </Field>
        <div className="mt-2 flex justify-end">
          <Button size="sm" variant="primary" disabled={!dirty} loading={saving} onClick={() => void saveNotes()}>
            Save notes
          </Button>
        </div>
      </Card>
      <Card>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Resources</h3>
        {goal.resources.length > 0 ? (
          <ul className="mb-3 divide-y divide-line">
            {goal.resources.map((r, i) => (
              <li key={i} className="flex items-center gap-2 py-2 text-sm">
                {r.url ? (
                  <a href={r.url} target="_blank" rel="noreferrer noopener" className="flex min-w-0 flex-1 items-center gap-1.5 text-accent hover:underline">
                    <span className="truncate">{r.title}</span> <ExternalLink className="size-3.5 shrink-0" />
                  </a>
                ) : (
                  <span className="min-w-0 flex-1 truncate">{r.title}</span>
                )}
                <Button size="sm" variant="ghost" aria-label={`Remove ${r.title}`} onClick={() => void updateGoal(goal.id, { resources: goal.resources.filter((_, k) => k !== i) })}>
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mb-3 text-sm text-ink-2">Books, courses, playlists, links. Keep them next to the goal.</p>
        )}
        <form onSubmit={addResource} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <Input value={rTitle} onChange={(e) => setRTitle(e.target.value)} placeholder="Title, e.g. Striver's SDE sheet" aria-label="Resource title" maxLength={200} />
          <Input value={rUrl} onChange={(e) => setRUrl(e.target.value)} placeholder="Link (optional)" aria-label="Resource link" inputMode="url" />
          <Button type="submit" variant="secondary" disabled={!rTitle.trim() || goal.resources.length >= 50} icon={<Plus className="size-4" />}>
            Add
          </Button>
        </form>
      </Card>
    </div>
  );
}

function DeleteGoal({ s, open, onClose, onDeleted }: { s: GoalSummary; open: boolean; onClose: () => void; onDeleted: () => void }) {
  const [alsoTasks, setAlsoTasks] = useState(false);
  const [busy, setBusy] = useState(false);
  const openTasks = s.tasks.filter((t) => t.status !== 'done').length;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Delete this goal?"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await deleteGoal(s.goal, alsoTasks);
                toast(`Deleted goal: ${s.goal.title}`);
                onClose();
                onDeleted();
              } catch {
                toast("Couldn't delete the goal", 'error');
                setBusy(false);
              }
            }}
          >
            Delete goal
          </Button>
        </>
      }
    >
      <p className="text-sm text-ink-2">
        "{s.goal.title}" and its {s.milestones.length} milestone{s.milestones.length === 1 ? '' : 's'} will be deleted on every device. Completed tasks are kept in your task history.
      </p>
      {openTasks > 0 && <Toggle checked={alsoTasks} onChange={setAlsoTasks} label={`Also delete ${openTasks} unfinished task${openTasks === 1 ? '' : 's'}`} description="Otherwise they stay in your task list without a goal." />}
    </Modal>
  );
}

/** Weekly lectures and one-off classes mapped to this goal (AI Pilot can link them). */
function LinkedLectures({ goalId }: { goalId: string }) {
  const slots = (useAll('classSchedule') ?? []).filter((c) => c.goalId === goalId && c.active);
  const extras = (useAll('classInstance') ?? []).filter((c) => c.goalId === goalId);
  const subjects = useAll('subject') ?? [];
  if (!slots.length && !extras.length) return null;
  const name = (id: string) => subjects.find((x) => x.id === id)?.name ?? 'Class';
  return (
    <Card className="mb-3">
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Lectures for this goal</div>
      <ul className="divide-y divide-line text-sm">
        {slots.map((c) => (
          <li key={c.id} className="flex items-center gap-2 py-2">
            <span className="min-w-0 flex-1 truncate font-medium">{name(c.subjectId)}</span>
            <span className="shrink-0 text-xs text-ink-2 tabular">
              Every {WEEKDAY_SHORT[c.weekday]} · {c.startTime}–{c.endTime}
            </span>
          </li>
        ))}
        {extras.map((c) => (
          <li key={c.id} className="flex items-center gap-2 py-2">
            <span className="min-w-0 flex-1 truncate font-medium">{name(c.subjectId)}</span>
            <span className="shrink-0 text-xs text-ink-2 tabular">
              {fmtDate(c.date)} · {c.startTime}–{c.endTime}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

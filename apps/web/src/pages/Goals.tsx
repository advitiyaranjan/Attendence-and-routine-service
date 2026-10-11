/**
 * Goals overview: every long-term goal as a card with its journey at a glance, a
 * cross-goal milestone timeline, and a history of what has been achieved.
 */
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ArrowRight, CalendarRange, Flag, Mountain, Plus, Target, Trophy } from 'lucide-react';
import { goalCategory, milestoneState, type Goal, type Milestone } from '@student-os/core';
import { NewGoalForm } from '../components/goals/GoalForms';
import { CategoryTag, dueLabel, fmtDate, HealthPill, healthColor, PriorityTag, ProgressRing, STATE_STYLE } from '../components/goals/visuals';
import { Button, Card, Chip, cn, EmptyState, isOverlayEntry, Modal, PageHeader, Select, Spinner, Tabs } from '../components/ui';
import { summarizeAll, useGoalData, type GoalSummary } from '../lib/goals';
import { useToday } from '../lib/hooks';

type View = 'goals' | 'timeline' | 'achievements';
type Filter = 'active' | 'attention' | 'paused' | 'completed' | 'all';
type Sort = 'urgency' | 'deadline' | 'priority' | 'updated' | 'progress';

const EXAMPLES: Array<{ title: string; category: string }> = [
  { title: 'Land a software engineering internship', category: 'career' },
  { title: 'Crack GATE', category: 'exam' },
  { title: 'Reach a 9.0 CGPA', category: 'academic' },
  { title: 'Master data structures & algorithms', category: 'skill' },
];

const PRIO_RANK = { urgent: 0, high: 1, medium: 2, low: 3 } as const;

export default function Goals() {
  const data = useGoalData();
  const today = useToday();
  const navigate = useNavigate();
  const [view, setView] = useState<View>('goals');
  const [filter, setFilter] = useState<Filter>('active');
  const [sort, setSort] = useState<Sort>('urgency');
  const [creating, setCreating] = useState<{ title?: string; category?: string } | null>(null);
  const all = useMemo(() => (data ? summarizeAll(data, today) : []), [data, today]);

  if (!data) return <Spinner />;

  const active = all.filter((s) => s.goal.status === 'active');
  const needsAttention = active.filter((s) => ['attention', 'behind', 'overdue'].includes(s.health.level));
  const avg = active.length ? active.reduce((a, s) => a + s.progress.percent, 0) / active.length : 0;
  const monthStart = today.slice(0, 8) + '01';
  const msDoneMonth = data.milestones.filter((m) => m.status === 'done' && (m.completedAt?.slice(0, 10) ?? '') >= monthStart).length;
  const focus = [...needsAttention].sort((a, b) => a.urgency - b.urgency)[0];

  const shown = all
    .filter((s) =>
      filter === 'all'
        ? true
        : filter === 'attention'
          ? needsAttention.includes(s)
          : s.goal.status === (filter === 'completed' ? 'completed' : filter === 'paused' ? 'paused' : 'active'),
    )
    .sort((a, b) => {
      if (sort === 'deadline') return (a.goal.targetDate ?? '9999').localeCompare(b.goal.targetDate ?? '9999');
      if (sort === 'priority') return PRIO_RANK[a.goal.priority] - PRIO_RANK[b.goal.priority] || a.urgency - b.urgency;
      if (sort === 'updated') return lastTouched(b).localeCompare(lastTouched(a));
      if (sort === 'progress') return b.progress.percent - a.progress.percent;
      return a.urgency - b.urgency;
    });

  const counts: Record<Filter, number> = {
    active: active.length,
    attention: needsAttention.length,
    paused: all.filter((s) => s.goal.status === 'paused').length,
    completed: all.filter((s) => s.goal.status === 'completed').length,
    all: all.length,
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Goals"
        subtitle="Where you are, where you're headed, and the next step to get there."
        actions={
          all.length > 0 && (
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating({})}>
              New goal
            </Button>
          )
        }
      />

      {all.length === 0 ? (
        <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
          <div className="bg-gradient-to-br from-accent-soft via-surface to-surface px-5 py-8 text-center sm:px-10 sm:py-12">
            <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-accent text-accent-ink shadow-pop">
              <Mountain className="size-7" />
            </span>
            <h2 className="mt-4 text-lg font-semibold tracking-tight sm:text-xl">Plan where you want to be</h2>
            <p className="mx-auto mt-1 max-w-md text-sm text-ink-2">
              Set a long-term goal, break it into milestones, and turn each one into tasks you can put on your daily plan. Your roadmap updates as you tick them off.
            </p>
            <Button variant="primary" size="lg" className="mt-5" icon={<Plus className="size-4" />} onClick={() => setCreating({})}>
              Create your first goal
            </Button>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              {EXAMPLES.map((e) => (
                <Chip key={e.title} onClick={() => setCreating(e)} className="h-auto min-h-9 py-1.5 text-left text-[13px]">
                  <span aria-hidden>{goalCategory(e.category).icon}</span> {e.title}
                </Chip>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <PortfolioTile label="Active goals" value={String(active.length)} sub={counts.completed ? `${counts.completed} completed` : 'In progress'} icon={<Target className="size-4" />} />
            <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-3.5 shadow-card">
              <ProgressRing value={avg} size={48} stroke={5} label="Average progress across active goals" />
              <div className="min-w-0">
                <div className="text-xs font-medium text-ink-2">Average progress</div>
                <div className="text-xs text-muted">across active goals</div>
              </div>
            </div>
            <PortfolioTile
              label="Need attention"
              value={String(needsAttention.length)}
              sub={needsAttention.length ? 'Behind or overdue' : 'All on schedule'}
              icon={<Flag className="size-4" />}
              tone={needsAttention.length ? 'warn' : 'good'}
            />
            <PortfolioTile label="Milestones" value={String(msDoneMonth)} sub="completed this month" icon={<Trophy className="size-4" />} />
          </div>

          {focus && (
            <Link
              to={`/goals/${focus.goal.id}`}
              className="group flex items-center gap-3 rounded-2xl border p-3.5 transition-colors hover:bg-surface-2 sm:p-4"
              style={{ borderColor: `color-mix(in srgb, ${healthColor(focus.health.level)} 45%, var(--line))` }}
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl text-lg" style={{ background: `color-mix(in srgb, ${focus.goal.color} 14%, transparent)` }}>
                {focus.goal.icon}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium text-ink-2">Needs you most</div>
                <div className="truncate font-medium">{focus.goal.title}</div>
                <div className="truncate text-xs text-muted">{focus.health.reasons.slice(0, 2).join(' · ')}</div>
              </div>
              <ArrowRight className="size-4 shrink-0 text-accent transition-transform group-hover:translate-x-0.5" />
            </Link>
          )}

          <Tabs
            value={view}
            onChange={setView}
            options={[
              { value: 'goals', label: 'Goals' },
              { value: 'timeline', label: 'Timeline' },
              { value: 'achievements', label: 'Achievements' },
            ]}
          />

          {view === 'goals' && (
            <>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0">
                  {(
                    [
                      ['active', 'Active'],
                      ['attention', 'Needs attention'],
                      ['paused', 'Paused'],
                      ['completed', 'Completed'],
                      ['all', 'All'],
                    ] as Array<[Filter, string]>
                  ).map(([f, label]) => (
                    <Chip key={f} selected={filter === f} onClick={() => setFilter(f)} className="shrink-0">
                      {label}
                      <span className="text-xs text-muted tabular">{counts[f]}</span>
                    </Chip>
                  ))}
                </div>
                <label className="flex items-center gap-2 text-xs text-ink-2">
                  Sort
                  <Select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="h-9 w-auto">
                    <option value="urgency">Needs me most</option>
                    <option value="deadline">Nearest deadline</option>
                    <option value="priority">Highest priority</option>
                    <option value="updated">Recently updated</option>
                    <option value="progress">Most progress</option>
                  </Select>
                </label>
              </div>
              {shown.length === 0 ? (
                <EmptyState title={filter === 'attention' ? 'Every active goal is on schedule' : `No ${filter === 'all' ? '' : filter} goals`} body={filter === 'active' ? 'Resume a paused goal or create a new one.' : undefined} />
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {shown.map((s) => (
                    <GoalCard key={s.goal.id} s={s} today={today} />
                  ))}
                </div>
              )}
            </>
          )}

          {view === 'timeline' && <Timeline summaries={all.filter((s) => s.goal.status === 'active')} today={today} />}
          {view === 'achievements' && <Achievements summaries={all} />}
        </>
      )}

      <Modal open={!!creating} onClose={() => setCreating(null)} title="New goal">
        {creating && (
          <NewGoalForm
            initialTitle={creating.title}
            initialCategory={creating.category}
            onDone={(g) => {
              setCreating(null);
              if (g) navigate(`/goals/${g.id}`, { replace: isOverlayEntry() });
            }}
          />
        )}
      </Modal>
    </div>
  );
}

function lastTouched(s: GoalSummary) {
  return [s.goal.updatedAt, ...s.milestones.map((m) => m.updatedAt), ...s.tasks.map((t) => t.updatedAt)].sort().at(-1) ?? '';
}

function PortfolioTile({ label, value, sub, icon, tone }: { label: string; value: string; sub: string; icon: React.ReactNode; tone?: 'warn' | 'good' }) {
  return (
    <div className="min-w-0 rounded-2xl border border-line bg-surface p-3.5 shadow-card">
      <div className="flex items-center justify-between gap-2 text-xs font-medium text-ink-2">
        <span className="truncate">{label}</span>
        <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-lg', tone === 'warn' ? 'bg-warning/15 text-warning-ink' : tone === 'good' ? 'bg-good/15 text-good-ink' : 'bg-accent-soft text-accent')}>{icon}</span>
      </div>
      <div className="mt-1 text-2xl font-semibold tracking-tight tabular">{value}</div>
      <div className="truncate text-xs text-muted">{sub}</div>
    </div>
  );
}

/** The roadmap in one line: a segment per milestone, coloured by its state. */
export function JourneyBar({ milestones, current, today }: { milestones: Milestone[]; current: Milestone | null; today: string }) {
  if (!milestones.length) return <div className="h-1.5 rounded-full bg-surface-2" />;
  return (
    <div className="flex gap-1" aria-hidden>
      {milestones.map((m) => {
        const st = milestoneState(m, today, current?.id ?? null);
        return (
          <span
            key={m.id}
            className={cn('h-1.5 flex-1 rounded-full', st === 'active' && 'motion-safe:animate-pulse')}
            style={{ background: st === 'upcoming' ? 'var(--surface-2)' : STATE_STYLE[st].color, opacity: st === 'upcoming' ? 1 : st === 'active' ? 0.9 : 1 }}
            title={`${m.title}: ${STATE_STYLE[st].label}`}
          />
        );
      })}
    </div>
  );
}

function GoalCard({ s, today }: { s: GoalSummary; today: string }) {
  const { goal, progress, health, current, milestones } = s;
  const open = s.tasks.filter((t) => t.status !== 'done').length;
  return (
    <Link to={`/goals/${goal.id}`} className={cn('group flex min-w-0 flex-col gap-3 rounded-2xl border border-line bg-surface p-4 shadow-card transition-[border-color,transform] hover:border-ink-2/30 active:scale-[0.99]', goal.status !== 'active' && 'opacity-80')}>
      <div className="flex items-start gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl text-xl" style={{ background: `color-mix(in srgb, ${goal.color} 14%, transparent)` }} aria-hidden>
          {goal.icon}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-2 font-semibold leading-snug">{goal.title}</h3>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
            <CategoryTag category={goal.category} />
            <PriorityTag priority={goal.priority} />
          </div>
        </div>
        <ProgressRing value={progress.percent} size={50} stroke={5} color={goal.color} label={`${goal.title} progress`} />
      </div>
      <JourneyBar milestones={milestones} current={current} today={today} />
      <div className="min-w-0 text-sm">
        {goal.status === 'completed' ? (
          <span className="text-ink-2">Achieved{goal.completedAt ? ` on ${fmtDate(goal.completedAt.slice(0, 10), true)}` : ''} 🎉</span>
        ) : current ? (
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-xs text-muted">Next</span>
            <span className="truncate font-medium">{current.title}</span>
            {current.targetDate && <span className={cn('ml-auto shrink-0 text-xs', current.targetDate < today ? 'font-medium text-critical-ink' : 'text-ink-2')}>{dueLabel(current.targetDate, today)}</span>}
          </div>
        ) : (
          <span className="text-ink-2">{milestones.length ? 'Every milestone is done. Mark the goal complete?' : 'Add milestones to map the way.'}</span>
        )}
      </div>
      <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-line pt-3 text-xs text-ink-2">
        <HealthPill health={health} />
        <span className="tabular">
          {progress.milestonesDone}/{progress.milestonesTotal} milestones
        </span>
        {open > 0 && <span className="tabular">· {open} open tasks</span>}
        {goal.targetDate && goal.status === 'active' && <span className="ml-auto tabular">{fmtDate(goal.targetDate, true)}</span>}
      </div>
    </Link>
  );
}

/** Open milestones of active goals, by date: overdue first, then month by month, then undated. */
function Timeline({ summaries, today }: { summaries: GoalSummary[]; today: string }) {
  const rows = summaries.flatMap((s) => s.milestones.filter((m) => m.status !== 'done').map((m) => ({ m, s })));
  if (!rows.length) return <EmptyState icon={<CalendarRange className="size-6" />} title="No open milestones" body="Milestones with dates appear here in order, across all your goals." />;
  const overdue = rows.filter((r) => r.m.targetDate && r.m.targetDate < today).sort((a, b) => a.m.targetDate!.localeCompare(b.m.targetDate!));
  const dated = rows.filter((r) => r.m.targetDate && r.m.targetDate >= today).sort((a, b) => a.m.targetDate!.localeCompare(b.m.targetDate!));
  const undated = rows.filter((r) => !r.m.targetDate);
  const months = new Map<string, typeof rows>();
  for (const r of dated) {
    const k = r.m.targetDate!.slice(0, 7);
    months.set(k, [...(months.get(k) ?? []), r]);
  }
  const group = (label: string, list: typeof rows, tone?: 'critical') =>
    list.length > 0 && (
      <section key={label}>
        <h3 className={cn('mb-2 text-xs font-semibold uppercase tracking-wide', tone ? 'text-critical-ink' : 'text-muted')}>{label}</h3>
        <ol className="relative space-y-2 border-l-2 border-line pl-4">
          {list.map(({ m, s }) => {
            const st = milestoneState(m, today, s.current?.id ?? null);
            return (
              <li key={m.id} className="relative">
                <span className="absolute -left-[23px] top-4 size-3 rounded-full border-2 border-surface" style={{ background: STATE_STYLE[st].color === 'var(--muted)' ? s.goal.color : STATE_STYLE[st].color }} aria-hidden />
                <Link to={`/goals/${s.goal.id}?m=${m.id}`} className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-3 shadow-card hover:bg-surface-2">
                  <div className="w-12 shrink-0 text-center">
                    {m.targetDate ? (
                      <>
                        <div className="text-lg font-semibold leading-none tabular">{Number(m.targetDate.slice(8, 10))}</div>
                        <div className="text-[11px] uppercase text-muted">{new Date(`${m.targetDate}T12:00:00`).toLocaleDateString(undefined, { month: 'short' })}</div>
                      </>
                    ) : (
                      <span className="text-xs text-muted">—</span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{m.title}</div>
                    <div className="truncate text-xs text-muted">
                      {s.goal.icon} {s.goal.title}
                    </div>
                  </div>
                  <span className="shrink-0 text-xs font-medium" style={{ color: st === 'upcoming' ? 'var(--ink-2)' : STATE_STYLE[st].color }}>
                    {m.targetDate ? (st === 'overdue' ? dueLabel(m.targetDate, today) : STATE_STYLE[st].label) : STATE_STYLE[st].label}
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      </section>
    );
  return (
    <div className="space-y-5">
      {group('Overdue · reschedule or finish', overdue, 'critical')}
      {[...months.entries()].map(([k, list]) => group(new Date(`${k}-15T12:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }), list))}
      {group('No date yet', undated)}
    </div>
  );
}

function Achievements({ summaries }: { summaries: GoalSummary[] }) {
  const goalsDone = summaries.filter((s) => s.goal.status === 'completed').sort((a, b) => (b.goal.completedAt ?? '').localeCompare(a.goal.completedAt ?? ''));
  const history = summaries
    .flatMap((s) => s.milestones.filter((m) => m.status === 'done').map((m) => ({ m, goal: s.goal })))
    .sort((a, b) => (b.m.completedAt ?? b.m.updatedAt).localeCompare(a.m.completedAt ?? a.m.updatedAt));
  if (!goalsDone.length && !history.length) {
    return <EmptyState icon={<Trophy className="size-6" />} title="Your wins will collect here" body="Every milestone you complete, and every goal you reach, is kept as a record of how far you've come." />;
  }
  const months = new Map<string, Array<{ m: Milestone; goal: Goal }>>();
  for (const h of history) {
    const k = (h.m.completedAt ?? h.m.updatedAt).slice(0, 7);
    months.set(k, [...(months.get(k) ?? []), h]);
  }
  return (
    <div className="space-y-5">
      {goalsDone.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {goalsDone.map(({ goal, progress }) => (
            <Link key={goal.id} to={`/goals/${goal.id}`} className="flex items-center gap-3 rounded-2xl border border-good/30 bg-good/5 p-4 hover:bg-good/10">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-good/15 text-good-ink">
                <Trophy className="size-5" />
              </span>
              <div className="min-w-0">
                <div className="truncate font-semibold">{goal.title}</div>
                <div className="text-xs text-ink-2">
                  {goal.completedAt ? `Achieved ${fmtDate(goal.completedAt.slice(0, 10), true)}` : 'Achieved'} · {progress.milestonesTotal} milestones · {progress.tasksDone} tasks
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
      {[...months.entries()].map(([k, list]) => (
        <section key={k}>
          <h3 className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-muted">
            {new Date(`${k}-15T12:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
            <span className="normal-case tracking-normal">{list.length} milestone{list.length === 1 ? '' : 's'}</span>
          </h3>
          <Card className="py-1 sm:py-1">
            <ul className="divide-y divide-line">
              {list.map(({ m, goal }) => (
                <li key={m.id}>
                  <Link to={`/goals/${goal.id}?m=${m.id}`} className="flex items-center gap-3 py-2.5">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-good text-white" aria-hidden>
                      ✓
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{m.title}</div>
                      <div className="truncate text-xs text-muted">
                        {goal.icon} {goal.title}
                      </div>
                    </div>
                    {m.completedAt && <span className="shrink-0 text-xs text-ink-2">{fmtDate(m.completedAt.slice(0, 10))}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      ))}
    </div>
  );
}

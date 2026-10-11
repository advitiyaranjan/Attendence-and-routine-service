/** Home card: the goals that need attention most, each with its current milestone, and one concrete next step. */
import { Link } from 'react-router';
import { ArrowRight, CalendarPlus, Mountain } from 'lucide-react';
import { planToday, summarizeAll, toggleTask, useGoalData } from '../../lib/goals';
import { useToday } from '../../lib/hooks';
import { toast, useApp } from '../../lib/store';
import { Button, Card, Checkbox, cn, SectionTitle } from '../ui';
import { dueLabel, HealthPill, ProgressRing } from './visuals';

export function HomeGoals() {
  const data = useGoalData();
  const today = useToday();
  const openQuickAdd = useApp((s) => s.openQuickAdd);
  if (!data) return null;
  const active = summarizeAll(data, today)
    .filter((s) => s.goal.status === 'active')
    .sort((a, b) => a.urgency - b.urgency);

  if (!active.length) {
    return (
      <Card>
        <SectionTitle>Goals</SectionTitle>
        <div className="flex items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-accent">
            <Mountain className="size-5" />
          </span>
          <p className="min-w-0 flex-1 text-sm text-ink-2">Map a long-term goal into milestones and daily tasks, and track the whole journey here.</p>
        </div>
        <Button variant="secondary" className="mt-3 w-full" onClick={() => openQuickAdd('goal')}>
          Plan a goal
        </Button>
      </Card>
    );
  }

  const top = active.slice(0, 3);
  const step = active.find((s) => s.nextTask)?.nextTask ?? null;
  const stepGoal = step ? active.find((s) => s.nextTask?.id === step.id)!.goal : null;
  const plannedToday = step?.plannedDate === today;

  return (
    <Card>
      <SectionTitle action={<Link to="/goals" className="text-xs font-medium text-accent">All goals</Link>}>Goals</SectionTitle>
      <ul className="divide-y divide-line">
        {top.map(({ goal, progress, health, current }) => (
          <li key={goal.id}>
            <Link to={`/goals/${goal.id}`} className="flex items-center gap-3 py-2.5">
              <ProgressRing value={progress.percent} size={42} stroke={4.5} color={goal.color} label={`${goal.title} progress`}>
                <span className="text-sm" aria-hidden>
                  {goal.icon}
                </span>
              </ProgressRing>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{goal.title}</span>
                  <span className="shrink-0 text-xs text-muted tabular">{Math.round(progress.percent)}%</span>
                </div>
                <div className="truncate text-xs text-muted">
                  {current ? (
                    <>
                      Now: {current.title}
                      {current.targetDate && <span className={cn(current.targetDate < today && 'font-medium text-critical-ink')}> · {dueLabel(current.targetDate, today)}</span>}
                    </>
                  ) : progress.milestonesTotal ? (
                    'All milestones done'
                  ) : (
                    'No milestones yet'
                  )}
                </div>
              </div>
              <HealthPill health={health} className="hidden sm:inline-flex" />
            </Link>
          </li>
        ))}
      </ul>
      {active.length > top.length && <p className="pt-1 text-xs text-muted">+{active.length - top.length} more active</p>}

      {step && stepGoal && (
        <div className="mt-3 rounded-xl bg-surface-2 p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Next step · {stepGoal.title}</div>
          <div className="mt-1.5 flex items-center gap-3">
            {plannedToday && <Checkbox checked={false} label={`Complete ${step.title}`} onChange={() => void toggleTask(step, true).then(() => toast(`Completed: ${step.title}`, 'success'))} />}
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{step.title}</span>
            {plannedToday ? (
              <span className="shrink-0 text-xs text-accent">On today's plan</span>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                icon={<CalendarPlus className="size-3.5" />}
                onClick={async () => {
                  await planToday(step);
                  toast(`Added to today: ${step.title}`, 'success');
                }}
              >
                Do today
              </Button>
            )}
          </div>
        </div>
      )}
      {!step && (
        <Link to={`/goals/${top[0]!.goal.id}`} className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-accent">
          Break the next milestone into tasks <ArrowRight className="size-3.5" />
        </Link>
      )}
    </Card>
  );
}

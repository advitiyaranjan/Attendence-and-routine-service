/** Month calendar of every goal's milestones and target dates. Dots per day; tap a day for its list. */
import { useState } from 'react';
import { Link } from 'react-router';
import { Check, ChevronLeft, ChevronRight, Flag, Mountain } from 'lucide-react';
import { addDays, addMonths, eachDay, endOfMonth, milestoneState, startOfMonth, startOfWeek, WEEKDAY_SHORT, type Goal } from '@student-os/core';
import type { GoalSummary } from '../../lib/goals';
import { useSettings } from '../../lib/hooks';
import { Button, Card, cn } from '../ui';
import { fmtDate, STATE_STYLE } from './visuals';

interface DayItem {
  key: string;
  date: string;
  title: string;
  goal: Goal;
  href: string;
  kind: 'milestone' | 'done' | 'target';
  color: string;
  label: string;
}

export function GoalCalendar({ summaries, today }: { summaries: GoalSummary[]; today: string }) {
  const wk = useSettings().weekStartsOn;
  const [month, setMonth] = useState(startOfMonth(today));
  const [selected, setSelected] = useState<string | null>(null);
  const from = startOfWeek(month, wk);
  const to = addDays(startOfWeek(endOfMonth(month), wk), 6);

  const items: DayItem[] = [];
  for (const s of summaries) {
    if (s.goal.status === 'paused') continue;
    for (const m of s.milestones) {
      const st = milestoneState(m, today, s.current?.id ?? null);
      if (m.status === 'done') {
        const d = m.completedAt?.slice(0, 10) ?? m.targetDate;
        if (d) items.push({ key: m.id, date: d, title: m.title, goal: s.goal, href: `/goals/${s.goal.id}?m=${m.id}`, kind: 'done', color: 'var(--color-good)', label: 'Completed' });
      } else if (m.targetDate) {
        items.push({ key: m.id, date: m.targetDate, title: m.title, goal: s.goal, href: `/goals/${s.goal.id}?m=${m.id}`, kind: 'milestone', color: st === 'overdue' ? 'var(--color-critical)' : s.goal.color, label: STATE_STYLE[st].label });
      }
    }
    if (s.goal.status === 'active' && s.goal.targetDate) {
      items.push({ key: `t${s.goal.id}`, date: s.goal.targetDate, title: s.goal.title, goal: s.goal, href: `/goals/${s.goal.id}`, kind: 'target', color: s.goal.color, label: 'Goal target' });
    }
  }
  const byDay = new Map<string, DayItem[]>();
  for (const i of items) byDay.set(i.date, [...(byDay.get(i.date) ?? []), i]);
  const monthItems = items.filter((i) => i.date.startsWith(month.slice(0, 7))).sort((a, b) => a.date.localeCompare(b.date));
  const list = selected ? (byDay.get(selected) ?? []) : monthItems;

  return (
    <div className="space-y-3">
      <Card className="p-3 sm:p-4">
        <div className="mb-2 flex items-center justify-between">
          <Button size="sm" variant="ghost" aria-label="Previous month" onClick={() => (setMonth(addMonths(month, -1)), setSelected(null))}>
            <ChevronLeft className="size-4" />
          </Button>
          <button className="text-sm font-semibold" onClick={() => (setMonth(startOfMonth(today)), setSelected(null))} title="Back to this month">
            {new Date(`${month}T12:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
          </button>
          <Button size="sm" variant="ghost" aria-label="Next month" onClick={() => (setMonth(addMonths(month, 1)), setSelected(null))}>
            <ChevronRight className="size-4" />
          </Button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center">
          {Array.from({ length: 7 }, (_, i) => (
            <div key={i} className="py-1 text-[11px] font-medium text-muted">
              {WEEKDAY_SHORT[(i + wk) % 7]}
            </div>
          ))}
          {eachDay(from, to).map((d) => {
            const day = byDay.get(d) ?? [];
            const inMonth = d.startsWith(month.slice(0, 7));
            const isSel = d === selected;
            return (
              <button
                key={d}
                onClick={() => setSelected(isSel ? null : d)}
                aria-pressed={isSel}
                aria-label={`${fmtDate(d, true)}${day.length ? `, ${day.length} item${day.length === 1 ? '' : 's'}` : ''}`}
                className={cn(
                  'flex aspect-square flex-col items-center justify-start gap-1 rounded-xl pt-1.5 text-xs transition-colors sm:aspect-auto sm:min-h-16',
                  !inMonth && 'opacity-35',
                  isSel ? 'bg-accent text-accent-ink' : day.length ? 'bg-surface-2 hover:bg-accent-soft' : 'hover:bg-surface-2',
                  d === today && !isSel && 'ring-2 ring-accent/50',
                )}
              >
                <span className={cn('tabular', d === today && !isSel && 'font-semibold text-accent')}>{Number(d.slice(8))}</span>
                <span className="flex flex-wrap justify-center gap-0.5 px-0.5">
                  {day.slice(0, 4).map((i) =>
                    i.kind === 'target' ? (
                      <Flag key={i.key} className="size-2.5" style={{ color: isSel ? 'currentColor' : i.color }} aria-hidden />
                    ) : (
                      <span key={i.key} className="size-1.5 rounded-full" style={{ background: isSel ? 'currentColor' : i.color }} aria-hidden />
                    ),
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </Card>

      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{selected ? fmtDate(selected, true) : 'This month'}</h3>
        {list.length === 0 ? (
          <p className="text-sm text-ink-2">{selected ? 'Nothing on this day.' : 'No milestones or targets this month.'}</p>
        ) : (
          <ul className="space-y-2">
            {list.map((i) => (
              <li key={i.key + i.date}>
                <Link to={i.href} className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-3 shadow-card hover:bg-surface-2">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl" style={{ background: `color-mix(in srgb, ${i.color} 15%, transparent)`, color: i.color }}>
                    {i.kind === 'target' ? <Mountain className="size-4" /> : i.kind === 'done' ? <Check className="size-4" /> : <Flag className="size-4" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{i.title}</div>
                    <div className="truncate text-xs text-muted">
                      {i.kind === 'target' ? 'Goal target date' : `${i.goal.icon} ${i.goal.title}`}
                    </div>
                  </div>
                  <span className="shrink-0 text-right text-xs">
                    <span className="block font-medium" style={{ color: i.kind === 'milestone' && i.label === 'Upcoming' ? 'var(--ink-2)' : i.color }}>
                      {i.label}
                    </span>
                    {!selected && <span className="text-muted">{fmtDate(i.date)}</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

import { useId, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { AlertTriangle, ArrowRight, CheckCircle2, ChevronDown, ChartPie } from 'lucide-react';
import { fmtPct, type AttendanceOverview } from '@student-os/core';
import { Card, cn, Meter, riskColor, SectionTitle } from './ui';

/** A compact view of the same attendance calculation used by the full attendance page. */
export function AttendancePanel({ attendance }: { attendance: AttendanceOverview | undefined }) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const subjects = (attendance?.subjects ?? [])
    .filter((s) => s.summary.conducted > 0 || s.summary.risk !== 'no_data')
    .sort((a, b) => {
      const risk = { below_min: 0, at_risk: 1, on_track: 2, safe: 3, no_data: 4 };
      return risk[a.summary.risk] - risk[b.summary.risk] || (a.summary.percent ?? 100) - (b.summary.percent ?? 100);
    });
  const risks = subjects.filter((s) => s.summary.risk === 'at_risk' || s.summary.risk === 'below_min').length;
  const hasData = !!attendance?.overall.conducted;
  return (
    <Card className="attendance-panel">
      <SectionTitle action={<Link to="/attendance" className="panel-link">Details <ArrowRight className="size-3.5" /></Link>}>Attendance</SectionTitle>
      {attendance === undefined ? <div className="skeleton h-28 rounded-xl" role="status" aria-label="Loading attendance" /> : <>
        <div className="attendance-heading">
          <div><p className="eyebrow">Overall attendance</p><p className="attendance-number tabular">{hasData ? fmtPct(attendance.overall.percent) : '—'}<span> / 100%</span></p></div>
          <span className={cn('status-orb', risks ? 'text-warning-ink bg-warning/10' : 'text-accent bg-accent-soft')}><ChartPie className="size-6" /></span>
        </div>
        <Meter value={hasData ? attendance.overall.percent : null} color="var(--accent)" label="Overall attendance" />
        <p className={cn('mt-3 flex items-start gap-2 text-xs leading-relaxed', risks ? 'text-warning-ink' : 'text-ink-2')}>
          {risks ? <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> : <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />}
          {risks ? `${risks} subject${risks === 1 ? '' : 's'} need${risks === 1 ? 's' : ''} attention` : hasData ? 'All tracked subjects are on course.' : 'Mark your first class to start tracking.'}
        </p>
        {subjects.length > 0 && <>
          <ul id={id} className="attendance-subjects">
            {(expanded ? subjects : subjects.slice(0, 3)).map(({ subject, summary, thresholds }) => {
              const warn = summary.risk === 'at_risk' || summary.risk === 'below_min';
              return <li key={subject.id}>
                <div className="mb-2 flex items-start justify-between gap-3 text-xs">
                  <span className="min-w-0 leading-relaxed">{subject.name}</span>
                  <span className="flex shrink-0 items-center gap-1 tabular" style={{ color: warn ? riskColor(summary.risk) : undefined }}>{warn && <AlertTriangle className="size-3" aria-label="Attendance risk" />}{fmtPct(summary.percent)}</span>
                </div>
                <Meter value={summary.percent} color={warn ? riskColor(summary.risk) : 'var(--accent)'} marker={thresholds.min} label={`${subject.name} attendance`} />
                {warn && <p className="mt-1.5 text-[11px] leading-relaxed text-ink-2">{summary.advice}</p>}
              </li>;
            })}
          </ul>
          {subjects.length > 3 && <button className="expand-button" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded((v) => !v)}>{expanded ? 'Show fewer subjects' : `View all ${subjects.length} subjects`}<ChevronDown className={cn('size-4 transition-transform', expanded && 'rotate-180')} /></button>}
        </>}
      </>}
    </Card>
  );
}

export interface TimelineItem { key: string; start: string; end?: string | null; complete: boolean; past: boolean; status?: string; active: boolean; category: string; node: ReactNode }

export function ScheduleTimeline({ items }: { items: TimelineItem[] }) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const sorted = [...items].sort((a, b) => a.start.localeCompare(b.start) || a.key.localeCompare(b.key));
  const relevant = sorted.filter((item) => !item.complete && !item.past);
  const visible = expanded ? sorted : (relevant.length ? relevant : sorted).slice(0, 4);
  return <>
    <ol id={id} className="schedule-timeline">
      {visible.map((item) => <li key={item.key} className={cn('timeline-item', item.active && 'timeline-active', item.complete && 'timeline-complete')}>
        <span className="timeline-dot" aria-hidden />
        <div className="timeline-meta"><span>{item.category}</span><span>{item.status ?? (item.complete ? 'Completed' : item.active ? 'In progress' : item.start === '99:99' ? 'Any time' : 'Upcoming')}</span></div>
        {item.node}
      </li>)}
    </ol>
    {sorted.length > visible.length || expanded ? <button className="expand-button" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded((v) => !v)}>{expanded ? 'Show upcoming sessions' : `View full schedule · ${sorted.length} sessions`}<ChevronDown className={cn('size-4 transition-transform', expanded && 'rotate-180')} /></button> : null}
  </>;
}

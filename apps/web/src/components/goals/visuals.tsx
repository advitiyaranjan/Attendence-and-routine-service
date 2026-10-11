/** Small visual building blocks for goals: progress ring, health pill, milestone markers, celebration. */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Ban, Check, CircleDashed, Clock3, Pause, Trophy, type LucideIcon } from 'lucide-react';
import { diffDays, goalCategory, type GoalHealth, type GoalHealthLevel, type MilestoneState, type TaskPriority } from '@student-os/core';
import { cn } from '../ui';

/** Circular progress with the percentage printed inside. */
export function ProgressRing({ value, size = 56, stroke = 6, color = 'var(--accent)', label, children }: { value: number; size?: number; stroke?: number; color?: string; label: string; children?: React.ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="meter" aria-label={label} aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-2)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct / 100)}
          className="transition-[stroke-dashoffset] duration-500 ease-out motion-reduce:transition-none"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">{children ?? <span className="text-xs font-semibold tabular">{Math.round(pct)}%</span>}</div>
    </div>
  );
}

const HEALTH_STYLE: Record<GoalHealthLevel, { color: string; Icon: LucideIcon }> = {
  on_track: { color: 'var(--color-good)', Icon: Check },
  attention: { color: 'var(--color-warning)', Icon: AlertTriangle },
  behind: { color: 'var(--color-serious)', Icon: AlertTriangle },
  overdue: { color: 'var(--color-critical)', Icon: Clock3 },
  no_deadline: { color: 'var(--muted)', Icon: CircleDashed },
  paused: { color: 'var(--muted)', Icon: Pause },
  completed: { color: 'var(--color-good)', Icon: Trophy },
};

export const healthColor = (level: GoalHealthLevel) => HEALTH_STYLE[level].color;

/** Schedule status: icon + label + colour, with the reasons as a tooltip. */
export function HealthPill({ health, className }: { health: GoalHealth; className?: string }) {
  const { color, Icon } = HEALTH_STYLE[health.level];
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-ink-2', className)} title={health.reasons.join('\n')}>
      <Icon className="size-3.5" style={{ color }} aria-hidden />
      {health.label}
    </span>
  );
}

export function CategoryTag({ category, className }: { category: string; className?: string }) {
  const c = goalCategory(category);
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs text-ink-2', className)}>
      <span className="size-2 rounded-full" style={{ background: c.color }} aria-hidden />
      {c.label}
    </span>
  );
}

const PRIORITY_STYLE: Record<TaskPriority, { label: string; color: string }> = {
  urgent: { label: 'Urgent', color: 'var(--color-critical)' },
  high: { label: 'High', color: 'var(--color-serious)' },
  medium: { label: 'Medium', color: 'var(--color-warning)' },
  low: { label: 'Low', color: 'var(--muted)' },
};

export function PriorityTag({ priority }: { priority: TaskPriority }) {
  const p = PRIORITY_STYLE[priority];
  return (
    <span className="inline-flex items-center gap-1 text-xs text-ink-2">
      <span className="flex h-3 items-end gap-px" aria-hidden>
        {[1, 2, 3].map((n) => (
          <span key={n} className="w-[3px] rounded-sm" style={{ height: `${n * 4}px`, background: n <= ({ low: 1, medium: 2, high: 3, urgent: 3 } as const)[priority] ? p.color : 'var(--line)' }} />
        ))}
      </span>
      {p.label}
    </span>
  );
}

export const STATE_STYLE: Record<MilestoneState, { label: string; color: string; Icon: LucideIcon }> = {
  done: { label: 'Completed', color: 'var(--color-good)', Icon: Check },
  active: { label: 'Current', color: 'var(--accent)', Icon: CircleDashed },
  upcoming: { label: 'Upcoming', color: 'var(--muted)', Icon: CircleDashed },
  overdue: { label: 'Overdue', color: 'var(--color-critical)', Icon: Clock3 },
  blocked: { label: 'Blocked', color: 'var(--color-warning)', Icon: Ban },
};

/** The node on the roadmap path. */
export function MilestoneMarker({ state, index }: { state: MilestoneState; index: number }) {
  const s = STATE_STYLE[state];
  if (state === 'done') {
    return (
      <span className="flex size-8 items-center justify-center rounded-full text-white shadow-sm" style={{ background: s.color }}>
        <Check className="size-4" strokeWidth={3} aria-hidden />
      </span>
    );
  }
  if (state === 'active') {
    return (
      <span className="relative flex size-8 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-ink shadow-sm">
        <span className="absolute inset-0 rounded-full bg-accent opacity-40 motion-safe:animate-ping" aria-hidden />
        <span className="relative tabular">{index + 1}</span>
      </span>
    );
  }
  if (state === 'upcoming') {
    return <span className="flex size-8 items-center justify-center rounded-full border-2 border-line bg-surface text-xs font-semibold text-muted tabular">{index + 1}</span>;
  }
  const Icon = s.Icon;
  return (
    <span className="flex size-8 items-center justify-center rounded-full border-2 bg-surface" style={{ borderColor: s.color, color: s.color }}>
      <Icon className="size-4" aria-hidden />
    </span>
  );
}

/** "12 days left", "Today", "3 days overdue". */
export function dueLabel(date: string, today: string) {
  const d = diffDays(today, date);
  if (d < 0) return `${-d} day${d === -1 ? '' : 's'} overdue`;
  if (d === 0) return 'Due today';
  if (d === 1) return 'Due tomorrow';
  if (d < 60) return `${d} days left`;
  const months = Math.round(d / 30);
  return `${months} month${months === 1 ? '' : 's'} left`;
}

export function fmtDate(date: string, withYear = false) {
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}) });
}

// ---------------------------------------------------------------------------
// Celebration: a short confetti burst for milestones and goals. Skipped with reduced motion.

export function celebrate() {
  window.dispatchEvent(new Event('sos-celebrate'));
}

const CONFETTI_COLORS = ['var(--accent)', '#0ca30c', '#fab219', '#ec835a', '#60a5fa', '#a78bfa'];

export function CelebrationLayer() {
  const [burst, setBurst] = useState(0);
  useEffect(() => {
    const on = () => {
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      setBurst((b) => b + 1);
    };
    window.addEventListener('sos-celebrate', on);
    return () => window.removeEventListener('sos-celebrate', on);
  }, []);
  useEffect(() => {
    if (!burst) return;
    const t = setTimeout(() => setBurst(0), 1400);
    return () => clearTimeout(t);
  }, [burst]);
  if (!burst) return null;
  return createPortal(
    <div key={burst} className="pointer-events-none fixed inset-0 z-[70] overflow-hidden" aria-hidden>
      {Array.from({ length: 28 }, (_, i) => {
        const angle = (i / 28) * Math.PI * 2;
        const dist = 120 + ((i * 37) % 90);
        return (
          <span
            key={i}
            className="confetti absolute left-1/2 top-1/2 h-2.5 w-1.5 rounded-[2px]"
            style={
              {
                background: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
                '--dx': `${Math.cos(angle) * dist}px`,
                '--dy': `${Math.sin(angle) * dist - 60}px`,
                '--rot': `${(i * 47) % 360}deg`,
                animationDelay: `${(i % 5) * 18}ms`,
              } as React.CSSProperties
            }
          />
        );
      })}
    </div>,
    document.body,
  );
}

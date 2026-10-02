/** Building blocks for settings screens: grouped cards of rows, label left, control right. */
import type { ReactNode } from 'react';
import { cn } from '../ui';

export function SettingsGroup({ title, footer, children }: { title?: string; footer?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-1.5">
      {title && <h3 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted">{title}</h3>}
      <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">{children}</div>
      {footer && <p className="px-1 text-xs text-muted">{footer}</p>}
    </section>
  );
}

/** One setting: label (+ optional description) on the left, its control on the right. */
export function SettingRow({ label, description, children, stacked }: { label: ReactNode; description?: ReactNode; children?: ReactNode; stacked?: boolean }) {
  return (
    <div className={cn('flex gap-3 px-4 py-3', stacked ? 'flex-col' : 'items-center justify-between')}>
      <div className="min-w-0">
        <div className="text-sm font-medium text-ink">{label}</div>
        {description && <div className="mt-0.5 text-xs text-ink-2">{description}</div>}
      </div>
      {children && <div className={cn(stacked ? 'w-full' : 'shrink-0')}>{children}</div>}
    </div>
  );
}

/** A plain block inside a group (for toggles or richer content that brings its own layout). */
export function SettingBlock({ children }: { children: ReactNode }) {
  return <div className="px-4 py-2">{children}</div>;
}

/** Compact number input with a unit, for rows. */
export function NumberField({ value, onCommit, min, max, step, unit, label }: { value: number; onCommit: (v: number) => void; min?: number; max?: number; step?: number; unit?: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <input
        type="number"
        aria-label={label}
        defaultValue={value}
        key={value}
        min={min}
        max={max}
        step={step}
        onBlur={(e) => {
          const n = Number(e.target.value);
          if (e.target.value !== '' && Number.isFinite(n) && n !== value) onCommit(Math.min(max ?? n, Math.max(min ?? n, n)));
        }}
        className="h-9 w-20 rounded-lg border border-line bg-surface-2 px-2 text-right text-sm text-ink focus:border-accent focus:outline-none"
      />
      {unit && <span className="text-sm text-ink-2">{unit}</span>}
    </span>
  );
}

/** Segmented control (e.g. Theme: System | Light | Dark). */
export function Segmented<T extends string | number>({ value, options, onChange, label }: { value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-xl bg-surface-2 p-1">
      {options.map((o) => (
        <button
          key={String(o.value)}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn('rounded-lg px-3 py-1.5 text-sm transition-colors', value === o.value ? 'bg-surface font-medium text-ink shadow-sm' : 'text-ink-2 hover:text-ink')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Day-of-week pill picker. */
export function DayPicker({ value, onChange, labels }: { value: number[]; onChange: (v: number[]) => void; labels: readonly string[] }) {
  return (
    <div role="group" aria-label="Days" className="flex flex-wrap gap-1.5">
      {labels.map((d, i) => {
        const on = value.includes(i);
        return (
          <button
            key={d}
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== i) : [...value, i].sort())}
            className={cn('size-10 rounded-full text-sm font-medium transition-colors', on ? 'bg-accent text-accent-ink' : 'bg-surface-2 text-ink-2 hover:text-ink')}
          >
            {d.slice(0, 2)}
          </button>
        );
      })}
    </div>
  );
}

import { useState } from 'react';
import { Bell, Pencil, Plus, Trash2 } from 'lucide-react';
import { describeRecurrence, formatTime12, nextReminderDate, todayISO, WEEKDAY_SHORT, type Recurrence, type Reminder } from '@student-os/core';
import { Badge, Button, Card, cn, EmptyState, Field, Input, Modal, PageHeader, Select, Textarea, Toggle } from '../components/ui';
import { useAll, useToday } from '../lib/hooks';
import { create, remove, update } from '../lib/repo';
import { toast } from '../lib/store';

export function ReminderForm({ initial, onDone }: { initial?: Reminder; onDone: () => void }) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [date, setDate] = useState(initial?.date ?? todayISO());
  const [time, setTime] = useState(initial?.time ?? '20:00');
  const [rec, setRec] = useState<Recurrence>(initial?.recurrence ?? { freq: 'none', interval: 1, weekdays: [], unit: 'day', until: null });
  const [busy, setBusy] = useState(false);
  const setR = (p: Partial<Recurrence>) => setRec({ ...rec, ...p });

  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const data = { title: title.trim(), notes: notes || null, date, time, recurrence: rec };
        if (initial) await update('reminder', initial.id, data);
        else await create('reminder', data);
        toast(initial ? 'Reminder updated' : `Reminder set for ${formatTime12(time)}`, 'success');
        setBusy(false);
        onDone();
      }}
    >
      <Field label="Remind me to">
        <Input autoFocus required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Call my professor" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={rec.freq === 'none' ? 'Date' : 'Starting'}>
          <Input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Time">
          <Input type="time" required value={time} onChange={(e) => setTime(e.target.value)} />
        </Field>
        <Field label="Repeat">
          <Select value={rec.freq} onChange={(e) => setR({ freq: e.target.value as Recurrence['freq'], weekdays: [] })}>
            <option value="none">Does not repeat</option>
            <option value="daily">Every day</option>
            <option value="weekdays">Every weekday</option>
            <option value="weekly">Every week</option>
            <option value="monthly">Every month</option>
            <option value="custom">Custom…</option>
          </Select>
        </Field>
        {rec.freq !== 'none' && (
          <Field label="Until (optional)">
            <Input type="date" value={rec.until ?? ''} onChange={(e) => setR({ until: e.target.value || null })} />
          </Field>
        )}
      </div>
      {rec.freq === 'custom' && (
        <div className="flex items-end gap-2">
          <Field label="Every">
            <Input type="number" min={1} max={365} value={rec.interval} onChange={(e) => setR({ interval: Math.max(1, Number(e.target.value)) })} className="w-20" />
          </Field>
          <Field label="Unit">
            <Select value={rec.unit} onChange={(e) => setR({ unit: e.target.value as Recurrence['unit'] })}>
              <option value="day">day(s)</option>
              <option value="week">week(s)</option>
              <option value="month">month(s)</option>
            </Select>
          </Field>
        </div>
      )}
      {(rec.freq === 'weekly' || (rec.freq === 'custom' && rec.unit === 'week')) && (
        <Field label="On" group>
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAY_SHORT.map((d, i) => {
              const on = rec.weekdays.includes(i);
              return (
                <button
                  type="button"
                  key={d}
                  aria-pressed={on}
                  onClick={() => setR({ weekdays: on ? rec.weekdays.filter((x) => x !== i) : [...rec.weekdays, i].sort() })}
                  className={cn('rounded-lg border px-2.5 py-1 text-sm', on ? 'border-accent bg-accent-soft font-medium' : 'border-line text-ink-2')}
                >
                  {d}
                </button>
              );
            })}
          </div>
        </Field>
      )}
      {rec.freq !== 'none' && <p className="text-xs text-muted">{describeRecurrence(rec, date)} at {formatTime12(time)}</p>}
      <Field label="Notes">
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={busy} disabled={!title.trim()}>
          {initial ? 'Save' : 'Set reminder'}
        </Button>
      </div>
    </form>
  );
}

export default function Reminders() {
  const today = useToday();
  const reminders = (useAll('reminder') ?? []).map((r) => ({ r, next: nextReminderDate(r.date, r.recurrence, today) })).sort((a, b) => (a.next ?? '9999').localeCompare(b.next ?? '9999'));
  const [editing, setEditing] = useState<Reminder | 'new' | null>(null);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Reminders"
        subtitle="One-off and recurring reminders. They fire even offline while the app is open, and via push when it's closed."
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
            Reminder
          </Button>
        }
      />
      {reminders.length === 0 && <EmptyState icon={<Bell className="size-6" />} title="No reminders" body='Create one here, or tell Copilot: "Remind me every Sunday at 8 PM to plan my week."' />}
      <Card className="divide-y divide-line p-0">
        {reminders.map(({ r, next }) => (
          <div key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className={cn('text-sm font-medium', !r.active && 'text-muted line-through')}>{r.title}</div>
              <div className="flex flex-wrap gap-2 text-xs text-ink-2">
                <span>
                  {describeRecurrence(r.recurrence, r.date)} · {formatTime12(r.time)}
                </span>
                {next ? <Badge>Next: {next === today ? 'today' : next}</Badge> : <Badge>Finished</Badge>}
                {r.source === 'ai' && <span className="text-muted">via Copilot</span>}
              </div>
            </div>
            <Toggle checked={r.active} onChange={(v) => void update('reminder', r.id, { active: v })} label="Active" />
            <Button size="sm" variant="ghost" aria-label="Edit reminder" onClick={() => setEditing(r)}>
              <Pencil className="size-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-label="Delete reminder"
              onClick={async () => {
                await remove('reminder', r.id);
                toast('Reminder deleted', 'info', { label: 'Undo', run: () => void update('reminder', r.id, { deletedAt: null }) });
              }}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
      </Card>
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing === 'new' ? 'New reminder' : 'Edit reminder'}>
        {editing && <ReminderForm initial={editing === 'new' ? undefined : editing} onDone={() => setEditing(null)} />}
      </Modal>
    </div>
  );
}
